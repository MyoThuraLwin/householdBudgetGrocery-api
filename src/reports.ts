import { db } from "./db.js";
import { exists } from "./http.js";
import { month } from "./validation.js";
import { D, money, sum, today } from "./domain.js";

export async function variableReports(requested?: unknown) {
  const h = exists(await db.household.findFirst(), "Household");
  const selected = month.parse(requested ?? today(h.timezone).slice(0, 7));
  const start = new Date(selected + "-01T12:00:00Z");
  start.setUTCMonth(start.getUTCMonth() - 3);
  const budgets = await db.budgetMonth.findMany({
    where: { month: { gte: start.toISOString().slice(0, 7), lte: selected } },
    include: { commitments: { include: { transactions: true } } },
    orderBy: { month: "desc" },
  });
  const previous = new Date(selected + "-01T12:00:00Z");
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return ["electricity", "transport"].map((category) => {
    const history = budgets.map((b) => {
      const commitments = b.commitments.filter((c) => c.category === category);
      return {
        month: b.month,
        completed: b.completed && b.month < today(h.timezone).slice(0, 7),
        recorded: commitments.length > 0,
        actual: money(
          sum(commitments.flatMap((c) => c.transactions.map((t) => t.amount))),
        ),
        planned: money(sum(commitments.map((c) => c.planned))),
      };
    });
    const current = history.find((x) => x.month === selected);
    const prior = history.find(
      (x) =>
        x.month === previous.toISOString().slice(0, 7) &&
        x.completed &&
        x.recorded,
    );
    const recent = history.filter(
      (x) => x.month < selected && x.completed && x.recorded,
    );
    const average = recent.length
      ? money(sum(recent.map((x) => x.actual)).div(recent.length))
      : null;
    return {
      category,
      month: selected,
      current: current?.actual ?? null,
      planned: current?.planned ?? null,
      variance: current
        ? money(D(current.actual).minus(current.planned))
        : null,
      previous: prior?.actual ?? null,
      change:
        current && prior ? money(D(current.actual).minus(prior.actual)) : null,
      changePercent:
        current && prior && D(prior.actual).gt(0)
          ? D(current.actual)
              .minus(prior.actual)
              .div(prior.actual)
              .times(100)
              .toFixed(2)
          : null,
      average,
      monthsUsed: recent.length,
      abovePlan: current ? D(current.actual).gt(current.planned) : false,
      aboveAverage: !!(
        current &&
        average &&
        h.alertThreshold !== null &&
        D(current.actual).gt(
          D(average).times(D(h.alertThreshold).div(100).plus(1)),
        )
      ),
      history,
      label:
        selected === today(h.timezone).slice(0, 7)
          ? "Month to date"
          : current?.completed
            ? "Completed month"
            : "Incomplete month",
    };
  });
}
