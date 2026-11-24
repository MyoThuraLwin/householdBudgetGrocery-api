import { parse } from "csv-parse/sync";
import { priceRowSchema, type PriceRow } from "./validation.js";
import { normalise } from "./domain.js";

/** Authorised network providers must implement this contract; no scraping adapter is included. */
export interface GroceryProvider {
  readonly source: string;
  search(query: string): Promise<PriceRow[]>;
  prices(store: string): Promise<PriceRow[]>;
}
export class FileProvider implements GroceryProvider {
  private rows: PriceRow[];
  constructor(
    readonly source: string,
    content: string,
    format: "csv" | "json",
  ) {
    const parsed =
      format === "csv"
        ? parse(content, { columns: true, skip_empty_lines: true, trim: true })
        : JSON.parse(content);
    this.rows = priceRowSchema.array().parse(parsed);
  }
  async search(query: string) {
    return this.rows.filter((r) =>
      normalise(r.name).includes(normalise(query)),
    );
  }
  async prices(store: string) {
    return this.rows.filter((r) => r.store === store);
  }
}
