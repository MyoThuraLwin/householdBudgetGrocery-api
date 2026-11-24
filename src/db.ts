import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaMssql } from "./vendor/windows-adapter.mjs";
import { scopedClient } from "./tenant.js";

const server = process.env.SQL_SERVER ?? "localhost";
const database = process.env.SQL_DATABASE ?? "HouseholdBudgetGrocery";
const odbc = (value: string) => `{${value.replaceAll("}", "}}")}}`;
const connectionString = `Driver=${odbc(process.env.SQL_DRIVER ?? "ODBC Driver 17 for SQL Server")};Server=${odbc(server)};Database=${odbc(database)};Trusted_Connection=Yes;Encrypt=Yes;TrustServerCertificate=${process.env.SQL_TRUST_CERTIFICATE === "false" ? "No" : "Yes"};`;
const adapter = new PrismaMssql({
  server,
  database,
  connectionString,
  options: { trustedConnection: true },
  pool: { max: 5, min: 0 },
  connectionTimeout: 5000,
} as any);
export const systemDb = new PrismaClient({ adapter });
export const db = scopedClient(systemDb);
export const transaction = <T>(fn: (tx: any) => Promise<T>) =>
  systemDb.$transaction((tx) => fn(scopedClient(tx)), {
    isolationLevel: "Serializable",
    timeout: 30000,
    maxWait: 10000,
  });
