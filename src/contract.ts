import { z } from "zod";
import { routes } from "./http.js";

// These wire schemas are the frontend's authoritative read models. Prisma models stay private.
const text = z.string();
const nullable = text.nullable();
const n = z.number();
const Summary = z.object({
  budgetId: text,
  month: text,
  revision: n,
  funds: text,
  reserve: text,
  planned: text,
  actual: text,
  outstanding: text,
  grocerySpending: text,
  plannedGroceryLimit: text,
  adjustedGroceryLimit: text,
  remaining: text,
});
const Batch = z.looseObject({
  id: text,
  revision: n,
  quantity: text,
  acquiredOn: text,
  expiryDate: nullable,
  dateLabel: text,
  status: text,
});
const Inventory = z.looseObject({
  id: text,
  revision: n,
  name: text,
  category: text,
  unit: text,
  minimum: text,
  productId: nullable,
  usable: text,
  needed: text,
  batches: z.array(Batch),
});
const ListItem = z.object({
  id: text,
  listId: text,
  name: text,
  category: text,
  quantity: text,
  unit: text,
  priority: text,
  origin: text,
  productId: nullable,
  inventoryItemId: nullable,
});
const List = z.object({
  id: text,
  name: text,
  revision: n,
  householdId: text,
  createdAt: text,
  items: z.array(ListItem),
});
const Household = z.object({
  id: text,
  name: text,
  revision: n,
  timezone: text,
  location: text,
  expiryWindowDays: n,
  averageMonths: n,
  maxStores: n,
  singleStore: z.boolean(),
  reserveDefault: text,
  alertThreshold: nullable,
  preferences: text,
  updatedAt: text,
});
const Budget = z.looseObject({
  id: text,
  month: text,
  funds: text,
  reserve: text,
  completed: z.boolean(),
  revision: n,
});
const ExpenseTransaction = z.looseObject({
  id: text,
  revision: n,
  amount: text,
  incurredOn: text,
  note: text,
});
const Commitment = z.looseObject({
  id: text,
  budgetId: text,
  revision: n,
  category: text,
  subcategory: text,
  description: text,
  frequency: z.enum(["monthly", "weekly"]),
  inputAmount: nullable.describe(
    "Original input; null on legacy monthly records, where planned is the input.",
  ),
  planned: text.describe(
    "Monthly planned amount, including calendar-day conversion for weekly input.",
  ),
  outstanding: text.describe(
    "Remaining monthly reserve; never a weekly amount.",
  ),
  recurring: z.boolean(),
  settlement: z.enum(["unpaid", "partial", "settled"]),
});
const BudgetDetail = Budget.extend({
  commitments: z.array(
    Commitment.extend({
      actualTotal: text,
      transactions: z.array(ExpenseTransaction),
    }),
  ),
});
const User = z.object({
  id: text,
  householdId: text,
  email: text,
  name: text,
  role: z.enum(["household", "admin"]),
  active: z.boolean(),
  demo: z.boolean(),
  revision: n,
  createdAt: text,
});
const AuthResult = z.object({ user: User, accessToken: text, expiresIn: n });
const schemas = {
  Summary,
  Inventory,
  List,
  ListItem,
  Household,
  Budget,
  BudgetDetail,
  Commitment,
  User,
  AuthResult,
};
export function openapi() {
  const paths: Record<string, any> = {};
  for (const r of routes) {
    const path = "/api/v1" + r.path.replace(/:([A-Za-z]+)/g, "{$1}");
    paths[path] ??= {};
    const parameters: any[] = [...r.path.matchAll(/:([A-Za-z]+)/g)].map(
      (m) => ({
        name: m[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      }),
    );
    if (
      /confirm|\/commit$|adjustments|suggestions.*\/apply/.test(r.path) &&
      r.method === "post"
    )
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string" },
      });
    if (r.method === "get")
      parameters.push(
        { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
        {
          name: "pageSize",
          in: "query",
          schema: { type: "integer", minimum: 1, maximum: 500 },
        },
      );
    let responseSchema: any = {};
    if (r.path === "/auth/me")
      responseSchema = { $ref: "#/components/schemas/User" };
    if (["/auth/login", "/auth/register", "/auth/refresh"].includes(r.path))
      responseSchema = { $ref: "#/components/schemas/AuthResult" };
    if (r.method === "get" && r.path === "/household")
      responseSchema = { $ref: "#/components/schemas/Household" };
    if (r.method === "get" && r.path.endsWith("/summary"))
      responseSchema = { $ref: "#/components/schemas/Summary" };
    if (r.method === "get" && r.path === "/budgets/:id")
      responseSchema = { $ref: "#/components/schemas/BudgetDetail" };
    if (
      (r.method === "post" && r.path === "/budgets/:id/commitments") ||
      (r.method === "patch" && r.path === "/commitments/:id")
    )
      responseSchema = { $ref: "#/components/schemas/Commitment" };
    for (const [p, schema] of [
      ["/budgets", "Budget"],
      ["/inventory/items", "Inventory"],
      ["/shopping-lists", "List"],
    ])
      if (r.method === "get" && r.path === p)
        responseSchema = {
          type: "array",
          items: { $ref: `#/components/schemas/${schema}` },
        };
    paths[path][r.method] = {
      summary: r.summary,
      security:
        r.path === "/health" ||
        ["/auth/register", "/auth/login", "/auth/logout"].includes(r.path)
          ? []
          : r.path === "/auth/refresh"
            ? [{ RefreshCookie: [] }]
            : [{ BearerAuth: [] }],
      ...(r.path.startsWith("/admin/")
        ? { tags: ["Administration"], "x-required-role": "admin" }
        : {}),
      operationId: r.method + r.path.replace(/[^a-zA-Z0-9]/g, "_"),
      parameters,
      ...(r.body
        ? {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(r.body, {
                    target: "draft-2020-12",
                    unrepresentable: "any",
                    io: "input",
                  }),
                },
              },
            },
          }
        : {}),
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: responseSchema } },
        },
        "422": { description: "Validation failed" },
        "401": { description: "Authentication required or session revoked" },
        "403": {
          description: "Administrator access or trusted origin required",
        },
        "429": { description: "Authentication rate limit reached" },
        "409": { description: "Revision, state or idempotency conflict" },
        "503": { description: "Database or optional AI unavailable" },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Household Budget and Grocery API", version: "0.1.0" },
    servers: [{ url: "http://localhost:4000" }],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        RefreshCookie: {
          type: "apiKey",
          in: "cookie",
          name: "homewise_refresh",
        },
      },
      schemas: Object.fromEntries(
        Object.entries(schemas).map(([name, schema]) => [
          name,
          z.toJSONSchema(schema, { target: "draft-2020-12" }),
        ]),
      ),
    },
  };
}
