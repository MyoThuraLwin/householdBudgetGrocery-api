import type { Express } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, transaction } from "./db.js";
import { household, getBudget, touchBudget } from "./budget.js";
import {
  endpoint,
  exists,
  assert,
  checkRevision,
  key,
  uid,
  paging,
} from "./http.js";
import {
  itemSchema,
  listItemSchema,
  purchaseLineSchema,
  amount,
  quantity,
  date,
  revision,
} from "./validation.js";
import { D, qty, money, sum, today, stock } from "./domain.js";
import { save, record, replace } from "./records.js";

export async function inventory(tx: any = db) {
  const h = await household(tx);
  const items = await tx.inventoryItem.findMany({
    include: {
      batches: { include: { movements: true }, orderBy: { id: "asc" } },
    },
    orderBy: { name: "asc" },
  });
  return items.map((i: any) => stock(i, today(h.timezone), h.expiryWindowDays));
}
export async function getList(id: string, tx: any = db) {
  return exists<any>(
    await tx.shoppingList.findUnique({
      where: { id },
      include: { items: { orderBy: { id: "asc" } } },
    }),
    "Shopping list",
  );
}
export async function touchList(id: string, tx: any) {
  await tx.shoppingList.update({
    where: { id },
    data: { revision: { increment: 1 } },
  });
}
const fingerprint = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const purchaseTotals = (p: any) => ({
  ...p,
  adjustedTotal: money(
    D(p.total).plus(sum((p.adjustments ?? []).map((a: any) => a.amount))),
  ),
});
export async function validateProduct(
  productId: string | null | undefined,
  category: string,
  unit: string,
  tx: any,
) {
  if (!productId) return;
  const p: any = exists(
    await tx.product.findUnique({
      where: { id: productId },
      include: { listings: true },
    }),
    "Product",
  );
  const { units } = await import("./domain.js");
  assert(
    p.category.toLowerCase() === category.toLowerCase() &&
      p.listings.some(
        (l: any) =>
          units[l.unit as keyof typeof units]?.family ===
          units[unit as keyof typeof units]?.family,
      ),
    "Product mapping must have a compatible category and unit.",
  );
}
export function inventoryRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  e(
    "get",
    "/inventory/items",
    "Inventory with batches and usable stock",
    undefined,
    async (req) =>
      (await inventory()).slice(
        paging(req).skip,
        paging(req).skip + paging(req).take,
      ),
  );
  e(
    "post",
    "/inventory/items",
    "Create inventory item",
    itemSchema,
    async (_, b) => {
      const h = await household();
      await validateProduct(b.productId, b.category, b.unit, db);
      return db.inventoryItem.create({ data: { ...b, householdId: h.id } });
    },
  );
  e(
    "get",
    "/inventory/items/:id",
    "Inventory item detail",
    undefined,
    async (req) =>
      exists(
        (await inventory()).find((i: any) => i.id === req.params.id) ?? null,
      ),
  );
  e(
    "patch",
    "/inventory/items/:id",
    "Edit inventory definition",
    itemSchema.extend({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const i: any = exists(
          await tx.inventoryItem.findUnique({
            where: { id: req.params.id },
            include: { batches: true },
          }),
        );
        checkRevision(i, b.revision);
        assert(
          !i.batches.length || i.unit === b.unit,
          "Stock unit cannot change after batches exist.",
        );
        await validateProduct(b.productId, b.category, b.unit, tx);
        return tx.inventoryItem.update({
          where: { id: i.id },
          data: { ...b, revision: { increment: 1 } },
        });
      }),
  );
  e(
    "post",
    "/inventory/items/:id/batches",
    "Add a dated stock batch",
    z.object({
      revision,
      quantity,
      acquiredOn: date,
      expiryDate: date.nullable(),
      dateLabel: z
        .enum(["best-before", "use-by", "unknown"])
        .default("best-before"),
    }),
    async (req, b) =>
      transaction(async (tx) => {
        const i: any = exists(
          await tx.inventoryItem.findUnique({ where: { id: req.params.id } }),
        );
        checkRevision(i, b.revision);
        const r = await tx.inventoryBatch.create({
          data: {
            itemId: i.id,
            quantity: b.quantity,
            acquiredOn: b.acquiredOn,
            expiryDate: b.expiryDate,
            dateLabel: b.dateLabel,
            movements: {
              create: { quantity: b.quantity, reason: "Manual addition" },
            },
          },
        });
        await tx.inventoryItem.update({
          where: { id: i.id },
          data: { revision: { increment: 1 } },
        });
        return r;
      }),
  );
  e(
    "post",
    "/inventory/batches/:id/movements",
    "Consume discard or correct stock",
    z.object({
      revision,
      quantity: z
        .string()
        .regex(/^-?\d{1,10}(\.\d{1,6})?$/)
        .refine((v) => !D(v).eq(0)),
      reason: z.string().trim().min(1).max(160),
      expiredAcknowledged: z.boolean().default(false),
    }),
    async (req, b) =>
      transaction(async (tx) => {
        const batch: any = exists(
          await tx.inventoryBatch.findUnique({ where: { id: req.params.id } }),
        );
        checkRevision(batch, b.revision);
        assert(
          D(batch.quantity).plus(b.quantity).gte(0),
          "Movement would produce negative stock.",
        );
        const h = await household(tx);
        assert(
          !batch.expiryDate ||
            batch.expiryDate >= today(h.timezone) ||
            b.expiredAcknowledged ||
            b.reason.toLowerCase().includes("waste"),
          "Review the expired batch and acknowledge it explicitly.",
        );
        const movement = await tx.inventoryMovement.create({
          data: { batchId: batch.id, quantity: b.quantity, reason: b.reason },
        });
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: {
            quantity: qty(D(batch.quantity).plus(b.quantity)),
            revision: { increment: 1 },
          },
        });
        await tx.inventoryItem.update({
          where: { id: batch.itemId },
          data: { revision: { increment: 1 } },
        });
        return movement;
      }),
  );
  e(
    "get",
    "/inventory/alerts",
    "Low stock and expiry alerts",
    undefined,
    async () =>
      (await inventory()).filter(
        (i: any) =>
          D(i.needed).gt(0) ||
          i.batches.some(
            (b: any) => D(b.quantity).gt(0) && b.status !== "fresh",
          ),
      ),
  );
  e("get", "/shopping-lists", "Shopping lists", undefined, async (req) =>
    db.shoppingList.findMany({
      ...paging(req),
      include: { items: true },
      orderBy: { createdAt: "desc" },
    }),
  );
  e(
    "post",
    "/shopping-lists",
    "Create shopping list",
    z.object({ name: z.string().trim().min(1).max(120) }),
    async (_, b) => {
      const h = await household();
      return db.shoppingList.create({
        data: { ...b, householdId: h.id },
        include: { items: true },
      });
    },
  );
  e(
    "get",
    "/shopping-lists/:id",
    "Read shopping list",
    undefined,
    async (req) => getList(req.params.id),
  );
  e(
    "patch",
    "/shopping-lists/:id",
    "Rename shopping list",
    z.object({ revision, name: z.string().trim().min(1).max(120) }),
    async (req, b) =>
      transaction(async (tx) => {
        const l = await getList(req.params.id, tx);
        checkRevision(l, b.revision);
        return tx.shoppingList.update({
          where: { id: l.id },
          data: { name: b.name, revision: { increment: 1 } },
          include: { items: true },
        });
      }),
  );
  e(
    "post",
    "/shopping-lists/:id/items",
    "Add item with confirmed product mapping",
    listItemSchema.extend({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const l = await getList(req.params.id, tx);
        checkRevision(l, b.revision);
        const { revision: _, ...data } = b;
        await validateProduct(data.productId, data.category, data.unit, tx);
        const r = await tx.shoppingListItem.create({
          data: { ...data, listId: l.id },
        });
        await touchList(l.id, tx);
        return r;
      }),
  );
  for (const method of ["patch", "delete"] as const)
    e(
      method,
      "/shopping-list-items/:id",
      "Edit or remove shopping list item",
      method === "patch"
        ? listItemSchema.extend({ revision })
        : z.object({ revision }),
      async (req, b) =>
        transaction(async (tx) => {
          const i: any = exists(
            await tx.shoppingListItem.findUnique({
              where: { id: req.params.id },
              include: { list: true },
            }),
          );
          checkRevision(i.list, b.revision);
          if (method === "delete")
            await tx.shoppingListItem.delete({ where: { id: i.id } });
          else {
            const { revision: _, ...data } = b;
            await validateProduct(data.productId, data.category, data.unit, tx);
            await tx.shoppingListItem.update({ where: { id: i.id }, data });
          }
          await touchList(i.listId, tx);
        }),
    );
  e(
    "post",
    "/shopping-lists/:id/generation-preview",
    "Preview replenishment without changing list",
    z.object({ revision }),
    async (req, b) => {
      const l = await getList(req.params.id);
      checkRevision(l, b.revision);
      const inv = await inventory();
      const proposed = inv
        .filter(
          (i: any) =>
            D(i.needed).gt(0) &&
            !l.items.some(
              (x: any) =>
                x.inventoryItemId === i.id ||
                x.name.toLowerCase() === i.name.toLowerCase(),
            ),
        )
        .map((i: any) => ({
          inventoryItemId: i.id,
          productId: i.productId,
          name: i.name,
          category: i.category,
          quantity: i.needed,
          unit: i.unit,
          priority: "normal",
          origin: "generated",
        }));
      return save("generation", {
        listId: l.id,
        listRevision: l.revision,
        stockFingerprint: fingerprint(inv),
        date: today((await household()).timezone),
        proposed,
        quantityRequired: inv
          .filter(
            (i: any) =>
              D(i.minimum).eq(0) &&
              i.batches.some(
                (b: any) => b.status === "expired" && D(b.quantity).gt(0),
              ),
          )
          .map((i: any) => ({ id: i.id, name: i.name, unit: i.unit })),
      });
    },
  );
  e(
    "post",
    "/shopping-lists/:id/apply-generation",
    "Apply reviewed replenishment preview",
    z.object({ revision, previewId: z.string() }),
    async (req, b) =>
      transaction(async (tx) => {
        const l = await getList(req.params.id, tx);
        checkRevision(l, b.revision);
        const p = await record(b.previewId, "generation", tx);
        const h = await household(tx);
        assert(
          p.listId === l.id &&
            p.listRevision === l.revision &&
            p.stockFingerprint === fingerprint(await inventory(tx)) &&
            p.date === today(h.timezone),
          "Inventory or list changed. Generate a new preview.",
          409,
        );
        for (const i of p.proposed)
          await tx.shoppingListItem.create({ data: { ...i, listId: l.id } });
        await touchList(l.id, tx);
        return getList(l.id, tx);
      }),
  );
  const purchaseSchema = z.object({
    budgetId: z.string(),
    purchasedOn: date,
    storeName: z.string().max(120).default(""),
    delivery: amount.default("0"),
    travel: amount.default("0"),
    lines: z.array(purchaseLineSchema).min(1).max(200),
  });
  e(
    "get",
    "/purchases",
    "Purchase drafts and confirmed spending",
    undefined,
    async (req) =>
      (
        await db.purchase.findMany({
          ...paging(req),
          include: { lines: true, adjustments: true },
          orderBy: { purchasedOn: "desc" },
        })
      ).map(purchaseTotals),
  );
  e(
    "post",
    "/purchases",
    "Create editable purchase draft",
    purchaseSchema,
    async (_, b) => {
      const budget = await getBudget(b.budgetId);
      assert(
        b.purchasedOn.startsWith(budget.month),
        "Purchase date must be in the selected budget month.",
      );
      return db.purchase.create({
        data: {
          ...b,
          sourcePlanId: "manual:" + uid(),
          confirmationKey: "draft:" + uid(),
          total: money(
            sum(b.lines.map((l: any) => l.lineCost))
              .plus(b.delivery)
              .plus(b.travel),
          ),
          lines: { create: b.lines },
        },
        include: { lines: true, adjustments: true },
      });
    },
  );
  e("get", "/purchases/:id", "Purchase detail", undefined, async (req) =>
    purchaseTotals(
      exists(
        await db.purchase.findUnique({
          where: { id: req.params.id },
          include: { lines: true, adjustments: true },
        }),
      ),
    ),
  );
  e(
    "patch",
    "/purchases/:id",
    "Edit unconfirmed actual purchase",
    purchaseSchema.extend({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const p: any = exists(
          await tx.purchase.findUnique({ where: { id: req.params.id } }),
        );
        checkRevision(p, b.revision);
        assert(
          p.state === "draft",
          "Confirmed purchases require an adjustment.",
          409,
        );
        const budget = await getBudget(b.budgetId, tx);
        assert(
          b.purchasedOn.startsWith(budget.month),
          "Purchase date must be in the selected budget month.",
        );
        await tx.purchaseLine.deleteMany({ where: { purchaseId: p.id } });
        return tx.purchase.update({
          where: { id: p.id },
          data: {
            ...b,
            revision: { increment: 1 },
            total: money(
              sum(b.lines.map((l: any) => l.lineCost))
                .plus(b.delivery)
                .plus(b.travel),
            ),
            lines: { create: b.lines },
          },
          include: { lines: true },
        });
      }),
  );
  e(
    "post",
    "/purchases/:id/confirm",
    "Atomically confirm purchase spending and stock",
    z.object({ revision, chargesNotRecordedElsewhere: z.literal(true) }),
    async (req, b) =>
      transaction(async (tx) => {
        const token = key(req);
        const p: any = exists(
          await tx.purchase.findUnique({
            where: { id: req.params.id },
            include: { lines: true },
          }),
        );
        if (p.state === "confirmed") {
          assert(
            p.confirmationKey === token,
            "Purchase is already confirmed.",
            409,
          );
          return p;
        }
        checkRevision(p, b.revision);
        const budget = await getBudget(p.budgetId, tx);
        assert(
          p.purchasedOn.startsWith(budget.month),
          "Purchase date does not match budget month.",
        );
        const h = await household(tx);
        for (const l of p.lines) {
          let item: any = l.inventoryItemId
            ? exists(
                await tx.inventoryItem.findUnique({
                  where: { id: l.inventoryItemId },
                }),
                "Inventory item",
              )
            : null;
          if (!item)
            item = await tx.inventoryItem.create({
              data: {
                householdId: h.id,
                name: l.name,
                category: l.category,
                unit: l.unit,
                productId: l.productId,
              },
            });
          const { convert } = await import("./domain.js");
          const q = qty(convert(l.quantity, l.unit, item.unit));
          await tx.inventoryBatch.create({
            data: {
              itemId: item.id,
              quantity: q,
              acquiredOn: p.purchasedOn,
              expiryDate: l.expiryDate,
              dateLabel: l.expiryDate ? "best-before" : "unknown",
              purchaseLineId: l.id,
              movements: {
                create: { quantity: q, reason: `Purchase ${p.id}` },
              },
            },
          });
          await tx.inventoryItem.update({
            where: { id: item.id },
            data: { revision: { increment: 1 } },
          });
        }
        await touchBudget(p.budgetId, tx);
        return tx.purchase.update({
          where: { id: p.id },
          data: {
            state: "confirmed",
            confirmationKey: token,
            revision: { increment: 1 },
          },
          include: { lines: true },
        });
      }),
  );
  e(
    "post",
    "/purchases/:id/adjustments",
    "Traceable purchase correction with stock reconciliation",
    z.object({
      revision,
      reason: z.string().trim().min(1).max(500),
      amount: z.string().regex(/^-?\d{1,12}(\.\d{1,2})?$/),
      movements: z
        .array(
          z.object({
            batchId: z.string(),
            revision,
            quantity: z.string().regex(/^-?\d{1,10}(\.\d{1,6})?$/),
          }),
        )
        .default([]),
    }),
    async (req, b) =>
      transaction(async (tx) => {
        const token = fingerprint({
          operation: "purchase-adjustment",
          purchaseId: req.params.id,
          key: key(req),
        }).slice(0, 36);
        const prior = await tx.savedRecord.findUnique({ where: { id: token } });
        if (prior) {
          const p = JSON.parse(prior.payload);
          assert(
            p.purchaseId === req.params.id && p.body === JSON.stringify(b),
            "Idempotency key belongs to another request.",
            409,
          );
          return p.result;
        }
        const p: any = exists(
          await tx.purchase.findUnique({
            where: { id: req.params.id },
            include: { lines: true, adjustments: true },
          }),
        );
        checkRevision(p, b.revision);
        assert(
          p.state === "confirmed",
          "Only confirmed purchases can be adjusted.",
        );
        assert(
          D(p.total)
            .plus(sum(p.adjustments.map((a: any) => a.amount)))
            .plus(b.amount)
            .gte(0),
          "Adjustment cannot make purchase total negative.",
        );
        for (const m of b.movements) {
          const batch: any = exists(
            await tx.inventoryBatch.findUnique({ where: { id: m.batchId } }),
          );
          checkRevision(batch, m.revision);
          assert(
            p.lines.some((l: any) => l.id === batch.purchaseLineId),
            "Batch does not belong to this purchase.",
          );
          assert(
            D(batch.quantity).plus(m.quantity).gte(0),
            "Stock has been consumed. Reconcile the remaining quantity first.",
            409,
          );
          await tx.inventoryBatch.update({
            where: { id: batch.id },
            data: {
              quantity: qty(D(batch.quantity).plus(m.quantity)),
              revision: { increment: 1 },
              movements: {
                create: {
                  quantity: m.quantity,
                  reason: b.reason.slice(0, 160),
                },
              },
            },
          });
          await tx.inventoryItem.update({
            where: { id: batch.itemId },
            data: { revision: { increment: 1 } },
          });
        }
        const result = await tx.purchaseAdjustment.create({
          data: { purchaseId: p.id, reason: b.reason, amount: b.amount },
        });
        await tx.purchase.update({
          where: { id: p.id },
          data: { revision: { increment: 1 } },
        });
        await touchBudget(p.budgetId, tx);
        await tx.savedRecord.create({
          data: {
            id: token,
            kind: "idempotency",
            payload: JSON.stringify({
              purchaseId: p.id,
              body: JSON.stringify(b),
              result,
            }),
          },
        });
        return result;
      }),
  );
}
