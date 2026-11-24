import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { SignJWT, decodeJwt } from "jose";
import { createApp } from "../src/application.js";
import { systemDb as db } from "../src/db.js";

type Session = { user: any; accessToken: string; cookie: string };
test(
  "JWT authentication, household separation and administrator access",
  { skip: process.env.RUN_SQL_TESTS !== "1", timeout: 120000 },
  async (t) => {
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as any).port}/api/v1`;
    const suffix = randomUUID();
    const password = "Private test password!2026";
    const userIds: string[] = [],
      householdIds: string[] = [],
      sessionIds: string[] = [];
    let admin: Session, alice: Session, ben: Session;
    let budgetA: any,
      budgetB: any,
      itemA: any,
      listA: any,
      listB: any,
      productA: any,
      productB: any,
      importA: any,
      planA: any;
    async function call(
      path: string,
      method = "GET",
      body?: any,
      session?: Session,
      status = 200,
      extra: Record<string, string> = {},
    ) {
      const response = await fetch(url + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(session
            ? { Authorization: `Bearer ${session.accessToken}` }
            : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result: any = await response.json();
      assert.equal(
        response.status,
        status,
        `${method} ${path}: ${result.error?.message ?? "unexpected response"}`,
      );
      if (result.accessToken)
        sessionIds.push(String(decodeJwt(result.accessToken).sid));
      return {
        result,
        response,
        session: result.accessToken
          ? ({
              ...result,
              cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "",
            } as Session)
          : undefined,
      };
    }
    const tracked = (s: Session) => {
      userIds.push(s.user.id);
      householdIds.push(s.user.householdId);
      return s;
    };
    try {
      await t.test(
        "private routes reject anonymous requests; login hides passwords and hashes",
        async () => {
          await call("/household", "GET", undefined, undefined, 401);
          const login = await call("/auth/login", "POST", {
            email: "ADMIN@HOMEWISE.DEMO",
            password: "HomewiseDemo!2026",
          });
          admin = login.session!;
          assert.equal(admin.user.role, "admin");
          assert(!JSON.stringify(login.result).includes("passwordHash"));
          assert.match(
            login.response.headers.get("set-cookie") ?? "",
            /HttpOnly/i,
          );
          assert.match(
            login.response.headers.get("set-cookie") ?? "",
            /SameSite=Strict/i,
          );
          await call(
            "/auth/login",
            "POST",
            { email: "admin@homewise.demo", password: "incorrect" },
            undefined,
            401,
          );
        },
      );
      await t.test(
        "registration creates independent households and prevents role injection or orphan records",
        async () => {
          const input = {
            name: "Test Alice",
            email: `alice-${suffix}@example.test`,
            householdName: "Auth test Alice",
            password,
          };
          await call(
            "/auth/register",
            "POST",
            { ...input, role: "admin" },
            undefined,
            422,
          );
          alice = tracked(
            (await call("/auth/register", "POST", input)).session!,
          );
          ben = tracked(
            (
              await call("/auth/register", "POST", {
                ...input,
                name: "Test Ben",
                email: `ben-${suffix}@example.test`,
                householdName: "Auth test Ben",
              })
            ).session!,
          );
          assert.equal(alice.user.role, "household");
          assert.notEqual(alice.user.householdId, ben.user.householdId);
          const count = await db.household.count();
          await call("/auth/register", "POST", input, undefined, 409);
          assert.equal(await db.household.count(), count);
          const stored = await db.user.findUniqueOrThrow({
            where: { id: alice.user.id },
          });
          assert(stored.passwordHash.startsWith("scrypt$"));
          assert.notEqual(stored.passwordHash, password);
        },
      );
      await t.test(
        "JWT signature, expiry, session revocation and refresh rotation are enforced",
        async () => {
          const claims = decodeJwt(alice.accessToken);
          const expired = await new SignJWT({
            sid: claims.sid,
            householdId: claims.householdId,
            role: claims.role,
          })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject(alice.user.id)
            .setIssuer("homewise-api")
            .setAudience("homewise-app")
            .setIssuedAt()
            .setExpirationTime("0s")
            .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
          await call(
            "/household",
            "GET",
            undefined,
            { ...alice, accessToken: expired },
            401,
          );
          const forged = await new SignJWT({ ...claims })
            .setProtectedHeader({ alg: "HS256" })
            .sign(
              new TextEncoder().encode(
                "not-the-real-signing-key-32-bytes-long",
              ),
            );
          await call(
            "/household",
            "GET",
            undefined,
            { ...alice, accessToken: forged },
            401,
          );
          const oldCookie = alice.cookie;
          await call("/auth/refresh", "POST", {}, undefined, 403, {
            Cookie: oldCookie,
            Origin: "https://untrusted.example",
          });
          const refreshed = (
            await call("/auth/refresh", "POST", {}, undefined, 200, {
              Cookie: oldCookie,
            })
          ).session!;
          alice = refreshed;
          assert.notEqual(refreshed.cookie, oldCookie);
          await call("/auth/refresh", "POST", {}, undefined, 401, {
            Cookie: oldCookie,
          });
          await call("/auth/me", "GET", undefined, alice);
          const logout = await call("/auth/logout", "POST", {}, alice, 200, {
            Cookie: alice.cookie,
          });
          assert.match(
            logout.response.headers.get("set-cookie") ?? "",
            /Expires=/i,
          );
          await call("/household", "GET", undefined, alice, 401);
          await call("/auth/refresh", "POST", {}, undefined, 401, {
            Cookie: alice.cookie,
          });
          alice = (
            await call("/auth/login", "POST", {
              email: alice.user.email,
              password,
            })
          ).session!;
        },
      );
      await t.test(
        "budgets, reports and stock are scoped by authenticated household, including child mutations",
        async () => {
          budgetA = (
            await call(
              "/budgets",
              "POST",
              { month: "2097-01", funds: "4000", reserve: "200" },
              alice,
            )
          ).result;
          budgetB = (
            await call(
              "/budgets",
              "POST",
              { month: "2097-01", funds: "1000", reserve: "100" },
              ben,
            )
          ).result;
          const a = (await call("/budgets", "GET", undefined, alice)).result;
          const b = (await call("/budgets", "GET", undefined, ben)).result;
          assert.deepEqual(
            a.map((x: any) => x.id),
            [budgetA.id],
          );
          assert.deepEqual(
            b.map((x: any) => x.id),
            [budgetB.id],
          );
          await call(`/budgets/${budgetA.id}`, "GET", undefined, ben, 404);
          await call(
            `/budgets/${budgetA.id}`,
            "PATCH",
            { revision: 1, funds: "0", reserve: "0", completed: false },
            ben,
            404,
          );
          const commitment = (
            await call(
              `/budgets/${budgetA.id}/commitments`,
              "POST",
              {
                revision: budgetA.revision,
                description: "Private electricity",
                category: "electricity",
                planned: "200",
              },
              alice,
            )
          ).result;
          await call(
            `/commitments/${commitment.id}`,
            "DELETE",
            { revision: commitment.revision },
            ben,
            404,
          );
          await call(
            `/commitments/${commitment.id}/transactions`,
            "POST",
            {
              revision: commitment.revision,
              amount: "80",
              incurredOn: "2097-01-01",
              outstanding: "120",
              settlement: "partial",
            },
            ben,
            404,
          );
          const reportB = (
            await call(
              "/reports/variable-expenses?month=2097-01",
              "GET",
              undefined,
              ben,
            )
          ).result;
          assert.equal(reportB[0].current, "0.00");
          itemA = (
            await call(
              "/inventory/items",
              "POST",
              {
                name: "Private rice",
                category: "Pantry",
                unit: "kg",
                minimum: "2",
              },
              alice,
            )
          ).result;
          await call(
            `/inventory/items/${itemA.id}/batches`,
            "POST",
            {
              revision: itemA.revision,
              quantity: "1",
              acquiredOn: "2026-11-01",
              expiryDate: null,
            },
            ben,
            404,
          );
          assert.equal(
            (await call("/inventory/items", "GET", undefined, ben)).result
              .length,
            0,
          );
          await call(
            `/inventory/items/${itemA.id}`,
            "GET",
            undefined,
            ben,
            404,
          );
          assert.equal(
            (await call("/household", "GET", undefined, alice)).result.id,
            alice.user.householdId,
          );
        },
      );
      await t.test(
        "catalogues and import previews are private; nested foreign references are rejected",
        async () => {
          for (const [index, session] of [alice, ben].entries()) {
            await call(
              "/data-sources",
              "POST",
              {
                name: "Private fixture",
                type: "fixture",
                permission: "Isolated tenant test",
              },
              session,
            );
            const row = {
              source: "Private fixture",
              observedAt: new Date().toISOString(),
              store: "Private store",
              retailer: "Test",
              sku: "rice",
              name: "Private rice",
              category: "Pantry",
              packageQuantity: "1",
              unit: "kg",
              price: index ? "5" : "2",
              availability: "available",
            };
            const preview = (
              await call(
                "/price-imports/preview",
                "POST",
                { format: "json", content: JSON.stringify([row]) },
                session,
              )
            ).result;
            if (!index) importA = preview;
            await call(
              `/price-imports/${preview.id}/commit`,
              "POST",
              { revision: preview.revision },
              session,
              200,
              { "Idempotency-Key": randomUUID() },
            );
          }
          await call(
            `/price-imports/${importA.id}`,
            "GET",
            undefined,
            ben,
            404,
          );
          await call(
            `/price-imports/${importA.id}/commit`,
            "POST",
            { revision: importA.revision },
            ben,
            404,
            { "Idempotency-Key": randomUUID() },
          );
          const productsA = (await call("/products", "GET", undefined, alice))
              .result,
            productsB = (await call("/products", "GET", undefined, ben)).result;
          assert.equal(productsA.length, 1);
          assert.equal(productsB.length, 1);
          assert.equal(productsA[0].price, "2");
          assert.equal(productsB[0].price, "5");
          productA = productsA[0];
          productB = productsB[0];
          assert.notEqual(productA.productId, productB.productId);
          listA = (
            await call(
              "/shopping-lists",
              "POST",
              { name: "Private Alice list" },
              alice,
            )
          ).result;
          listB = (
            await call(
              "/shopping-lists",
              "POST",
              { name: "Private Ben list" },
              ben,
            )
          ).result;
          await call(
            `/shopping-lists/${listB.id}/items`,
            "POST",
            {
              revision: listB.revision,
              name: "Private rice",
              category: "Pantry",
              quantity: "1",
              unit: "kg",
              inventoryItemId: itemA.id,
              productId: productB.productId,
            },
            ben,
            404,
          );
          await call(
            `/shopping-lists/${listB.id}/items`,
            "POST",
            {
              revision: listB.revision,
              name: "Private rice",
              category: "Pantry",
              quantity: "1",
              unit: "kg",
              productId: productA.productId,
            },
            ben,
            404,
          );
          await call(
            `/shopping-lists/${listA.id}/items`,
            "POST",
            {
              revision: listA.revision,
              name: "Private rice",
              category: "Pantry",
              quantity: "1",
              unit: "kg",
              inventoryItemId: itemA.id,
              productId: productA.productId,
            },
            alice,
          );
          const ownList = (
            await call(`/shopping-lists/${listA.id}`, "GET", undefined, alice)
          ).result;
          await call(
            "/product-matches/confirm",
            "POST",
            {
              listItemId: ownList.items[0].id,
              productId: productB.productId,
              revision: ownList.revision,
            },
            alice,
            404,
          );
          await call(
            "/purchases",
            "POST",
            {
              budgetId: budgetB.id,
              purchasedOn: "2097-01-02",
              lines: [
                {
                  name: "Private rice",
                  category: "Pantry",
                  inventoryItemId: itemA.id,
                  quantity: "1",
                  unit: "kg",
                  lineCost: "1",
                },
              ],
            },
            ben,
            404,
          );
          const storeA = (await call("/stores", "GET", undefined, alice))
            .result[0];
          await call(
            `/stores/${storeA.id}/fulfilment-rules`,
            "PUT",
            {
              mode: "pickup",
              minimum: "0",
              delivery: "0",
              freeThreshold: null,
              travel: "0",
              source: "Test",
            },
            ben,
            404,
          );
          await call(
            `/stores/${storeA.id}/fulfilment-rules`,
            "PUT",
            {
              mode: "pickup",
              minimum: "0",
              delivery: "0",
              freeThreshold: null,
              travel: "0",
              source: "Test",
            },
            alice,
          );
          const budget = (
            await call(
              `/budgets/${budgetA.id}/summary`,
              "GET",
              undefined,
              alice,
            )
          ).result;
          planA = (
            await call(
              "/optimisations",
              "POST",
              {
                listId: listA.id,
                listRevision: ownList.revision,
                budgetId: budgetA.id,
                budgetRevision: budget.revision,
                storeIds: [storeA.id],
                mode: "pickup",
                maxStores: 1,
              },
              alice,
            )
          ).result;
          await call(`/shopping-plans/${planA.id}`, "GET", undefined, ben, 404);
          await call(
            `/shopping-plans/${planA.id}/approve`,
            "POST",
            { revision: planA.revision },
            ben,
            404,
          );
          assert.equal(
            (await call("/shopping-plans", "GET", undefined, ben)).result
              .length,
            0,
          );
        },
      );
      await t.test(
        "administration is enforced on the API; role and active-state changes invalidate sessions",
        async () => {
          await call("/admin/summary", "GET", undefined, alice, 403);
          await call("/admin/users", "GET", undefined, ben, 403);
          const records = (await call("/admin/users", "GET", undefined, admin))
            .result;
          assert(records.some((u: any) => u.id === alice.user.id));
          assert(!JSON.stringify(records).includes("passwordHash"));
          let target = await db.user.findUniqueOrThrow({
            where: { id: alice.user.id },
          });
          await call(
            `/admin/users/${target.id}`,
            "PATCH",
            {
              revision: target.revision,
              name: target.name,
              role: "admin",
              active: true,
            },
            alice,
            403,
          );
          await call(
            `/admin/users/${target.id}`,
            "PATCH",
            {
              revision: target.revision,
              name: target.name,
              role: "admin",
              active: true,
            },
            admin,
          );
          await call("/household", "GET", undefined, alice, 401);
          const promoted = (
            await call("/auth/login", "POST", {
              email: alice.user.email,
              password,
            })
          ).session!;
          assert.equal(promoted.user.role, "admin");
          await call("/admin/summary", "GET", undefined, promoted);
          target = await db.user.findUniqueOrThrow({
            where: { id: alice.user.id },
          });
          await call(
            `/admin/users/${target.id}`,
            "PATCH",
            {
              revision: target.revision,
              name: target.name,
              role: "household",
              active: true,
            },
            admin,
          );
          await call("/admin/summary", "GET", undefined, promoted, 401);
          target = await db.user.findUniqueOrThrow({
            where: { id: ben.user.id },
          });
          await call(
            `/admin/users/${target.id}`,
            "PATCH",
            {
              revision: target.revision,
              name: target.name,
              role: "household",
              active: false,
            },
            admin,
          );
          await call("/household", "GET", undefined, ben, 401);
          await call(
            "/auth/login",
            "POST",
            { email: ben.user.email, password },
            undefined,
            401,
          );
          target = await db.user.findUniqueOrThrow({
            where: { id: ben.user.id },
          });
          await call(
            `/admin/users/${target.id}`,
            "PATCH",
            {
              revision: target.revision,
              name: target.name,
              role: "household",
              active: true,
            },
            admin,
          );
          await call(
            `/admin/users/${admin.user.id}`,
            "PATCH",
            {
              revision: admin.user.revision,
              name: admin.user.name,
              role: "household",
              active: false,
            },
            admin,
            409,
          );
        },
      );
      await t.test(
        "password replacement and explicit session revocation invalidate old credentials",
        async () => {
          ben = (
            await call("/auth/login", "POST", {
              email: ben.user.email,
              password,
            })
          ).session!;
          let target = await db.user.findUniqueOrThrow({
            where: { id: ben.user.id },
          });
          const replacement = "Replacement test password!2026";
          await call(
            `/admin/users/${target.id}/password`,
            "POST",
            { revision: target.revision, password: replacement },
            admin,
          );
          await call("/household", "GET", undefined, ben, 401);
          await call(
            "/auth/login",
            "POST",
            { email: ben.user.email, password },
            undefined,
            401,
          );
          ben = (
            await call("/auth/login", "POST", {
              email: ben.user.email,
              password: replacement,
            })
          ).session!;
          target = await db.user.findUniqueOrThrow({
            where: { id: ben.user.id },
          });
          await call(
            `/admin/users/${target.id}/revoke-sessions`,
            "POST",
            { revision: target.revision },
            admin,
          );
          await call("/household", "GET", undefined, ben, 401);
          await call("/auth/refresh", "POST", {}, undefined, 401, {
            Cookie: ben.cookie,
          });
        },
      );
      await t.test(
        "administrators can create accounts with an atomic management audit",
        async () => {
          const input = {
            name: "Managed test account",
            email: `managed-${suffix}@example.test`,
            householdName: "Managed test household",
            password,
            role: "admin",
          };
          await call("/admin/users", "POST", input, alice, 401);
          const result = (await call("/admin/users", "POST", input, admin))
            .result;
          userIds.push(result.id);
          householdIds.push(result.householdId);
          assert.equal(result.role, "admin");
          assert(!("passwordHash" in result));
          assert.equal(
            await db.adminAudit.count({
              where: { targetId: result.id, action: "Created account" },
            }),
            1,
          );
          const session = (
            await call("/auth/login", "POST", { email: input.email, password })
          ).session!;
          await call("/admin/summary", "GET", undefined, session);
          assert.equal(
            (await call("/budgets", "GET", undefined, session)).result.length,
            0,
          );
        },
      );
    } finally {
      const where = { householdId: { in: householdIds } };
      // Delete only the two households registered by this isolated test, in foreign-key order.
      for (const model of [
        "inventoryMovement",
        "inventoryBatch",
        "purchaseAdjustment",
        "purchaseLine",
        "purchase",
        "shoppingListItem",
        "shoppingList",
        "inventoryItem",
        "expenseTransaction",
        "expenseCommitment",
        "budgetMonth",
        "priceSnapshot",
        "storeListing",
        "fulfilmentRule",
        "store",
        "product",
        "dataSource",
        "savedRecord",
      ] as const)
        await (db[model] as any).deleteMany({ where });
      await db.adminAudit.deleteMany({ where: { targetId: { in: userIds } } });
      await db.authSession.deleteMany({
        where: {
          OR: [{ userId: { in: userIds } }, { id: { in: sessionIds } }],
        },
      });
      await db.user.deleteMany({ where: { id: { in: userIds } } });
      await db.household.deleteMany({ where: { id: { in: householdIds } } });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.$disconnect();
    }
  },
);
