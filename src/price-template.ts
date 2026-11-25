export const importHeaders = [
  "source",
  "priceDate",
  "store",
  "retailer",
  "location",
  "sku",
  "name",
  "category",
  "packageQuantity",
  "unit",
  "price",
  "brand",
] as const;

// Fictional examples only: five matching products at two example supermarkets.
// Generate a simple New Zealand calendar date. Optional stock status is confirmed
// once during upload, rather than being repeated in every row of the template.
export function priceTemplate(
  source = "My permitted dataset",
  priceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()),
) {
  const products = [
    {
      sku: "milk-2l",
      name: "Sample whole milk",
      category: "Dairy",
      packageQuantity: "2",
      unit: "l",
      prices: ["4.50", "4.80"],
    },
    {
      sku: "bread-700g",
      name: "Sample wholemeal bread",
      category: "Pantry",
      packageQuantity: "700",
      unit: "g",
      prices: ["3.20", "3.00"],
    },
    {
      sku: "rice-1kg",
      name: "Sample long grain rice",
      category: "Pantry",
      packageQuantity: "1",
      unit: "kg",
      prices: ["2.90", "3.10"],
    },
    {
      sku: "eggs-12",
      name: "Sample eggs",
      category: "Egg",
      packageQuantity: "12",
      unit: "each",
      prices: ["7.20", "6.90"],
    },
    {
      sku: "apples-1kg",
      name: "Sample apples",
      category: "Fruit",
      packageQuantity: "1",
      unit: "kg",
      prices: ["3.80", "4.20"],
    },
  ];
  const rows = ["Example Supermarket A", "Example Supermarket B"].flatMap(
    (retailer, index) =>
      products.map(({ prices, ...product }) => ({
        source,
        priceDate,
        store: `${retailer} - Central`,
        retailer,
        location: "Auckland (example location)",
        ...product,
        price: prices[index],
        brand: "Example Brand",
      })),
  );
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv =
    [
      importHeaders.join(","),
      ...rows.map((row) =>
        importHeaders.map((header) => quote(row[header])).join(","),
      ),
    ].join("\r\n") + "\r\n";
  return { rows, csv };
}
