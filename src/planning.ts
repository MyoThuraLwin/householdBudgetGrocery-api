import type { Express } from "express";
import { z } from "zod";
import { createHash } from "node:crypto";
import { db, transaction } from "./db.js";
import {
  endpoint,
  assert,
  exists,
  checkRevision,
  uid,
  paging,
} from "./http.js";
import { amount, revision } from "./validation.js";
import { household, summary } from "./budget.js";
import { getList, inventory } from "./inventory.js";
import { candidatesFor, catalogue } from "./catalogue.js";
import { D, money, optimise, today } from "./domain.js";
import { save, record, replace, unpack } from "./records.js";

export async function catalogueFingerprint(tx: any = db) {
  const c = await catalogue(tx);
  const rules = await tx.fulfilmentRule.findMany({ orderBy: { id: "asc" } });
  return createHash("sha256")
    .update(
      JSON.stringify({
        c: c.map((x: any) => [x.id, x.snapshotId, x.stale, x.store.active]),
        rules,
      }),
    )
    .digest("hex");
}
export async function reviewCurrent(plan: any, tx: any = db) {
  const [l, b, h, fingerprint] = await Promise.all([
    getList(plan.listId, tx),
    summary(plan.budgetId, tx),
    household(tx),
    catalogueFingerprint(tx),
  ]);
  return (
    l.revision === plan.listRevision &&
    b.revision === plan.budgetRevision &&
    h.revision === plan.householdRevision &&
    fingerprint === plan.catalogueFingerprint &&
    today(h.timezone) === plan.calculatedOn
  );
}
export function planningRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  const ruleSchema = z.object({
    mode: z.enum(["pickup", "delivery"]),
    minimum: amount,
    delivery: amount.nullable(),
    freeThreshold: amount.nullable(),
    travel: amount,
    source: z.string().trim().min(1).max(300),
    revision: revision.optional(),
  });
  e(
    "get",
    "/stores/:id/fulfilment-rules",
    "Store fulfilment rules and travel assumptions",
    undefined,
    async (req) =>
      db.fulfilmentRule.findMany({ where: { storeId: req.params.id } }),
  );
  e(
    "put",
    "/stores/:id/fulfilment-rules",
    "Set delivery or pickup costs",
    ruleSchema,
    async (req, b) =>
      transaction(async (tx) => {
        exists(
          await tx.store.findUnique({ where: { id: req.params.id } }),
          "Store",
        );
        const existing = await tx.fulfilmentRule.findUnique({
          where: { storeId_mode: { storeId: req.params.id, mode: b.mode } },
        });
        const { revision: rev, ...data } = b;
        if (existing) {
          assert(
            rev !== undefined,
            "Revision is required when changing a rule.",
          );
          checkRevision(existing, rev);
          return tx.fulfilmentRule.update({
            where: { id: existing.id },
            data: {
              ...data,
              observedAt: new Date(),
              revision: { increment: 1 },
            },
          });
        }
        return tx.fulfilmentRule.create({
          data: { ...data, storeId: req.params.id },
        });
      }),
  );
  e(
    "get",
    "/household/travel-costs",
    "Per-store and fulfilment-mode travel costs",
    undefined,
    async () => db.fulfilmentRule.findMany({ include: { store: true } }),
  );
  e(
    "put",
    "/household/travel-costs",
    "Update user-entered travel cost",
    z.object({ ruleId: z.string(), revision, travel: amount }),
    async (_, b) =>
      transaction(async (tx) => {
        const r: any = exists(
          await tx.fulfilmentRule.findUnique({ where: { id: b.ruleId } }),
        );
        checkRevision(r, b.revision);
        return tx.fulfilmentRule.update({
          where: { id: r.id },
          data: { travel: b.travel, revision: { increment: 1 } },
        });
      }),
  );
  const requestSchema = z.object({
    listId: z.string(),
    listRevision: revision,
    budgetId: z.string(),
    budgetRevision: revision,
    storeIds: z.array(z.string()).min(1).max(10),
    chosenStoreId: z.string().optional(),
    mode: z.enum(["pickup", "delivery"]),
    maxStores: z.number().int().min(1).max(5),
    allowStale: z.boolean().default(false),
    allowUnknown: z.boolean().default(false),
  });
  const run = async (b: any) =>
    transaction(async (tx) => {
      const l = await getList(b.listId, tx);
      const budget = await summary(b.budgetId, tx);
      const h = await household(tx);
      checkRevision(l, b.listRevision);
      checkRevision(budget, b.budgetRevision);
      assert(
        l.items.length > 0 && l.items.length <= 30,
        "Optimise between 1 and 30 items.",
      );
      const preferences = JSON.parse(h.preferences);
      const eligibleStoreIds = Array.isArray(preferences.eligibleStoreIds)
        ? preferences.eligibleStoreIds
        : [];
      assert(
        !eligibleStoreIds.length ||
          b.storeIds.every((id: string) => eligibleStoreIds.includes(id)),
        "Select stores allowed by your household settings.",
      );
      assert(
        !b.chosenStoreId || b.storeIds.includes(b.chosenStoreId),
        "The selected-store baseline must be one of the eligible stores.",
      );
      const c = (
        await candidatesFor(l, tx, b.allowStale, b.allowUnknown)
      ).filter((x) => b.storeIds.includes(x.storeId));
      const rules = (
        await tx.fulfilmentRule.findMany({
          where: { storeId: { in: b.storeIds }, mode: b.mode },
        })
      ).map((r: any) => ({
        ...r,
        minimum: r.minimum.toString(),
        delivery: r.delivery?.toString() ?? null,
        freeThreshold: r.freeThreshold?.toString() ?? null,
        travel: r.travel.toString(),
      }));
      const result = optimise(
        l.items,
        c,
        rules,
        budget.remaining,
        h.singleStore ? 1 : Math.min(b.maxStores, h.maxStores),
        b.chosenStoreId,
      );
      return save(
        "plan",
        {
          ...result,
          request: b,
          listId: l.id,
          listName: l.name,
          listRevision: l.revision,
          listItems: l.items,
          budgetId: budget.budgetId,
          budgetRevision: budget.revision,
          availableBudget: budget.remaining,
          householdRevision: h.revision,
          catalogueFingerprint: await catalogueFingerprint(tx),
          calculatedOn: today(h.timezone),
          state: "draft",
          acknowledged: false,
        },
        tx,
      );
    });
  e(
    "post",
    "/optimisations",
    "Compare complete store allocations and explicit deferrals",
    requestSchema,
    async (_, b) => run(b),
  );
  e(
    "get",
    "/optimisations/:id",
    "Saved optimisation inputs and results",
    undefined,
    async (req) => record(req.params.id, "plan"),
  );
  e(
    "post",
    "/optimisations/:id/recalculate",
    "Create new result with current list and budget revisions",
    z.object({}),
    async (req) => {
      const p = await record(req.params.id, "plan");
      const l = await getList(p.listId);
      const b = await summary(p.budgetId);
      return run({
        ...p.request,
        listRevision: l.revision,
        budgetRevision: b.revision,
      });
    },
  );
  e(
    "get",
    "/shopping-plans",
    "Saved plans with live review status",
    undefined,
    async (req) => {
      const rs = await db.savedRecord.findMany({
        where: { kind: "plan" },
        ...paging(req),
        orderBy: { createdAt: "desc" },
      });
      const results = [];
      for (const r of rs) {
        const p = unpack(r);
        const purchase = await db.purchase.findUnique({
          where: { sourcePlanId: p.id },
        });
        results.push({
          ...p,
          needsReview: !(await reviewCurrent(p)),
          purchaseId: purchase?.id,
          purchaseState: purchase?.state,
        });
      }
      return results;
    },
  );
  e(
    "get",
    "/shopping-plans/:id",
    "Plan review with current revisions",
    undefined,
    async (req) => {
      const p = await record(req.params.id, "plan");
      return { ...p, needsReview: !(await reviewCurrent(p)) };
    },
  );
  e(
    "post",
    "/shopping-plans/:id/approve",
    "Approve complete current plan without recording a purchase",
    z.object({ revision, acknowledgeWarnings: z.boolean().default(false) }),
    async (req, b) =>
      transaction(async (tx) => {
        const p = await record(req.params.id, "plan", tx);
        checkRevision(p, b.revision);
        assert(
          await reviewCurrent(p, tx),
          "Inputs changed. Recalculate before approving.",
          409,
        );
        assert(
          p.best?.feasible && p.best.withinBudget,
          "Only complete feasible plans within the current budget can be approved.",
        );
        assert(
          !p.best.conditional || b.acknowledgeWarnings,
          "Acknowledge stale prices or uncertain availability.",
        );
        return replace(
          p.id,
          {
            ...p,
            state: "approved",
            acknowledged: b.acknowledgeWarnings,
            approvedAt: new Date().toISOString(),
          },
          tx,
        );
      }),
  );
  e(
    "post",
    "/shopping-plans/:id/purchase-draft",
    "Create an editable purchase draft from approved plan",
    z.object({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const p = await record(req.params.id, "plan", tx);
        const existing = await tx.purchase.findUnique({
          where: { sourcePlanId: p.id },
          include: { lines: true },
        });
        if (existing) return existing;
        checkRevision(p, b.revision);
        assert(
          p.state === "approved" && (await reviewCurrent(p, tx)),
          "Approve a current plan before creating a purchase draft.",
          409,
        );
        const budget = await tx.budgetMonth.findUnique({
          where: { id: p.budgetId },
        });
        const h = await household(tx);
        assert(
          today(h.timezone).startsWith(budget.month),
          "Select a budget for the actual purchase month.",
        );
        return tx.purchase.create({
          data: {
            budgetId: p.budgetId,
            purchasedOn: today(h.timezone),
            storeName: p.best.stores
              .map((s: any) => s.name)
              .join(", ")
              .slice(0, 120),
            total: p.best.total,
            delivery: money(
              p.best.stores.reduce(
                (s: any, x: any) => D(s).plus(x.delivery),
                "0",
              ),
            ),
            travel: money(
              p.best.stores.reduce(
                (s: any, x: any) => D(s).plus(x.travel),
                "0",
              ),
            ),
            sourcePlanId: p.id,
            confirmationKey: "draft:" + uid(),
            lines: {
              create: p.best.allocations.map((a: any) => ({
                inventoryItemId: a.inventoryItemId,
                productId: a.productId,
                name: a.name,
                category: a.category,
                quantity: a.purchased,
                unit: a.unit,
                lineCost: a.cost,
              })),
            },
          },
          include: { lines: true },
        });
      }),
  );
  e(
    "get",
    "/dashboard",
    "Current budget inventory and plan overview",
    undefined,
    async (req) => {
      const h = await household();
      const selected = String(req.query.month ?? today(h.timezone).slice(0, 7));
      const b = await db.budgetMonth.findUnique({
        where: { householdId_month: { householdId: h.id, month: selected } },
      });
      const inv = await inventory();
      const plans = await db.savedRecord.findMany({
        where: { kind: "plan" },
        orderBy: { createdAt: "desc" },
        take: 3,
      });
      return {
        household: h,
        month: selected,
        summary: b ? await summary(b.id) : null,
        inventoryCount: inv.length,
        lowStock: inv.filter((i: any) => D(i.needed).gt(0)),
        expiring: inv.filter((i: any) =>
          i.batches.some(
            (x: any) => x.status === "soon" && D(x.quantity).gt(0),
          ),
        ),
        expired: inv.filter((i: any) =>
          i.batches.some(
            (x: any) => x.status === "expired" && D(x.quantity).gt(0),
          ),
        ),
        plans: plans.map(unpack),
        dataNotice:
          "Sample records are fictional. Imported prices are observations, not guaranteed checkout prices.",
      };
    },
  );
}
