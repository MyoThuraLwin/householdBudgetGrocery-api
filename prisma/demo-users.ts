import { pathToFileURL } from "node:url";
import { systemDb } from "../src/db.js";
import { hashPassword } from "../src/passwords.js";
import { demoHousehold } from "./demo-data.js";

export const DEMO_PASSWORD = "HomewiseDemo!2026";
export const demoAccounts = [
  {
    email: "admin@homewise.demo",
    name: "Demo administrator",
    role: "admin",
    householdName: "Administrator household",
  },
  {
    email: "alice@homewise.demo",
    name: "Alice Taylor",
    role: "household",
    householdName: "Alice household",
  },
  {
    email: "ben@homewise.demo",
    name: "Ben Morgan",
    role: "household",
    householdName: "Ben household",
  },
] as const;
export async function seedDemoUsers() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo users can only be seeded in development.");
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const [index, account] of demoAccounts.entries()) {
    let user = await systemDb.user.findUnique({
      where: { email: account.email },
    });
    if (user && !user.demo)
      throw new Error(
        `Reserved demo email is already used by a real account: ${account.email}`,
      );
    if (!user)
      user = await systemDb.$transaction(async (tx) => {
        // Preserve access to the original one-household prototype through the demo admin.
        const legacy =
          index === 0
            ? await tx.household.findFirst({
                where: { users: { none: {} } },
                orderBy: { id: "asc" },
              })
            : null;
        const household =
          legacy ??
          (await tx.household.create({
            data: {
              name: account.householdName,
              location: "Auckland",
              reserveDefault: "200",
            },
          }));
        return tx.user.create({
          data: {
            email: account.email,
            name: account.name,
            householdId: household.id,
            role: account.role,
            demo: true,
            passwordHash,
          },
        });
      });
    await demoHousehold(user, index);
    console.log(
      `${account.email} (${account.role}) ready; existing credentials and household records preserved.`,
    );
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await seedDemoUsers();
  } finally {
    await systemDb.$disconnect();
  }
}
