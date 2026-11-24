import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaMssql } from "@prisma/adapter-mssql";
import { databaseSettings } from "./database-config.js";
import { scopedClient } from "./tenant.js";

const { authentication, config } = databaseSettings();
export const databaseAuthentication = authentication;
const odbc = (value: string) => `{${value.replaceAll("}", "}}")}}`;
// Only local Windows development loads the native ODBC driver. Vercel uses Tedious.
const adapter = authentication === "windows"
  ? new (await import("./vendor/windows-adapter.mjs")).PrismaMssql({
      ...config,
      connectionString: `Driver=${odbc(process.env.SQL_DRIVER ?? "ODBC Driver 17 for SQL Server")};Server=${odbc(config.server)};Database=${odbc(config.database!)};Trusted_Connection=Yes;Encrypt=Yes;TrustServerCertificate=${config.options?.trustServerCertificate ? "Yes" : "No"};`,
      options: { trustedConnection: true },
    } as any)
  : new PrismaMssql(config);
export const systemDb = new PrismaClient({ adapter });
export const db = scopedClient(systemDb);
export const transaction = <T>(fn: (tx: any) => Promise<T>) =>
  systemDb.$transaction((tx) => fn(scopedClient(tx)), {
    isolationLevel: "Serializable",
    timeout: 30000,
    maxWait: 10000,
  });
