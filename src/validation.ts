import { z } from "zod";
import { priceDateInstant, priceDateSchema } from "./price-date.js";
export const amount = z
  .string()
  .regex(
    /^\d{1,12}(\.\d{1,2})?$/,
    "Use a nonnegative decimal amount with at most 2 decimal places.",
  );
export const quantity = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0, "Quantity must be positive.");
export const date = z.iso.date();
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const unit = z.enum(["g", "kg", "ml", "l", "each"]);
export const id = z.string().min(1).max(100);
export const revision = z.number().int().positive();
export const category = z.enum([
  "accommodation",
  "electricity",
  "internet",
  "phone",
  "transport",
  "other",
]);
export const itemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(60),
  unit,
  minimum: quantity.or(z.literal("0")).default("0"),
  productId: id.nullable().optional(),
});
export const listItemSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(60),
  quantity,
  unit,
  priority: z.enum(["high", "normal", "low"]).default("normal"),
  inventoryItemId: id.nullable().optional(),
  productId: id.nullable().optional(),
  origin: z.enum(["manual", "generated", "assistant"]).default("manual"),
});
export const purchaseLineSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().min(1).max(60),
  quantity,
  unit,
  lineCost: amount,
  inventoryItemId: id.nullable().optional(),
  productId: id.nullable().optional(),
  expiryDate: date.nullable().optional(),
});
export const priceRowSchema = z
  .object({
    source: z.string().trim().min(1).max(120),
    priceDate: priceDateSchema.optional(),
    observedAt: z.iso.datetime({ offset: true }).optional(),
    store: z.string().trim().min(1).max(120),
    retailer: z.string().max(100).default("User supplied"),
    location: z.string().max(120).default(""),
    sku: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(60),
    packageQuantity: quantity,
    unit,
    price: amount,
    availability: z.preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        const status = value.trim().toLowerCase();
        return status === "not available" ? "unavailable" : status || undefined;
      },
      z.enum(["available", "unavailable", "unknown"]).default("unknown"),
    ),
    brand: z.string().max(100).default(""),
    barcode: z.string().max(40).nullable().optional(),
    promotion: z.string().max(200).default(""),
  })
  .superRefine((row, context) => {
    if (!row.priceDate && !row.observedAt)
      context.addIssue({
        code: "custom",
        path: ["priceDate"],
        message: "Enter the date the price was checked, e.g. 2026-11-26.",
      });
    if (row.priceDate && row.observedAt)
      context.addIssue({
        code: "custom",
        path: ["priceDate"],
        message:
          "Use either priceDate or the legacy observedAt timestamp, not both.",
      });
  })
  .transform(({ priceDate, observedAt, ...row }) => ({
    ...row,
    observedAt: observedAt ?? priceDateInstant(priceDate!),
  }));
export type PriceRow = z.infer<typeof priceRowSchema>;
