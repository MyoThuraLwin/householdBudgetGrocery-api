import { transaction } from "../src/db.js";
import { runAsHousehold } from "../src/tenant.js";
import { commitRows } from "../src/catalogue.js";
import { today } from "../src/domain.js";

export async function demoHousehold(
  user: { id: string; householdId: string; role: string },
  index: number,
) {
  return runAsHousehold(
    {
      userId: user.id,
      householdId: user.householdId,
      role: user.role as "admin" | "household",
    },
    () =>
      transaction(async (tx) => {
        // A marker list makes this seed additive and safe to rerun; existing records are never reset.
        if (
          await tx.shoppingList.findFirst({
            where: { name: "Role demo essentials" },
          })
        )
          return;
        const h = await tx.household.findFirst();
        const current = today(h.timezone);
        const month = current.slice(0, 7);
        let budget = await tx.budgetMonth.findFirst({ where: { month } });
        if (!budget) {
          budget = await tx.budgetMonth.create({
            data: {
              householdId: h.id,
              month,
              funds: ["4000", "4600", "3200"][index],
              reserve: "200",
            },
          });
          for (const [description, category, planned] of [
            ["Accommodation", "accommodation", "1500"],
            ["Electricity", "electricity", "200"],
            ["Internet", "internet", "80"],
            ["Phone", "phone", "60"],
            ["Transport", "transport", "200"],
          ])
            await tx.expenseCommitment.create({
              data: {
                budgetId: budget.id,
                description,
                category,
                planned,
                outstanding: planned,
              },
            });
        }
        const source = "Role demo fixtures";
        await tx.dataSource.create({
          data: {
            name: source,
            type: "fixture",
            permission:
              "Fictional prices for local authentication and role testing.",
          },
        });
        const definitions = [
          ["Demo milk", "Dairy", "2", "l", "4.80"],
          ["Demo rice", "Pantry", "1", "kg", "3.00"],
          ["Demo eggs", "Dairy", "12", "each", "8.00"],
        ];
        for (const [storeIndex, store] of [
          "Practice Pantry",
          "Practice Market",
        ].entries()) {
          await commitRows(
            definitions.map(
              ([name, category, packageQuantity, unit, price]) => ({
                source,
                observedAt: new Date().toISOString(),
                store,
                retailer: "Fictional demo",
                location: h.location || "Auckland",
                sku: name.replaceAll(" ", "-"),
                name,
                category,
                packageQuantity,
                unit,
                price: (Number(price) + storeIndex * 0.3).toFixed(2),
                availability: "available",
                brand: "Demo",
                promotion: "",
              }),
            ) as any,
            tx,
          );
          const s = await tx.store.findFirst({ where: { name: store } });
          for (const mode of ["pickup", "delivery"])
            await tx.fulfilmentRule.create({
              data: {
                storeId: s.id,
                mode,
                minimum: "0",
                delivery: mode === "pickup" ? "0" : storeIndex ? "2" : "5",
                freeThreshold: "80",
                travel: mode === "pickup" ? "1" : "0",
                source: "Fictional role demo assumption",
              },
            });
        }
        const list = await tx.shoppingList.create({
          data: { householdId: h.id, name: "Role demo essentials" },
        });
        for (const [name, category, , unit] of definitions) {
          const p = await tx.product.findFirst({ where: { name } });
          const minimum = name.includes("eggs") ? "12" : "2";
          const item = await tx.inventoryItem.create({
            data: {
              householdId: h.id,
              name,
              category,
              unit,
              minimum,
              productId: p.id,
            },
          });
          const expiry = new Date(current + "T12:00:00Z");
          expiry.setUTCDate(
            expiry.getUTCDate() +
              (name.includes("milk") ? 3 : name.includes("rice") ? -1 : 14),
          );
          await tx.inventoryBatch.create({
            data: {
              itemId: item.id,
              quantity: name.includes("eggs") ? "4" : "0.5",
              acquiredOn: current,
              expiryDate: expiry.toISOString().slice(0, 10),
              movements: {
                create: {
                  quantity: name.includes("eggs") ? "4" : "0.5",
                  reason: "Fictional demo opening stock",
                },
              },
            },
          });
          await tx.shoppingListItem.create({
            data: {
              listId: list.id,
              inventoryItemId: item.id,
              productId: p.id,
              name,
              category,
              quantity: minimum,
              unit,
              priority: name.includes("milk") ? "high" : "normal",
            },
          });
        }
      }),
  );
}
