import { variableReports } from "./reports.js";
import type { Express } from "express";
import { z } from "zod";
import { db, transaction } from "./db.js";
import { endpoint, assert, exists, checkRevision, paging } from "./http.js";
import { amount, month, category, date, revision } from "./validation.js";
import { budgetSummary, D, money, sum, monthlyExpense } from "./domain.js";

export async function household(tx: any = db) {
  return exists(
    await tx.household.findFirst(),
    "Household (run npm run db:seed)",
  );
}
export async function getBudget(id: string, tx: any = db) {
  const b = exists<any>(
    await tx.budgetMonth.findUnique({
      where: { id },
      include: {
        commitments: { include: { transactions: true } },
        purchases: { include: { adjustments: true } },
      },
    }),
    "Budget",
  );
  return {
    ...b,
    commitments: b.commitments.map((c: any) => ({
      ...c,
      actualTotal: money(sum(c.transactions.map((t: any) => t.amount))),
    })),
  };
}
export async function summary(id: string, tx: any = db) {
  const b = await getBudget(id, tx);
  return budgetSummary(b, b.purchases);
}
export async function touchBudget(id: string, tx: any) {
  await tx.budgetMonth.update({
    where: { id },
    data: { revision: { increment: 1 } },
  });
}
export function budgetRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  e("get", "/household", "Household settings", undefined, async () =>
    household(),
  );
  e(
    "patch",
    "/household",
    "Update household settings",
    z.object({
      revision,
      name: z.string().trim().min(1).max(120),
      timezone: z.string().refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
      location: z.string().max(120),
      expiryWindowDays: z.number().int().min(0).max(60),
      maxStores: z.number().int().min(1).max(5),
      singleStore: z.boolean(),
      reserveDefault: amount,
      alertThreshold: amount.nullable(),
      preferences: z
        .string()
        .max(10000)
        .refine((v) => {
          try {
            const value = JSON.parse(v);
            return (
              value !== null &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              (value.eligibleStoreIds === undefined ||
                (Array.isArray(value.eligibleStoreIds) &&
                  value.eligibleStoreIds.length <= 10 &&
                  value.eligibleStoreIds.every(
                    (id: unknown) => typeof id === "string",
                  )))
            );
          } catch {
            return false;
          }
        }),
    }),
    async (_, b) =>
      transaction(async (tx) => {
        const h = await household(tx);
        checkRevision(h, b.revision);
        return tx.household.update({
          where: { id: h.id },
          data: { ...b, revision: { increment: 1 } },
        });
      }),
  );
  e("get", "/budgets", "List monthly budgets", undefined, async (req) =>
    db.budgetMonth.findMany({ ...paging(req), orderBy: { month: "desc" } }),
  );
  e(
    "post",
    "/budgets",
    "Create monthly budget",
    z.object({
      month,
      funds: amount,
      reserve: amount,
      completed: z.boolean().default(false),
    }),
    async (_, b) => {
      const h = await household();
      return db.budgetMonth.create({ data: { ...b, householdId: h.id } });
    },
  );
  e(
    "get",
    "/budgets/:id",
    "Budget with commitments and transactions",
    undefined,
    async (req) => getBudget(req.params.id),
  );
  e(
    "get",
    "/budgets/:id/summary",
    "Authoritative grocery budget",
    undefined,
    async (req) => summary(req.params.id),
  );
  e(
    "patch",
    "/budgets/:id",
    "Update monthly funds and reserve",
    z.object({
      revision,
      funds: amount,
      reserve: amount,
      completed: z.boolean(),
    }),
    async (req, b) =>
      transaction(async (tx) => {
        const record = await getBudget(req.params.id, tx);
        checkRevision(record, b.revision);
        await tx.budgetMonth.update({
          where: { id: record.id },
          data: { ...b, revision: { increment: 1 } },
        });
        return summary(record.id, tx);
      }),
  );
  const commitmentSchema = z.object({
    category,
    subcategory: z.string().max(60).default(""),
    description: z.string().trim().min(1).max(160),
    // planned remains accepted for older clients sending monthly amounts.
    planned: amount
      .describe("Legacy monthly input; use inputAmount for new clients.")
      .optional(),
    inputAmount: amount
      .describe(
        "Amount in the selected frequency. Required for weekly input; preferred for monthly input.",
      )
      .optional(),
    frequency: z
      .enum(["monthly", "weekly"])
      .default("monthly")
      .describe(
        "All expense categories support monthly or weekly input. Monthly plan = weekly inputAmount × calendar days in the budget month ÷ 7, rounded once to cents.",
      ),
    recurring: z.boolean().default(true),
  });
  function plannedExpense(b: any, month: string) {
    assert(
      b.frequency !== "weekly" || b.inputAmount !== undefined,
      "Enter the weekly expense amount.",
    );
    const inputAmount = b.inputAmount ?? b.planned;
    assert(inputAmount !== undefined, "Enter an expense amount.");
    return {
      inputAmount,
      frequency: b.frequency,
      planned: monthlyExpense(inputAmount, b.frequency, month),
    };
  }
  e(
    "post",
    "/budgets/:id/commitments",
    "Add a planned expense",
    commitmentSchema.extend({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const budget = await getBudget(req.params.id, tx);
        checkRevision(budget, b.revision);
        const { revision: _, ...data } = b;
        const calculated = plannedExpense(data, budget.month);
        const record = await tx.expenseCommitment.create({
          data: {
            ...data,
            ...calculated,
            budgetId: budget.id,
            outstanding: calculated.planned,
          },
        });
        await touchBudget(budget.id, tx);
        return record;
      }),
  );
  e(
    "patch",
    "/commitments/:id",
    "Update commitment and outstanding reserve",
    commitmentSchema.extend({
      revision,
      outstanding: amount,
      settlement: z.enum(["unpaid", "partial", "settled"]),
    }),
    async (req, b) =>
      transaction(async (tx) => {
        const c: any = exists(
          await tx.expenseCommitment.findUnique({
            where: { id: req.params.id },
            include: { budget: true },
          }),
        );
        checkRevision(c, b.revision);
        assert(
          b.settlement !== "settled" || D(b.outstanding).eq(0),
          "Settled commitments cannot retain an outstanding amount.",
        );
        const r = await tx.expenseCommitment.update({
          where: { id: c.id },
          data: {
            ...b,
            ...plannedExpense(b, c.budget.month),
            revision: { increment: 1 },
          },
        });
        await touchBudget(c.budgetId, tx);
        return r;
      }),
  );
  e(
    "delete",
    "/commitments/:id",
    "Remove a commitment without actual transactions",
    z.object({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const c: any = exists(
          await tx.expenseCommitment.findUnique({
            where: { id: req.params.id },
            include: { transactions: true },
          }),
        );
        checkRevision(c, b.revision);
        assert(
          !c.transactions.length,
          "Resolve existing transactions before deleting this commitment.",
          409,
        );
        await tx.expenseCommitment.delete({ where: { id: c.id } });
        await touchBudget(c.budgetId, tx);
      }),
  );
  const actualSchema = z.object({
    revision,
    amount,
    incurredOn: date,
    note: z.string().max(500).default(""),
    outstanding: amount,
    settlement: z.enum(["partial", "settled"]),
  });
  e(
    "post",
    "/commitments/:id/transactions",
    "Record actual cost and remaining commitment",
    actualSchema,
    async (req, b) =>
      transaction(async (tx) => {
        const c: any = exists(
          await tx.expenseCommitment.findUnique({
            where: { id: req.params.id },
            include: { budget: true },
          }),
        );
        checkRevision(c, b.revision);
        assert(
          b.incurredOn.startsWith(c.budget.month),
          "Expense date must be in its budget month.",
        );
        assert(
          b.settlement !== "settled" || D(b.outstanding).eq(0),
          "Settled commitments must have zero outstanding.",
        );
        const r = await tx.expenseTransaction.create({
          data: {
            commitmentId: c.id,
            amount: b.amount,
            incurredOn: b.incurredOn,
            note: b.note,
          },
        });
        await tx.expenseCommitment.update({
          where: { id: c.id },
          data: {
            outstanding: b.outstanding,
            settlement: b.settlement,
            revision: { increment: 1 },
          },
        });
        await touchBudget(c.budgetId, tx);
        return r;
      }),
  );
  for (const method of ["patch", "delete"] as const)
    e(
      method,
      "/expense-transactions/:id",
      "Correct actual cost and review remaining reserve",
      actualSchema.extend({ commitmentRevision: revision }),
      async (req, b) =>
        transaction(async (tx) => {
          const t: any = exists(
            await tx.expenseTransaction.findUnique({
              where: { id: req.params.id },
              include: { commitment: { include: { budget: true } } },
            }),
          );
          checkRevision(t, b.revision);
          checkRevision(t.commitment, b.commitmentRevision);
          assert(
            b.incurredOn.startsWith(t.commitment.budget.month),
            "Expense date must be in its budget month.",
          );
          assert(
            b.settlement !== "settled" || D(b.outstanding).eq(0),
            "Settled commitments must have zero outstanding.",
          );
          if (method === "delete")
            await tx.expenseTransaction.delete({ where: { id: t.id } });
          else
            await tx.expenseTransaction.update({
              where: { id: t.id },
              data: {
                amount: b.amount,
                incurredOn: b.incurredOn,
                note: b.note,
                revision: { increment: 1 },
              },
            });
          await tx.expenseCommitment.update({
            where: { id: t.commitmentId },
            data: {
              outstanding: b.outstanding,
              settlement: b.settlement,
              revision: { increment: 1 },
            },
          });
          await touchBudget(t.commitment.budgetId, tx);
        }),
    );
  e(
    "get",
    "/reports/variable-expenses",
    "Month-to-date electricity and transport reports",
    undefined,
    async (req) => variableReports(req.query.month),
  );
}
