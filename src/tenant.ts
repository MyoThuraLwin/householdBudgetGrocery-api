import { AsyncLocalStorage } from "node:async_hooks";
import { HttpError } from "./http.js";

export type Identity = {
  userId: string;
  householdId: string;
  role: "household" | "admin";
  sessionId?: string;
};
const identities = new AsyncLocalStorage<Identity>();
export const runAsHousehold = <T>(identity: Identity, work: () => T): T =>
  identities.run(identity, work);
export function currentIdentity(): Identity {
  const identity = identities.getStore();
  if (!identity) throw new HttpError(401, "Sign in to access your household.");
  return identity;
}

const ownedModels = new Set([
  "household",
  "budgetMonth",
  "expenseCommitment",
  "expenseTransaction",
  "inventoryItem",
  "inventoryBatch",
  "inventoryMovement",
  "shoppingList",
  "shoppingListItem",
  "store",
  "product",
  "dataSource",
  "storeListing",
  "priceSnapshot",
  "fulfilmentRule",
  "savedRecord",
  "purchase",
  "purchaseLine",
  "purchaseAdjustment",
]);
const references: Record<string, string> = {
  budgetId: "budgetMonth",
  commitmentId: "expenseCommitment",
  itemId: "inventoryItem",
  batchId: "inventoryBatch",
  listId: "shoppingList",
  inventoryItemId: "inventoryItem",
  productId: "product",
  storeId: "store",
  sourceId: "dataSource",
  listingId: "storeListing",
  purchaseId: "purchase",
  purchaseLineId: "purchaseLine",
};
const reads = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
]);
const mutations = new Set(["update", "updateMany", "delete", "deleteMany"]);

/** Own every root query and nested insert. Foreign IDs are checked with the same transaction client. */
export function scopedClient<T extends object>(client: T): T {
  const delegates = new Map<string, unknown>();
  return new Proxy(client, {
    get(target: any, property: string | symbol) {
      if (typeof property !== "string") return Reflect.get(target, property);
      if (
        [
          "$queryRaw",
          "$queryRawUnsafe",
          "$executeRaw",
          "$executeRawUnsafe",
          "$extends",
        ].includes(property)
      )
        throw new HttpError(
          403,
          "Raw database access must use an explicitly authorised system service.",
        );
      if (property === "$transaction")
        return (work: unknown, options?: unknown) => {
          currentIdentity();
          if (typeof work !== "function")
            throw new HttpError(403, "Use a scoped transaction callback.");
          return target.$transaction(
            (tx: object) => work(scopedClient(tx)),
            options,
          );
        };
      if (["user", "authSession", "adminAudit"].includes(property))
        throw new HttpError(
          403,
          "Account access must use the authentication or admin service.",
        );
      if (!ownedModels.has(property)) {
        const value = Reflect.get(target, property, target);
        if (
          value &&
          typeof value === "object" &&
          typeof value.findMany === "function"
        )
          throw new HttpError(
            403,
            "This model needs an explicit household access policy.",
          );
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (delegates.has(property)) return delegates.get(property);
      const delegate = new Proxy(target[property], {
        get(model: any, operation: string) {
          const original = model[operation];
          if (typeof original !== "function") return original;
          return async (input: any = {}) => {
            const { householdId } = currentIdentity();
            if (
              !reads.has(operation) &&
              !mutations.has(operation) &&
              !["create", "createMany"].includes(operation)
            )
              throw new HttpError(
                403,
                "This database operation needs an explicit household access policy.",
              );
            const owner =
              property === "household" ? { id: householdId } : { householdId };
            const args = { ...input };
            if (reads.has(operation) || mutations.has(operation))
              args.where = { ...args.where, ...owner };
            if (operation === "create" || operation === "createMany") {
              if (property === "household")
                throw new HttpError(
                  403,
                  "Create households through registration.",
                );
              args.data = await prepare(args.data, true);
            } else if (operation === "update" || operation === "updateMany")
              args.data = await prepare(args.data, false);
            else if (
              operation === "upsert" ||
              operation === "createManyAndReturn" ||
              operation === "updateManyAndReturn"
            )
              throw new HttpError(
                403,
                "Use a household-scoped create or update operation.",
              );
            return original.call(model, args);

            async function prepare(data: any, creating: boolean): Promise<any> {
              if (Array.isArray(data))
                return Promise.all(
                  data.map((value) => prepare(value, creating)),
                );
              if (!data || typeof data !== "object") return data;
              const result = { ...data };
              if ("householdId" in result && result.householdId !== householdId)
                throw new HttpError(404, "Related record was not found.");
              if (creating) result.householdId = householdId;
              for (const [field, value] of Object.entries(data)) {
                if (
                  references[field] &&
                  value !== null &&
                  value !== undefined
                ) {
                  if (typeof value !== "string")
                    throw new HttpError(
                      422,
                      "Related identifiers must be strings.",
                    );
                  const related = await target[references[field]].findFirst({
                    where: { id: value, householdId },
                    select: { id: true },
                  });
                  if (!related)
                    throw new HttpError(404, "Related record was not found.");
                }
                if (
                  value &&
                  typeof value === "object" &&
                  !Array.isArray(value)
                ) {
                  const nested = value as any;
                  if ("create" in nested)
                    result[field] = {
                      ...nested,
                      create: await prepare(nested.create, true),
                    };
                  if ("createMany" in nested)
                    result[field] = {
                      ...nested,
                      createMany: {
                        ...nested.createMany,
                        data: await prepare(nested.createMany.data, true),
                      },
                    };
                  if (
                    [
                      "connect",
                      "connectOrCreate",
                      "upsert",
                      "update",
                      "updateMany",
                      "delete",
                      "deleteMany",
                      "set",
                    ].some((key) => key in nested)
                  )
                    throw new HttpError(
                      403,
                      "Nested relation changes must use their household-scoped service.",
                    );
                }
              }
              return result;
            }
          };
        },
      });
      delegates.set(property, delegate);
      return delegate;
    },
  });
}
