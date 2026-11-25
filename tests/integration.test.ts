import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { createApp } from "../src/application.js";
import { systemDb as db } from "../src/db.js";

test(
  "SQL Server workflows: validation, revisions, purchase atomicity, import and optimisation",
  { skip: process.env.RUN_SQL_TESTS !== "1", timeout: 120000 },
  async (t) => {
    const server = createApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as any;
    const url = `http://127.0.0.1:${address.port}/api/v1`;
    const token = randomUUID();
    const name = "integration-" + token;
    let budgetId = "",
      itemId = "",
      listId = "",
      purchaseId = "";
    const recordIds: string[] = [];
    let accessToken = "";
    async function call(
      path: string,
      method = "GET",
      body?: any,
      key?: string,
      status = 200,
    ) {
      const response = await fetch(url + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result: any = await response.json();
      assert.equal(
        response.status,
        status,
        `${method} ${path}: ${JSON.stringify(result)}`,
      );
      return result;
    }
    try {
      await t.test("Windows connection verifies SQL Server 2022", async () => {
        const h = await call("/health");
        assert.match(h.version, /^16\./);
      });
      const session = await call("/auth/login", "POST", {
        email: "admin@homewise.demo",
        password: "HomewiseDemo!2026",
      });
      accessToken = session.accessToken;
      const h = await call("/household");
      // Use an unoccupied far-future month, leaving all user and demo budget periods unchanged.
      let month = "2098-01";
      for (let year = 2098; year <= 2198; year++) {
        const candidate = `${year}-01`;
        if (
          !(await db.budgetMonth.findUnique({
            where: {
              householdId_month: { householdId: h.id, month: candidate },
            },
          }))
        ) {
          month = candidate;
          break;
        }
      }
      await t.test("decimal validation and commitment settlement", async () => {
        await call(
          "/budgets",
          "POST",
          { month, funds: "-1", reserve: "0" },
          undefined,
          422,
        );
        const b = await call("/budgets", "POST", {
          month,
          funds: "4000",
          reserve: "200",
        });
        budgetId = b.id;
        const c = await call(`/budgets/${b.id}/commitments`, "POST", {
          revision: b.revision,
          category: "electricity",
          description: name,
          planned: "200",
        });
        await call(`/commitments/${c.id}/transactions`, "POST", {
          revision: c.revision,
          amount: "80",
          incurredOn: month + "-01",
          outstanding: "120",
          settlement: "partial",
        });
        const s = await call(`/budgets/${b.id}/summary`);
        assert.equal(s.remaining, "3600.00");
        await call(
          `/commitments/${c.id}/transactions`,
          "POST",
          {
            revision: c.revision,
            amount: "1",
            incurredOn: month + "-01",
            outstanding: "119",
            settlement: "partial",
          },
          undefined,
          409,
        );
      });
      await t.test(
        "weekly accommodation preserves source input and monthly settlement",
        async () => {
          const payload = {
            category: "accommodation",
            description: name + "-weekly",
            frequency: "weekly",
            inputAmount: "700",
            planned: "1",
          };
          const before = await call(`/budgets/${budgetId}/summary`);
          for (const invalid of [
            { ...payload, inputAmount: undefined },
            { ...payload, inputAmount: "-1" },
            { ...payload, inputAmount: "1.001" },
            { ...payload, frequency: "daily" },
            { ...payload, category: "unknown" },
            { category: "accommodation", description: name },
          ])
            await call(
              `/budgets/${budgetId}/commitments`,
              "POST",
              { ...invalid, revision: before.revision },
              undefined,
              422,
            );
          let c = await call(`/budgets/${budgetId}/commitments`, "POST", {
            ...payload,
            revision: before.revision,
          });
          try {
            assert.equal(c.inputAmount, "700");
            assert.equal(c.frequency, "weekly");
            assert.equal(c.planned, "3100"); // January, regardless of a forged monthly preview.
            assert.equal(c.outstanding, "3100");
            assert.equal(
              (await call(`/budgets/${budgetId}/summary`)).remaining,
              "500.00",
            );
            const actual = await call(
              `/commitments/${c.id}/transactions`,
              "POST",
              {
                revision: c.revision,
                amount: "700",
                incurredOn: month + "-01",
                outstanding: "2400",
                settlement: "partial",
              },
            );
            const saved = (await call(`/budgets/${budgetId}`)).commitments.find(
              (x: any) => x.id === c.id,
            );
            assert.equal(saved.frequency, "weekly");
            assert.equal(saved.inputAmount, "700");
            assert.equal(saved.actualTotal, "700.00");
            c = await call(`/commitments/${c.id}`, "PATCH", {
              ...payload,
              inputAmount: "710",
              revision: saved.revision,
              outstanding: "2444.29",
              settlement: "partial",
            });
            assert.equal(c.planned, "3144.29");
            assert.equal(
              (await call(`/budgets/${budgetId}/summary`)).remaining,
              "455.71",
            );
            await call(
              `/commitments/${c.id}`,
              "PATCH",
              {
                ...payload,
                inputAmount: "720",
                revision: saved.revision,
                outstanding: "2488.57",
                settlement: "partial",
              },
              undefined,
              409,
            );
            c = await call(`/commitments/${c.id}`, "PATCH", {
              category: "accommodation",
              description: payload.description,
              inputAmount: "3200",
              frequency: "monthly",
              revision: c.revision,
              outstanding: "2500",
              settlement: "partial",
            });
            assert.equal(c.planned, "3200");
            assert.equal(c.inputAmount, "3200");
            assert.equal(c.frequency, "monthly");
            assert.equal(
              (await call(`/budgets/${budgetId}/summary`)).remaining,
              "400.00",
            );
            await call(`/expense-transactions/${actual.id}`, "DELETE", {
              revision: actual.revision,
              commitmentRevision: c.revision,
              amount: "700",
              incurredOn: month + "-01",
              outstanding: "0",
              settlement: "settled",
            });
            const last = (await call(`/budgets/${budgetId}`)).commitments.find(
              (x: any) => x.id === c.id,
            );
            await call(`/commitments/${c.id}`, "DELETE", {
              revision: last.revision,
            });
            assert.equal(
              (await call(`/budgets/${budgetId}/summary`)).remaining,
              before.remaining,
            );
          } finally {
            await db.expenseTransaction.deleteMany({
              where: { commitmentId: c.id },
            });
            await db.expenseCommitment.deleteMany({ where: { id: c.id } });
          }
        },
      );
      await t.test(
        "every expense category supports weekly creation, editing and monthly reports",
        async () => {
          const categories = [
            "accommodation",
            "electricity",
            "internet",
            "phone",
            "transport",
            "other",
          ];
          for (const [index, category] of categories.entries()) {
            const before = await call(`/budgets/${budgetId}/summary`);
            const beforeReport =
              category === "electricity" || category === "transport"
                ? (
                    await call(`/reports/variable-expenses?month=${month}`)
                  ).find((x: any) => x.category === category)
                : null;
            const payload = {
              category,
              description: name + "-weekly-" + category,
              frequency: "weekly",
              inputAmount: "70.01",
            };
            let c = await call(`/budgets/${budgetId}/commitments`, "POST", {
              ...payload,
              revision: before.revision,
            });
            try {
              assert.equal(c.category, category);
              assert.equal(c.frequency, "weekly");
              assert.equal(c.inputAmount, "70.01");
              assert.equal(c.planned, "310.04");
              assert.equal(c.outstanding, "310.04");
              assert.equal(
                (await call(`/budgets/${budgetId}/summary`)).remaining,
                "3289.96",
              );
              const saved = (
                await call(`/budgets/${budgetId}`)
              ).commitments.find((x: any) => x.id === c.id);
              assert.equal(saved.frequency, "weekly");
              assert.equal(saved.inputAmount, "70.01");
              if (category === "electricity" || category === "transport") {
                const report = (
                  await call(`/reports/variable-expenses?month=${month}`)
                ).find((x: any) => x.category === category);
                assert.equal(
                  report.planned,
                  (Number(beforeReport?.planned ?? 0) + 310.04).toFixed(2),
                );
              }
              // Editing a weekly expense into another category keeps its frequency and monthly conversion.
              c = await call(`/commitments/${c.id}`, "PATCH", {
                ...payload,
                category: categories[(index + 1) % categories.length],
                inputAmount: "100.01",
                outstanding: "442.90",
                settlement: "unpaid",
                revision: c.revision,
              });
              assert.equal(c.frequency, "weekly");
              assert.equal(c.inputAmount, "100.01");
              assert.equal(c.planned, "442.9");
              assert.equal(c.outstanding, "442.9");
              assert.equal(
                (await call(`/budgets/${budgetId}/summary`)).remaining,
                "3157.10",
              );
              await call(`/commitments/${c.id}`, "DELETE", {
                revision: c.revision,
              });
              assert.equal(
                (await call(`/budgets/${budgetId}/summary`)).remaining,
                before.remaining,
              );
            } finally {
              await db.expenseCommitment.deleteMany({ where: { id: c.id } });
            }
          }
        },
      );
      await t.test(
        "stock generation detects changed inventory and preserves list edits",
        async () => {
          const i = await call("/inventory/items", "POST", {
            name,
            category: "Pantry",
            unit: "kg",
            minimum: "3",
          });
          itemId = i.id;
          await call(`/inventory/items/${i.id}/batches`, "POST", {
            revision: i.revision,
            quantity: "1",
            acquiredOn: "2026-01-01",
            expiryDate: null,
          });
          const l = await call("/shopping-lists", "POST", { name });
          listId = l.id;
          const preview = await call(
            `/shopping-lists/${l.id}/generation-preview`,
            "POST",
            { revision: l.revision },
          );
          recordIds.push(preview.id);
          assert.equal(
            preview.proposed.find((p: any) => p.inventoryItemId === itemId)
              .quantity,
            "2.000000",
          );
          const current = await call(`/inventory/items/${i.id}`);
          await call(`/inventory/items/${i.id}/batches`, "POST", {
            revision: current.revision,
            quantity: "1",
            acquiredOn: "2026-01-01",
            expiryDate: null,
          });
          await call(
            `/shopping-lists/${l.id}/apply-generation`,
            "POST",
            { revision: l.revision, previewId: preview.id },
            undefined,
            409,
          );
        },
      );
      await t.test(
        "purchase confirmation is atomic and safe to retry",
        async () => {
          const p = await call("/purchases", "POST", {
            budgetId,
            purchasedOn: month + "-02",
            lines: [
              {
                name,
                category: "Pantry",
                inventoryItemId: itemId,
                quantity: "1",
                unit: "kg",
                lineCost: "100",
              },
            ],
          });
          purchaseId = p.id;
          const confirmation = randomUUID();
          const payload = {
            revision: p.revision,
            chargesNotRecordedElsewhere: true,
          };
          await call(
            `/purchases/${p.id}/confirm`,
            "POST",
            payload,
            confirmation,
          );
          await call(
            `/purchases/${p.id}/confirm`,
            "POST",
            payload,
            confirmation,
          );
          assert.equal(
            await db.inventoryBatch.count({
              where: { purchaseLineId: p.lines[0].id },
            }),
            1,
          );
          const s = await call(`/budgets/${budgetId}/summary`);
          assert.equal(s.remaining, "3500.00");
          const failing = await call("/purchases", "POST", {
            budgetId,
            purchasedOn: month + "-03",
            lines: [
              {
                name: name + "-rollback",
                category: "Pantry",
                quantity: "1",
                unit: "kg",
                lineCost: "1",
              },
              {
                name,
                category: "Pantry",
                inventoryItemId: itemId,
                quantity: "1",
                unit: "l",
                lineCost: "1",
              },
            ],
          });
          await call(
            `/purchases/${failing.id}/confirm`,
            "POST",
            { revision: failing.revision, chargesNotRecordedElsewhere: true },
            randomUUID(),
            422,
          );
          assert.equal(
            await db.inventoryItem.count({
              where: { name: name + "-rollback" },
            }),
            0,
          );
          assert.equal(
            (await db.purchase.findUniqueOrThrow({ where: { id: failing.id } }))
              .state,
            "draft",
          );
        },
      );
      await t.test(
        "reports and purchase corrections preserve recorded data and prevent negative stock",
        async () => {
          const reports = await call(
            `/reports/variable-expenses?month=${month}`,
          );
          const electricity = reports.find(
            (r: any) => r.category === "electricity",
          );
          assert.equal(electricity.current, "80.00");
          assert.equal(electricity.variance, "-120.00");
          assert.equal(electricity.average, null);
          const p = await call(`/purchases/${purchaseId}`);
          const batch = await db.inventoryBatch.findFirstOrThrow({
            where: { purchaseLineId: p.lines[0].id },
          });
          await call(`/inventory/batches/${batch.id}/movements`, "POST", {
            revision: batch.revision,
            quantity: "-0.75",
            reason: "Consumed",
          });
          const current = await db.inventoryBatch.findUniqueOrThrow({
            where: { id: batch.id },
          });
          await call(
            `/purchases/${p.id}/adjustments`,
            "POST",
            {
              revision: p.revision,
              reason: "Invalid full reversal",
              amount: "-100",
              movements: [
                {
                  batchId: batch.id,
                  revision: current.revision,
                  quantity: "-1",
                },
              ],
            },
            randomUUID(),
            409,
          );
          const adjustmentKey =
            "long-idempotency-key-" + randomUUID() + "-safe-to-retry";
          const payload = {
            revision: p.revision,
            reason: "Actual price correction",
            amount: "-10",
          };
          await call(
            `/purchases/${p.id}/adjustments`,
            "POST",
            payload,
            adjustmentKey,
          );
          await call(
            `/purchases/${p.id}/adjustments`,
            "POST",
            payload,
            adjustmentKey,
          );
          assert.equal(
            (await call(`/budgets/${budgetId}/summary`)).remaining,
            "3510.00",
          );
          assert.equal(
            (
              await db.inventoryBatch.findUniqueOrThrow({
                where: { id: batch.id },
              })
            ).quantity.toString(),
            "0.25",
          );
        },
      );
      await t.test(
        "import preview rejects missing fields and supports idempotent commit",
        async () => {
          await call("/data-sources", "POST", {
            name,
            type: "fixture",
            permission: "Isolated integration test",
          });
          for (const format of ["csv", "json"]) {
            const template = await call(
              `/price-imports/template?format=${format}&source=${encodeURIComponent(name)}`,
            );
            const report = await call("/price-imports/preview", "POST", {
              format,
              content:
                format === "csv" ? template.csv : JSON.stringify(template.rows),
            });
            recordIds.push(report.id);
            assert.equal(report.count, 10);
            assert.deepEqual(report.errors, []);
            assert.equal(report.unknownStockCount, 10);
            assert.equal(
              new Set(report.rows.map((row: any) => row.retailer)).size,
              2,
            );
            const confirmed = await call("/price-imports/preview", "POST", {
              format,
              content:
                format === "csv" ? template.csv : JSON.stringify(template.rows),
              defaultAvailability: "available",
            });
            recordIds.push(confirmed.id);
            assert.deepEqual(confirmed.errors, []);
            assert.equal(confirmed.unknownStockCount, 0);
            assert(
              confirmed.rows.every(
                (row: any) => row.availability === "available",
              ),
            );
            const mixed = await call("/price-imports/preview", "POST", {
              format: "json",
              content: JSON.stringify([
                {
                  ...(format === "json" ? template.rows[0] : confirmed.rows[0]),
                  availability: "not available",
                },
              ]),
              defaultAvailability: "available",
            });
            recordIds.push(mixed.id);
            assert.deepEqual(mixed.errors, []);
            assert.equal(mixed.rows[0].availability, "unavailable");
          }
          const invalid = await call("/price-imports/preview", "POST", {
            format: "json",
            content: JSON.stringify([{ source: name }]),
          });
          recordIds.push(invalid.id);
          assert(invalid.errors.length > 0);
          const row = {
            source: name,
            observedAt: new Date().toISOString(),
            store: name,
            retailer: name,
            sku: "test",
            name,
            category: "Pantry",
            packageQuantity: "1",
            unit: "kg",
            price: "3",
            availability: "available",
          };
          // Exercise the CSV path after the parser's major security update,
          // including spreadsheet BOMs, quoted commas and escaped quotes.
          const csvRow = { ...row, name: `${name}, quoted "item"` };
          const csv =
            "\uFEFF" +
            Object.keys(csvRow).join(",") +
            "\n" +
            Object.values(csvRow)
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(",") +
            "\n";
          const csvPreview = await call("/price-imports/preview", "POST", {
            format: "csv",
            content: csv,
          });
          recordIds.push(csvPreview.id);
          assert.equal(csvPreview.errors.length, 0);
          assert.equal(csvPreview.rows[0].name, csvRow.name);
          assert.equal(csvPreview.rows[0].price, row.price);
          const preview = await call("/price-imports/preview", "POST", {
            format: "json",
            content: JSON.stringify([row]),
          });
          recordIds.push(preview.id);
          assert.equal(preview.errors.length, 0);
          const importKey = randomUUID();
          await call(
            `/price-imports/${preview.id}/commit`,
            "POST",
            { revision: preview.revision },
            importKey,
          );
          await call(
            `/price-imports/${preview.id}/commit`,
            "POST",
            { revision: preview.revision },
            importKey,
          );
          const store = await db.store.findFirstOrThrow({ where: { name } });
          await call(`/stores/${store.id}/fulfilment-rules`, "PUT", {
            mode: "pickup",
            minimum: "0",
            delivery: "0",
            freeThreshold: null,
            travel: "1",
            source: "Test",
          });
          const product = await db.product.findFirstOrThrow({
            where: { name },
          });
          const l = await call(`/shopping-lists/${listId}`);
          await call(`/shopping-lists/${listId}/items`, "POST", {
            revision: l.revision,
            name,
            category: "Pantry",
            quantity: "2",
            unit: "kg",
            productId: product.id,
          });
          const updated = await call(`/shopping-lists/${listId}`);
          const budget = await call(`/budgets/${budgetId}/summary`);
          const result = await call("/optimisations", "POST", {
            listId,
            listRevision: updated.revision,
            budgetId,
            budgetRevision: budget.revision,
            storeIds: [store.id],
            maxStores: 1,
            mode: "pickup",
          });
          recordIds.push(result.id);
          assert.equal(result.best.total, "7.00");
          const before = await db.purchase.count();
          await call(`/shopping-plans/${result.id}/approve`, "POST", {
            revision: result.revision,
          });
          assert.equal(await db.purchase.count(), before);
        },
      );
      await t.test(
        "unconfigured AI fails explicitly without changing budget",
        async () => {
          if (!process.env.AI_API_KEY)
            await call(
              "/assistant/requests",
              "POST",
              { action: "spending", budgetId },
              undefined,
              503,
            );
        },
      );
      await t.test(
        "mock AI validates supplied inventory and rejects invented figures and ingredients",
        async () => {
          let output: any = {
            explanation:
              "Your household commitments are reserved before grocery spending.",
            meals: [],
            alternatives: [],
          };
          const mock = createServer((req, res) => {
            req.resume();
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                choices: [{ message: { content: JSON.stringify(output) } }],
              }),
            );
          });
          mock.listen(0, "127.0.0.1");
          await once(mock, "listening");
          const old = {
            AI_BASE_URL: process.env.AI_BASE_URL,
            AI_API_KEY: process.env.AI_API_KEY,
            AI_MODEL: process.env.AI_MODEL,
          };
          process.env.AI_BASE_URL = `http://127.0.0.1:${(mock.address() as any).port}`;
          process.env.AI_API_KEY = "isolated-test-only";
          process.env.AI_MODEL = "mock";
          try {
            const valid = await call("/assistant/requests", "POST", {
              action: "spending",
              budgetId,
            });
            assert.equal(valid.verifiedBudget.remaining, "3510.00");
            output = {
              explanation: "Your grocery balance is $3,510.00.",
              meals: [],
              alternatives: [],
            };
            await call("/assistant/requests", "POST", {
              action: "spending",
              budgetId,
            });
            output = { ...output, explanation: "You can spend $99999." };
            await call(
              "/assistant/requests",
              "POST",
              { action: "spending", budgetId },
              undefined,
              502,
            );
            output = {
              explanation: "Use available ingredients.",
              meals: [
                {
                  name: "Invented meal",
                  ingredientIds: ["not-in-inventory"],
                  steps: "Cook.",
                  additionalIngredients: [],
                },
              ],
              alternatives: [],
            };
            await call(
              "/assistant/requests",
              "POST",
              { action: "meals", budgetId },
              undefined,
              502,
            );
          } finally {
            for (const [name, value] of Object.entries(old)) {
              if (value === undefined) delete process.env[name];
              else process.env[name] = value;
            }
            await new Promise<void>((resolve) => mock.close(() => resolve()));
          }
        },
      );
    } finally {
      // Cleanup only entities identified by this test's unique names/IDs, never user records.
      if (budgetId) {
        const purchases = await db.purchase.findMany({
          where: { budgetId },
          include: { lines: true },
        });
        const lineIds = purchases.flatMap((p) => p.lines.map((l) => l.id));
        for (const purchase of purchases)
          await db.savedRecord.deleteMany({
            where: { kind: "idempotency", payload: { contains: purchase.id } },
          });
        const batches = await db.inventoryBatch.findMany({
          where: { OR: [{ itemId }, { purchaseLineId: { in: lineIds } }] },
        });
        await db.inventoryMovement.deleteMany({
          where: { batchId: { in: batches.map((b) => b.id) } },
        });
        await db.inventoryBatch.deleteMany({
          where: { id: { in: batches.map((b) => b.id) } },
        });
        await db.purchaseAdjustment.deleteMany({
          where: { purchaseId: { in: purchases.map((p) => p.id) } },
        });
        await db.purchaseLine.deleteMany({
          where: { purchaseId: { in: purchases.map((p) => p.id) } },
        });
        await db.purchase.deleteMany({ where: { budgetId } });
        const commitments = await db.expenseCommitment.findMany({
          where: { budgetId },
        });
        await db.expenseTransaction.deleteMany({
          where: { commitmentId: { in: commitments.map((c) => c.id) } },
        });
        await db.expenseCommitment.deleteMany({ where: { budgetId } });
        await db.budgetMonth.delete({ where: { id: budgetId } });
      }
      if (listId) {
        await db.shoppingListItem.deleteMany({ where: { listId } });
        await db.shoppingList.delete({ where: { id: listId } });
      }
      if (itemId) await db.inventoryItem.delete({ where: { id: itemId } });
      const stores = await db.store.findMany({ where: { name } });
      const listings = await db.storeListing.findMany({
        where: { storeId: { in: stores.map((s) => s.id) } },
      });
      await db.priceSnapshot.deleteMany({
        where: { listingId: { in: listings.map((l) => l.id) } },
      });
      await db.storeListing.deleteMany({
        where: { id: { in: listings.map((l) => l.id) } },
      });
      await db.fulfilmentRule.deleteMany({
        where: { storeId: { in: stores.map((s) => s.id) } },
      });
      await db.store.deleteMany({ where: { name } });
      await db.product.deleteMany({ where: { name } });
      await db.dataSource.deleteMany({ where: { name } });
      await db.savedRecord.deleteMany({ where: { id: { in: recordIds } } });
      if (budgetId)
        await db.savedRecord.deleteMany({
          where: { kind: "assistant", payload: { contains: budgetId } },
        });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (accessToken) {
        const claims = JSON.parse(
          Buffer.from(accessToken.split(".")[1], "base64url").toString(),
        );
        await db.authSession.deleteMany({ where: { id: claims.sid } });
      }
      await db.$disconnect();
    }
  },
);
