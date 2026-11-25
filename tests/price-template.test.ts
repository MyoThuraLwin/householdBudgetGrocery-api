import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { priceTemplate } from "../src/price-template.js";
import { priceRowSchema } from "../src/validation.js";
import { priceDateInstant } from "../src/price-date.js";

test("download templates round-trip through both import formats with ten valid multi-store records", () => {
  const priceDate = "2026-11-26";
  const { rows, csv } = priceTemplate("My permitted dataset", priceDate);
  const csvRows = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  const jsonRows = JSON.parse(JSON.stringify(rows));
  assert.deepEqual(csvRows, jsonRows);
  assert.equal(rows.length, 10);
  assert.equal(new Set(rows.map((row) => row.retailer)).size, 2);
  assert.equal(new Set(rows.map((row) => row.store)).size, 2);
  assert.equal(new Set(rows.map((row) => row.name)).size, 5);
  for (const row of csvRows) {
    assert.equal(
      priceRowSchema.safeParse(row).success,
      true,
      JSON.stringify(row),
    );
    assert.equal(row.source, "My permitted dataset");
    assert.equal(row.priceDate, priceDate);
    assert(!Object.hasOwn(row, "observedAt"));
    assert(!Object.hasOwn(row, "availability"));
    assert.equal(priceRowSchema.parse(row).availability, "unknown");
  }
  // Repeated products at different stores must have distinct snapshot identities.
  assert.equal(
    new Set(rows.map((row) => `${row.store}|${row.sku}|${row.priceDate}`)).size,
    10,
  );
  assert.equal(new Set(rows.map((row) => row.unit)).size, 4);
});

test("CSV preserves a selected source containing commas, quotes and newlines", () => {
  const source = 'Research, "permitted"\nDataset';
  const { rows, csv } = priceTemplate(source);
  const parsed = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  assert.deepEqual(parsed, rows);
  assert.equal(rows[0].source, source);
  assert.match(rows[0].priceDate, /^\d{4}-\d{2}-\d{2}$/);
  assert(
    new Date(priceRowSchema.parse(rows[0]).observedAt).getTime() <= Date.now(),
  );
});

test("simple New Zealand price dates retain their calendar day across daylight saving changes", () => {
  const row = priceTemplate("Test", "2026-11-26").rows[0];
  for (const [date, timestamp] of [
    ["2026-04-05", "2026-04-04T11:00:00.000Z"],
    ["2026-04-06", "2026-04-05T12:00:00.000Z"],
    ["2026-09-27", "2026-09-26T12:00:00.000Z"],
    ["2026-09-28", "2026-09-27T11:00:00.000Z"],
  ]) {
    assert.equal(priceDateInstant(date), timestamp);
    assert.equal(
      priceRowSchema.parse({ ...row, priceDate: date }).observedAt,
      timestamp,
    );
  }
  assert.equal(
    priceRowSchema.parse({ ...row, priceDate: "26/11/2026" }).observedAt,
    "2026-11-25T11:00:00.000Z",
  );
  for (const date of [
    "2026-02-30",
    "31/04/2026",
    "11-26-2026",
    "",
    "not a date",
  ])
    assert.equal(
      priceRowSchema.safeParse({ ...row, priceDate: date }).success,
      false,
    );
  const { priceDate: _, ...legacy } = row;
  const observedAt = "2026-11-26T09:23:00+13:00";
  assert.equal(
    priceRowSchema.parse({ ...legacy, observedAt, availability: "available" })
      .observedAt,
    observedAt,
  );
  assert.equal(priceRowSchema.safeParse(legacy).success, false);
  assert.equal(priceRowSchema.safeParse({ ...row, observedAt }).success, false);
});

test("optional stock states are explicit and custom categories remain supported", () => {
  const row = priceTemplate("Test", "2026-11-26").rows[0];
  for (const [input, expected] of [
    [undefined, "unknown"],
    ["", "unknown"],
    [" Available ", "available"],
    ["not available", "unavailable"],
    ["unavailable", "unavailable"],
    ["unknown", "unknown"],
  ])
    assert.equal(
      priceRowSchema.parse({ ...row, availability: input }).availability,
      expected,
    );
  assert.equal(
    priceRowSchema.safeParse({ ...row, availability: "yes" }).success,
    false,
  );
  assert.equal(
    priceRowSchema.parse({ ...row, category: "Frozen food" }).category,
    "Frozen food",
  );
});
