import { Decimal } from "decimal.js";

Decimal.set({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
export const D = (value: Decimal.Value = 0) => new Decimal(value);
export const money = (value: Decimal.Value) => D(value).toFixed(2);
export const qty = (value: Decimal.Value) => D(value).toFixed(6);
export const sum = (values: Decimal.Value[]) =>
  values.reduce<Decimal>((a, b) => a.plus(b), D(0));
export const today = (timezone = "Pacific/Auckland") =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const normalise = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ");
export class CalculationError extends Error {}
// Calendar-day allocation, independent of timezone, DST and weekly payment dates.
export function daysInBudgetMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new CalculationError("Use a budget month in YYYY-MM format.");
  const [year, number] = month.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    number - 1
  ]!;
}
export function monthlyExpense(
  inputAmount: Decimal.Value,
  frequency: "monthly" | "weekly",
  month: string,
) {
  return money(
    frequency === "weekly"
      ? D(inputAmount).times(daysInBudgetMonth(month)).div(7)
      : inputAmount,
  );
}
export const units = {
  g: { family: "mass", scale: "0.001", base: "kg" },
  kg: { family: "mass", scale: "1", base: "kg" },
  ml: { family: "volume", scale: "0.001", base: "l" },
  l: { family: "volume", scale: "1", base: "l" },
  each: { family: "count", scale: "1", base: "each" },
} as const;
export type Unit = keyof typeof units;
export function convert(value: Decimal.Value, from: string, to: string) {
  const a = units[from as Unit],
    b = units[to as Unit];
  if (!a || !b || a.family !== b.family)
    throw new CalculationError(
      "Quantities need compatible mass, volume or count units.",
    );
  return D(value).times(a.scale).div(b.scale);
}
export function packCost(
  required: Decimal.Value,
  requestedUnit: string,
  packQuantity: Decimal.Value,
  packUnit: string,
  price: Decimal.Value,
) {
  const size = convert(packQuantity, packUnit, requestedUnit);
  if (size.lte(0) || D(required).lte(0))
    throw new Error("Package and required quantities must be positive.");
  const packs = D(required).div(size).ceil();
  return {
    packs: packs.toNumber(),
    purchased: qty(packs.times(size)),
    excess: qty(packs.times(size).minus(required)),
    cost: money(packs.times(price)),
    unitPrice: D(price)
      .div(convert(packQuantity, packUnit, units[packUnit as Unit].base))
      .toFixed(6),
    baseUnit: units[packUnit as Unit].base,
  };
}
export function budgetSummary(budget: any, purchases: any[] = []) {
  const planned = sum(budget.commitments.map((c: any) => c.planned));
  const actual = sum(
    budget.commitments.flatMap((c: any) =>
      c.transactions.map((t: any) => t.amount),
    ),
  );
  const outstanding = sum(budget.commitments.map((c: any) => c.outstanding));
  const groceries = sum(
    purchases
      .filter((p) => p.state === "confirmed")
      .map((p) =>
        D(p.total).plus(sum((p.adjustments ?? []).map((a: any) => a.amount))),
      ),
  );
  const adjusted = D(budget.funds)
    .minus(actual)
    .minus(outstanding)
    .minus(budget.reserve);
  return {
    budgetId: budget.id,
    month: budget.month,
    revision: budget.revision,
    funds: money(budget.funds),
    reserve: money(budget.reserve),
    planned: money(planned),
    actual: money(actual),
    outstanding: money(outstanding),
    grocerySpending: money(groceries),
    plannedGroceryLimit: money(
      D(budget.funds).minus(planned).minus(budget.reserve),
    ),
    adjustedGroceryLimit: money(adjusted),
    remaining: money(adjusted.minus(groceries)),
  };
}
export function expiryStatus(
  date: string | null,
  current: string,
  window: number,
) {
  if (!date) return "unknown";
  if (date < current) return "expired";
  const end = new Date(current + "T12:00:00Z");
  end.setUTCDate(end.getUTCDate() + window);
  return date <= end.toISOString().slice(0, 10) ? "soon" : "fresh";
}
export function stock(item: any, current: string, window = 7) {
  const batches = item.batches.map((b: any) => ({
    ...b,
    status: expiryStatus(b.expiryDate, current, window),
  }));
  const usable = sum(
    batches
      .filter((b: any) => b.status !== "expired")
      .map((b: any) => b.quantity),
  );
  return {
    ...item,
    batches,
    usable: qty(usable),
    needed: qty(Decimal.max(D(item.minimum).minus(usable), 0)),
  };
}

export interface Candidate {
  itemId: string;
  productId: string;
  inventoryItemId?: string | null;
  listingId: string;
  snapshotId: string;
  storeId: string;
  storeName: string;
  name: string;
  category: string;
  unit: string;
  quantity: string;
  packs: number;
  purchased: string;
  excess: string;
  cost: string;
  price: string;
  source: string;
  observedAt: string;
  stale: boolean;
  uncertain: boolean;
}
export interface Rule {
  storeId: string;
  mode: string;
  minimum: string;
  delivery: string | null;
  freeThreshold: string | null;
  travel: string;
  revision: number;
}
export function evaluate(
  allocations: Candidate[],
  rules: Rule[],
  budget: string,
  maxStores: number,
  expected: string[],
) {
  const storeIds = [...new Set(allocations.map((c) => c.storeId))].sort();
  const warnings: string[] = [];
  const missing = expected.filter(
    (id) => !allocations.some((c) => c.itemId === id),
  );
  if (missing.length) warnings.push(`${missing.length} item(s) unmatched`);
  if (storeIds.length > maxStores)
    warnings.push("Maximum store count exceeded");
  const stores = storeIds.map((storeId) => {
    const subtotal = sum(
      allocations.filter((c) => c.storeId === storeId).map((c) => c.cost),
    );
    const rule = rules.find((r) => r.storeId === storeId);
    if (!rule) warnings.push(`Missing fulfilment rule for ${storeId}`);
    if (rule && subtotal.lt(rule.minimum))
      warnings.push(`Minimum order not reached at ${storeId}`);
    if (rule?.mode === "delivery" && rule.delivery === null)
      warnings.push(`Unknown delivery fee at ${storeId}`);
    const delivery =
      rule?.mode === "delivery" &&
      !(rule.freeThreshold !== null && subtotal.gte(rule.freeThreshold))
        ? D(rule.delivery ?? 0)
        : D(0);
    const travel = D(rule?.travel ?? 0);
    return {
      storeId,
      name: allocations.find((c) => c.storeId === storeId)!.storeName,
      subtotal: money(subtotal),
      delivery: money(delivery),
      travel: money(travel),
      total: money(subtotal.plus(delivery).plus(travel)),
    };
  });
  const total = money(sum(stores.map((s) => s.total)));
  return {
    allocations,
    stores,
    total,
    storeCount: stores.length,
    missing,
    warnings,
    feasible: warnings.length === 0 && allocations.length > 0,
    withinBudget: D(total).lte(budget),
    remaining: money(D(budget).minus(total)),
    conditional: allocations.some((c) => c.uncertain || c.stale),
    coverage: `${expected.length - missing.length}/${expected.length}`,
  };
}
export function optimise(
  items: { id: string; priority: string }[],
  candidates: Candidate[],
  rules: Rule[],
  budget: string,
  maxStores: number,
  chosenStore?: string,
  limit = 100000,
  generateDeferrals = true,
) {
  const started = performance.now();
  const ids = items.map((i) => i.id);
  const compare = (
    a: ReturnType<typeof evaluate>,
    b: ReturnType<typeof evaluate>,
  ) =>
    D(a.total).cmp(b.total) ||
    a.storeCount - b.storeCount ||
    a.allocations
      .map((x) => x.listingId)
      .join()
      .localeCompare(b.allocations.map((x) => x.listingId).join());
  const options = ids.map((id) =>
    candidates
      .filter((c) => c.itemId === id)
      .sort(
        (a, b) =>
          D(a.cost).cmp(b.cost) || a.listingId.localeCompare(b.listingId),
      ),
  );
  const storeIds = [...new Set(candidates.map((c) => c.storeId))].sort();
  const singles = storeIds.map((storeId) =>
    evaluate(
      options.flatMap((o) =>
        o.filter((c) => c.storeId === storeId).slice(0, 1),
      ),
      rules,
      budget,
      1,
      ids,
    ),
  );
  const single = singles.filter((s) => s.feasible).sort(compare)[0] ?? null;
  const chosen = chosenStore
    ? (singles.find((s) => s.stores[0]?.storeId === chosenStore) ?? null)
    : null;
  const itemByItem = evaluate(
    options.flatMap((o) => o.slice(0, 1)),
    rules,
    budget,
    maxStores,
    ids,
  );
  let best: ReturnType<typeof evaluate> | null =
    single && single.storeCount <= maxStores ? single : null;
  let visited = 0,
    complete = true;
  function search(index: number, allocation: Candidate[]) {
    if (++visited > limit) {
      complete = false;
      return;
    }
    if (new Set(allocation.map((c) => c.storeId)).size > maxStores) return;
    if (best && sum(allocation.map((c) => c.cost)).gt(best.total)) return;
    if (index === options.length) {
      const plan = evaluate(allocation, rules, budget, maxStores, ids);
      if (plan.feasible && (!best || compare(plan, best) < 0)) best = plan;
      return;
    }
    for (const c of options[index]) {
      if (!complete) break;
      search(index + 1, [...allocation, c]);
    }
  }
  if (items.length && options.every((o) => o.length)) search(0, []);
  const deferrals: { deferred: string[]; plan: ReturnType<typeof evaluate> }[] =
    [];
  if (generateDeferrals && best && !best.withinBudget) {
    let remaining = [...items];
    const deferred: string[] = [];
    for (const item of items
      .filter((i) => i.priority !== "high")
      .sort(
        (a, b) =>
          (a.priority === "low" ? 0 : 1) - (b.priority === "low" ? 0 : 1),
      )) {
      deferred.push(item.id);
      remaining = remaining.filter((i) => i.id !== item.id);
      // Re-evaluate all assignments, since dropping an item may change fees or store feasibility.
      if (!remaining.length) break;
      const result = optimise(
        remaining,
        candidates.filter((c) => remaining.some((i) => i.id === c.itemId)),
        rules,
        budget,
        maxStores,
        undefined,
        Math.min(limit, 10000),
        false,
      );
      if (result.best) {
        deferrals.push({ deferred: [...deferred], plan: result.best });
        if (result.best.withinBudget) break;
      }
    }
  }
  const savings = {
    chosen:
      best && chosen?.feasible
        ? money(D(chosen.total).minus(best.total))
        : null,
    single:
      best && single?.feasible
        ? money(D(single.total).minus(best.total))
        : null,
    itemByItem:
      best && itemByItem.feasible
        ? money(D(itemByItem.total).minus(best.total))
        : null,
  };
  return {
    chosen,
    single,
    itemByItem,
    best,
    savings,
    deferrals,
    missing: ids.filter((_, i) => !options[i].length),
    runtimeMs: Math.round(performance.now() - started),
    visited,
    searchComplete: complete,
    algorithm: "bounded-branch-and-bound-v1",
    limit,
    restriction: "One listing and store per item; whole packages only.",
  };
}
