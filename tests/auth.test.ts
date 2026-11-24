import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/passwords.js";
import {
  currentIdentity,
  runAsHousehold,
  scopedClient,
} from "../src/tenant.js";

test("passwords use unique salts and verify without storing plaintext", async () => {
  const value = "A sufficiently long test password";
  const a = await hashPassword(value),
    b = await hashPassword(value);
  assert.notEqual(a, b);
  assert(!a.includes(value));
  assert(await verifyPassword(value, a));
  assert.equal(await verifyPassword("incorrect password", a), false);
  assert.equal(await verifyPassword(value, "invalid hash"), false);
});
test("household queries fail closed without an authenticated context", async () => {
  const client = scopedClient({
    inventoryItem: { findMany: async (args: any) => args },
  });
  await assert.rejects(
    () => (client.inventoryItem.findMany as any)(),
    (e: any) => e.status === 401,
  );
});
test("tenant context isolates concurrent requests and overrides supplied query ownership", async () => {
  const client = scopedClient({
    inventoryItem: {
      findMany: async (args: any) => {
        await new Promise((resolve) => setImmediate(resolve));
        return { ...args, context: currentIdentity().householdId };
      },
    },
  });
  const results = await Promise.all(
    ["A", "B"].map((householdId) =>
      runAsHousehold(
        { userId: householdId, householdId, role: "household" },
        () =>
          client.inventoryItem.findMany({
            where: { householdId: "attacker-selected" },
          }),
      ),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.where.householdId),
    ["A", "B"],
  );
  assert.deepEqual(
    results.map((r) => r.context),
    ["A", "B"],
  );
});
test("nested stock inserts inherit ownership and reject cross-household references", async () => {
  const client = scopedClient({
    inventoryItem: {
      findFirst: async ({ where }: any) =>
        where.id === "owned" && where.householdId === "A"
          ? { id: "owned" }
          : null,
    },
    inventoryBatch: { create: async (args: any) => args.data },
  });
  await runAsHousehold(
    { userId: "u", householdId: "A", role: "household" },
    async () => {
      const row = await client.inventoryBatch.create({
        data: {
          itemId: "owned",
          movements: { create: [{ quantity: "1", reason: "Opening" }] },
        },
      });
      assert.equal(row.householdId, "A");
      assert.equal(row.movements.create[0].householdId, "A");
      await assert.rejects(
        () => client.inventoryBatch.create({ data: { itemId: "foreign" } }),
        (e: any) => e.status === 404,
      );
      await assert.rejects(
        () => client.inventoryBatch.create({ data: { householdId: "B" } }),
        (e: any) => e.status === 404,
      );
    },
  );
});
