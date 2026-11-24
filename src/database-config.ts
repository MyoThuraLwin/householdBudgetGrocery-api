import type { config as SqlConfig } from "mssql";

export function databaseSettings(env: NodeJS.ProcessEnv = process.env) {
  const authentication = env.SQL_AUTH ?? (env.VERCEL || process.platform !== "win32" ? "sql" : "windows");
  if (authentication !== "sql" && authentication !== "windows")
    throw new Error("SQL_AUTH must be sql or windows.");
  if (authentication === "windows" && (env.VERCEL || process.platform !== "win32"))
    throw new Error("Windows database authentication is only available on a local Windows host.");
  const server = env.SQL_SERVER ?? "localhost";
  const database = env.SQL_DATABASE ?? "HouseholdBudgetGrocery";
  const port = Number(env.SQL_PORT ?? 1433);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("SQL_PORT must be a port number between 1 and 65535.");
  const azure = server.toLowerCase().endsWith(".database.windows.net");
  const trustServerCertificate = !azure && (env.SQL_TRUST_CERTIFICATE === "true" ||
    (authentication === "windows" && env.SQL_TRUST_CERTIFICATE !== "false"));
  const config: SqlConfig = {
    server, database, port,
    user: env.SQL_USER,
    password: env.SQL_PASSWORD,
    options: { encrypt: true, trustServerCertificate },
    pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  };
  return { authentication, config };
}
