import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetSummary,
  packCost,
  convert,
  expiryStatus,
  stock,
  evaluate,
  optimise,
  money,
  daysInBudgetMonth,
  monthlyExpense,
  type Candidate,
  type Rule,
} from "../src/domain.js";

test("weekly expenses are allocated to the selected month's calendar days", () => {
  for (const [month, days, total] of [
    ["2026-02", 28, "2800.00"],
    ["2028-02", 29, "2900.00"],
    ["2026-11", 30, "3000.00"],
    ["2026-12", 31, "3100.00"],
    ["2100-02", 28, "2800.00"],
    ["2000-02", 29, "2900.00"],
  ] as const) {
    assert.equal(daysInBudgetMonth(month), days);
    assert.equal(monthlyExpense("700", "weekly", month), total);
    assert.equal(monthlyExpense("2500", "monthly", month), "2500.00");
  }
  assert.equal(monthlyExpense("0", "weekly", "2026-11"), "0.00");
  assert.equal(monthlyExpense("100.01", "weekly", "2026-11"), "428.61");
  assert.equal(monthlyExpense("0.01", "weekly", "2026-12"), "0.04");
  assert.equal(
    monthlyExpense("999999999999.99", "weekly", "2026-12"),
    "4428571428571.38",
  );
  assert.throws(() => daysInBudgetMonth("2026-13"));
});

test("planned, partial and settled actual expenses replace the same commitment", () => {
  const b: any = {
    id: "b",
    month: "2026-10",
    revision: 1,
    funds: "4000",
    reserve: "200",
    commitments: [
      { planned: "2300", outstanding: "2300", transactions: [] },
      { planned: "200", outstanding: "200", transactions: [] },
    ],
  };
  assert.equal(budgetSummary(b).remaining, "1300.00");
  b.commitments[1] = {
    planned: "200",
    outstanding: "120",
    transactions: [{ amount: "80" }],
  };
  assert.equal(budgetSummary(b).remaining, "1300.00");
  b.commitments[1] = {
    planned: "200",
    outstanding: "0",
    transactions: [{ amount: "240" }],
  };
  assert.equal(budgetSummary(b).remaining, "1260.00");
  assert.equal(
    budgetSummary(b, [
      { state: "draft", total: "500" },
      { state: "confirmed", total: "100", adjustments: [{ amount: "-10" }] },
    ]).remaining,
    "1170.00",
  );
});
test("deficits remain negative and rounding is decimal half up", () => {
  assert.equal(
    budgetSummary({ funds: "10", reserve: "20", commitments: [] }).remaining,
    "-10.00",
  );
  assert.equal(money("1.005"), "1.01");
});
test("compatible conversions and package rounding match payable cost", () => {
  assert.equal(convert("500", "g", "kg").toString(), "0.5");
  assert.throws(() => convert("500", "g", "l"));
  const p = packCost("750", "g", "500", "g", "3");
  assert.equal(p.packs, 2);
  assert.equal(p.cost, "6.00");
  assert.equal(p.excess, "250.000000");
  assert.equal(p.unitPrice, "6.000000");
  assert.equal(packCost("1", "l", "1200", "ml", "5").purchased, "1.200000");
});
test("expiry dates use inclusive household-local window and expired stock is excluded", () => {
  assert.equal(expiryStatus("2026-10-26", "2026-10-27", 7), "expired");
  assert.equal(expiryStatus("2026-10-27", "2026-10-27", 7), "soon");
  assert.equal(expiryStatus("2026-11-03", "2026-10-27", 7), "soon");
  assert.equal(expiryStatus("2026-11-04", "2026-10-27", 7), "fresh");
  assert.equal(expiryStatus(null, "2026-10-27", 7), "unknown");
  const s = stock(
    {
      minimum: "3",
      batches: [
        { quantity: "2", expiryDate: "2026-10-26" },
        { quantity: "1", expiryDate: "2026-11-03" },
      ],
    },
    "2026-10-27",
  );
  assert.equal(s.usable, "1.000000");
  assert.equal(s.needed, "2.000000");
});
const c = (itemId: string, storeId: string, cost: string): Candidate => ({
  itemId,
  productId: itemId,
  listingId: itemId + storeId,
  snapshotId: "s",
  storeId,
  storeName: storeId,
  name: itemId,
  category: "Pantry",
  unit: "kg",
  quantity: "1",
  packs: 1,
  purchased: "1",
  excess: "0",
  cost,
  price: cost,
  source: "test",
  observedAt: "2026-10-27T00:00:00Z",
  stale: false,
  uncertain: false,
});
const r = (
  storeId: string,
  delivery: string,
  minimum = "0",
  freeThreshold: string | null = null,
): Rule => ({
  storeId,
  mode: "delivery",
  minimum,
  delivery,
  freeThreshold,
  travel: "0",
  revision: 1,
});
test("delivery charges can outweigh a lower merchandise price", () => {
  const result = optimise(
    [{ id: "i", priority: "high" }],
    [c("i", "A", "20"), c("i", "B", "24")],
    [r("A", "8"), r("B", "0")],
    "100",
    2,
  );
  assert.equal(result.best!.total, "24.00");
  assert.equal(result.best!.stores[0].storeId, "B");
});
test("delivery applies once per store and free threshold is inclusive", () => {
  const p = evaluate(
    [c("i", "A", "20"), c("j", "A", "30")],
    [r("A", "8", "0", "50")],
    "100",
    2,
    ["i", "j"],
  );
  assert.equal(p.total, "50.00");
  assert.equal(p.stores[0].delivery, "0.00");
  assert.equal(
    evaluate([c("i", "A", "20"), c("j", "A", "30")], [r("A", "8")], "100", 2, [
      "i",
      "j",
    ]).total,
    "58.00",
  );
});
test("minimum orders store limits and missing coverage mark plans infeasible", () => {
  assert.equal(
    evaluate([c("i", "A", "20")], [r("A", "0", "30")], "100", 2, ["i"])
      .feasible,
    false,
  );
  assert.equal(
    evaluate(
      [c("i", "A", "20"), c("j", "B", "20")],
      [r("A", "0"), r("B", "0")],
      "100",
      1,
      ["i", "j"],
    ).feasible,
    false,
  );
  assert.deepEqual(
    evaluate([c("i", "A", "20")], [r("A", "0")], "100", 2, ["i", "j"]).missing,
    ["j"],
  );
});
test("small optimiser results agree with independent exhaustive assignments", () => {
  const cs = [
    c("i", "A", "2"),
    c("i", "B", "4"),
    c("j", "A", "8"),
    c("j", "B", "3"),
    c("k", "A", "2"),
    c("k", "B", "3"),
  ];
  const rules = [r("A", "4"), r("B", "2")];
  const totals: number[] = [];
  for (const i of cs.filter((c) => c.itemId === "i"))
    for (const j of cs.filter((c) => c.itemId === "j"))
      for (const k of cs.filter((c) => c.itemId === "k"))
        totals.push(
          Number(evaluate([i, j, k], rules, "100", 2, ["i", "j", "k"]).total),
        );
  const result = optimise(
    ["i", "j", "k"].map((id) => ({ id, priority: "normal" })),
    cs,
    rules,
    "100",
    2,
  );
  assert.equal(Number(result.best!.total), Math.min(...totals));
  assert.equal(result.searchComplete, true);
});
test("over-budget proposals defer low priority explicitly and preserve high priority", () => {
  const result = optimise(
    [
      { id: "essential", priority: "high" },
      { id: "optional", priority: "low" },
    ],
    [c("essential", "A", "5"), c("optional", "A", "10")],
    [r("A", "0")],
    "8",
    1,
  );
  assert.equal(result.best!.withinBudget, false);
  assert.deepEqual(result.deferrals[0].deferred, ["optional"]);
  assert.equal(result.deferrals[0].plan.total, "5.00");
});
test("search limits do not claim a proven optimum", () => {
  const result = optimise(
    [{ id: "i", priority: "normal" }],
    [c("i", "A", "2"), c("i", "B", "3")],
    [r("A", "0"), r("B", "0")],
    "100",
    2,
    undefined,
    1,
  );
  assert.equal(result.searchComplete, false);
});

test("unaffordable high-priority items do not trigger recursive deferral generation", () => {
  const items = [
    { id: "essential", priority: "high" },
    ...Array.from({ length: 15 }, (_, i) => ({
      id: "optional" + i,
      priority: "low",
    })),
  ];
  const result = optimise(
    items,
    items.map((i) => c(i.id, "A", i.priority === "high" ? "100" : "1")),
    [r("A", "0")],
    "5",
    1,
  );
  assert.equal(result.deferrals.length, 15);
  assert(
    result.deferrals.every((d) =>
      d.plan.allocations.some((a) => a.itemId === "essential"),
    ),
  );
});
