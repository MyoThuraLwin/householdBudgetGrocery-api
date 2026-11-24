import type { Express } from "express";
import { z } from "zod";
import { parse } from "csv-parse/sync";
import { db, transaction } from "./db.js";
import {
  endpoint,
  assert,
  exists,
  checkRevision,
  key,
  paging,
} from "./http.js";
import { priceRowSchema, revision, type PriceRow } from "./validation.js";
import {
  normalise,
  packCost,
  units,
  type Unit,
  type Candidate,
} from "./domain.js";
import { save, record, replace } from "./records.js";
import { getList, touchList, validateProduct } from "./inventory.js";

export const importHeaders = [
  "source",
  "observedAt",
  "store",
  "retailer",
  "location",
  "sku",
  "name",
  "category",
  "packageQuantity",
  "unit",
  "price",
  "availability",
  "brand",
];
export async function catalogue(tx: any = db) {
  const listings = await tx.storeListing.findMany({
    include: {
      product: true,
      store: true,
      prices: {
        include: { source: true },
        orderBy: [{ observedAt: "desc" }, { importedAt: "desc" }],
        take: 1,
      },
    },
    orderBy: { id: "asc" },
  });
  return listings.map((l: any) => {
    const p = l.prices[0];
    const baseUnit = units[l.unit as Unit].base;
    const unitPrice = p
      ? packCost(
          "1",
          baseUnit,
          l.packageQuantity.toString(),
          l.unit,
          p.price.toString(),
        ).unitPrice
      : null;
    return {
      ...l,
      prices: undefined,
      unitPrice,
      baseUnit,
      price: p ? p.price.toString() : null,
      snapshotId: p?.id,
      source: p?.source.name,
      sourceId: p?.source.id,
      availability: p?.availability ?? "unknown",
      observedAt: p?.observedAt,
      stale: p
        ? Date.now() - p.observedAt.getTime() >
          p.source.freshnessDays * 86400000
        : true,
      promotion: p?.promotion ?? "",
    };
  });
}
export async function candidatesFor(
  list: any,
  tx: any = db,
  allowStale = false,
  allowUnknown = false,
): Promise<Candidate[]> {
  const listings = await catalogue(tx);
  const candidates: Candidate[] = [];
  for (const i of list.items)
    for (const l of listings) {
      if (
        !i.productId ||
        i.productId !== l.productId ||
        normalise(i.category) !== normalise(l.product.category) ||
        !l.store.active ||
        l.price === null ||
        l.availability === "unavailable" ||
        (!allowUnknown && l.availability === "unknown") ||
        (!allowStale && l.stale) ||
        l.promotion.startsWith("conditional:")
      )
        continue;
      try {
        const p = packCost(
          i.quantity,
          i.unit,
          l.packageQuantity,
          l.unit,
          l.price,
        );
        candidates.push({
          itemId: i.id,
          inventoryItemId: i.inventoryItemId,
          productId: l.productId,
          listingId: l.id,
          snapshotId: l.snapshotId,
          storeId: l.storeId,
          storeName: l.store.name,
          name: l.product.name,
          category: l.product.category,
          quantity: i.quantity.toString(),
          unit: i.unit,
          ...p,
          price: l.price,
          source: l.source,
          observedAt: l.observedAt.toISOString(),
          stale: l.stale,
          uncertain: l.availability === "unknown",
        });
      } catch {
        /* Incompatible dimensions remain unmatched. */
      }
    }
  return candidates;
}
export async function commitRows(rows: PriceRow[], tx: any) {
  let imported = 0,
    duplicates = 0;
  for (const row of rows) {
    const source = exists(
      await tx.dataSource.findFirst({ where: { name: row.source } }),
      `Data source ${row.source}`,
    );
    let store = await tx.store.findFirst({
      where: {
        name: row.store,
        retailer: row.retailer,
        location: row.location,
      },
    });
    if (!store)
      store = await tx.store.create({
        data: {
          name: row.store,
          retailer: row.retailer,
          location: row.location,
        },
      });
    let product = row.barcode
      ? await tx.product.findFirst({ where: { barcode: row.barcode } })
      : null;
    if (!product)
      product = await tx.product.findFirst({
        where: {
          normalisedName: normalise(row.name),
          brand: row.brand,
          category: row.category,
        },
      });
    if (!product)
      product = await tx.product.create({
        data: {
          name: row.name,
          normalisedName: normalise(row.name),
          category: row.category,
          brand: row.brand,
          barcode: row.barcode,
        },
      });
    let listing = await tx.storeListing.findUnique({
      where: { storeId_sku: { storeId: store.id, sku: row.sku } },
    });
    if (!listing)
      listing = await tx.storeListing.create({
        data: {
          storeId: store.id,
          productId: product.id,
          sku: row.sku,
          packageQuantity: row.packageQuantity,
          unit: row.unit,
        },
      });
    assert(
      listing.productId === product.id &&
        listing.packageQuantity.eq(row.packageQuantity) &&
        listing.unit === row.unit,
      `SKU ${row.sku} has conflicting product or pack details. Use a distinct SKU for a different package.`,
    );
    const observedAt = new Date(row.observedAt);
    const existing = await tx.priceSnapshot.findUnique({
      where: {
        listingId_sourceId_observedAt: {
          listingId: listing.id,
          sourceId: source.id,
          observedAt,
        },
      },
    });
    if (existing) {
      assert(
        existing.price.eq(row.price) &&
          existing.availability === row.availability &&
          existing.promotion === row.promotion,
        `Conflicting snapshot for ${row.sku}.`,
      );
      duplicates++;
      continue;
    }
    await tx.priceSnapshot.create({
      data: {
        listingId: listing.id,
        sourceId: source.id,
        observedAt,
        price: row.price,
        availability: row.availability,
        promotion: row.promotion,
      },
    });
    imported++;
  }
  return { imported, duplicates };
}
export function catalogueRoutes(app: Express) {
  const e = endpoint.bind(null, app);
  e("get", "/stores", "Available store definitions", undefined, async (req) =>
    db.store.findMany({
      ...paging(req),
      orderBy: { name: "asc" },
      include: { rules: true },
    }),
  );
  e(
    "post",
    "/stores",
    "Add a store definition",
    z.object({
      name: z.string().min(1).max(120),
      retailer: z.string().min(1).max(100),
      location: z.string().max(120).default(""),
    }),
    async (_, b) => db.store.create({ data: b }),
  );
  e(
    "get",
    "/products",
    "Catalogue products and current price observations",
    undefined,
    async (req) => {
      const all = await catalogue();
      const q = normalise(String(req.query.q ?? ""));
      return all
        .filter((p: any) => normalise(p.product.name).includes(q))
        .slice(paging(req).skip, paging(req).skip + paging(req).take);
    },
  );
  e(
    "get",
    "/products/:id/prices",
    "Price snapshot history for a product",
    undefined,
    async (req) =>
      db.priceSnapshot.findMany({
        where: { listing: { productId: req.params.id } },
        include: { source: true, listing: { include: { store: true } } },
        orderBy: { observedAt: "desc" },
        ...paging(req),
      }),
  );
  e("get", "/data-sources", "Data source registry", undefined, async () =>
    db.dataSource.findMany(),
  );
  e(
    "post",
    "/data-sources",
    "Register permitted or user-supplied data",
    z.object({
      name: z.string().trim().min(1).max(120),
      type: z.enum([
        "fixture",
        "user",
        "licensed",
        "official",
        "authorised-api",
      ]),
      permission: z.string().trim().min(1).max(1000),
      freshnessDays: z.number().int().min(1).max(365).default(7),
    }),
    async (_, b) => db.dataSource.create({ data: b }),
  );
  e(
    "get",
    "/price-imports/template",
    "CSV or JSON import template",
    undefined,
    async (req) =>
      req.query.format === "json"
        ? {
            rows: [
              {
                source: "My permitted dataset",
                observedAt: new Date().toISOString(),
                store: "Selected store",
                retailer: "Retailer",
                location: "Auckland",
                sku: "milk-2l",
                name: "Milk",
                category: "Dairy",
                packageQuantity: "2",
                unit: "l",
                price: "4.50",
                availability: "available",
                brand: "",
              },
            ],
          }
        : { csv: importHeaders.join(",") + "\n" },
  );
  e(
    "post",
    "/price-imports/preview",
    "Validate CSV or JSON without importing",
    z.object({
      format: z.enum(["csv", "json"]),
      content: z.string().min(1).max(2000000),
    }),
    async (_, b) => {
      let raw: unknown[];
      try {
        raw =
          b.format === "csv"
            ? parse(b.content, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
                bom: true,
              })
            : JSON.parse(b.content);
      } catch {
        assert(false, "File could not be parsed as the selected format.");
      }
      assert(
        Array.isArray(raw) && raw.length > 0 && raw.length <= 1000,
        "Import between 1 and 1,000 rows.",
      );
      const sources = await db.dataSource.findMany();
      const rows: PriceRow[] = [],
        errors: { row: number; message: string }[] = [];
      const identities = new Map<string, string>();
      for (const [i, input] of raw.entries()) {
        const parsed = priceRowSchema.safeParse(input);
        if (!parsed.success) {
          errors.push({
            row: i + 1,
            message: parsed.error.issues
              .map((x) => `${x.path.join(".")}: ${x.message}`)
              .join("; "),
          });
          continue;
        }
        const row = parsed.data;
        if (!sources.some((s) => s.name === row.source))
          errors.push({
            row: i + 1,
            message: `Register data source '${row.source}' with permission notes first.`,
          });
        if (new Date(row.observedAt).getTime() > Date.now() + 60000)
          errors.push({
            row: i + 1,
            message: "Observation time cannot be in the future.",
          });
        const identity = [
          row.source,
          row.store,
          row.retailer,
          row.location,
          row.sku,
          new Date(row.observedAt).toISOString(),
        ].join("|");
        const content = JSON.stringify(row);
        if (identities.has(identity) && identities.get(identity) !== content)
          errors.push({ row: i + 1, message: "Conflicting duplicate row." });
        identities.set(identity, content);
        rows.push(row);
      }
      return save("import", {
        rows,
        errors,
        count: raw.length,
        committed: false,
      });
    },
  );
  e(
    "get",
    "/price-imports/:id",
    "Read import validation report",
    undefined,
    async (req) => record(req.params.id, "import"),
  );
  e(
    "post",
    "/price-imports/:id/commit",
    "Atomically commit validated price snapshots",
    z.object({ revision }),
    async (req, b) =>
      transaction(async (tx) => {
        const p = await record(req.params.id, "import", tx);
        const token = key(req);
        if (p.committed) {
          assert(p.key === token, "Import already committed.", 409);
          return p;
        }
        checkRevision(p, b.revision);
        assert(
          !p.errors.length,
          "Resolve all validation errors before importing.",
        );
        const result = await commitRows(p.rows, tx);
        return replace(p.id, { ...p, committed: true, key: token, result }, tx);
      }),
  );
  e(
    "post",
    "/product-matches/preview",
    "Find candidate products without silently matching",
    z.object({ listItemId: z.string() }),
    async (_, b) => {
      const item = exists(
        await db.shoppingListItem.findUnique({ where: { id: b.listItemId } }),
      );
      const products = await db.product.findMany({
        where: { category: item.category },
        include: { listings: true },
      });
      return products
        .map((p) => ({
          ...p,
          confidence:
            normalise(p.name) === normalise(item.name)
              ? "exact-name"
              : "review-required",
          confirmed: item.productId === p.id,
        }))
        .sort((a, b) => a.confidence.localeCompare(b.confidence));
    },
  );
  e(
    "post",
    "/product-matches/confirm",
    "Confirm compatible product for list item",
    z.object({ listItemId: z.string(), productId: z.string(), revision }),
    async (_, b) =>
      transaction(async (tx) => {
        const i: any = exists(
          await tx.shoppingListItem.findUnique({
            where: { id: b.listItemId },
            include: { list: true },
          }),
        );
        checkRevision(i.list, b.revision);
        await validateProduct(b.productId, i.category, i.unit, tx);
        const result = await tx.shoppingListItem.update({
          where: { id: i.id },
          data: { productId: b.productId },
        });
        await touchList(i.listId, tx);
        return result;
      }),
  );
  e(
    "post",
    "/price-comparisons",
    "Quantity-aware prices for a matched shopping list",
    z.object({
      listId: z.string(),
      allowStale: z.boolean().default(false),
      allowUnknown: z.boolean().default(false),
    }),
    async (_, b) => {
      const l = await getList(b.listId);
      const candidates = await candidatesFor(
        l,
        db,
        b.allowStale,
        b.allowUnknown,
      );
      return {
        candidates,
        unmatched: l.items.filter(
          (i: any) => !candidates.some((c) => c.itemId === i.id),
        ),
      };
    },
  );
}
