import "dotenv/config";
import { createApp } from "./application.js";
import { db, databaseAuthentication } from "./db.js";
const port = Number(process.env.PORT ?? 4000);
const server = createApp().listen(port, "127.0.0.1", () =>
  console.log(
    `Household API: http://localhost:${port}/api/v1 (${databaseAuthentication} database authentication)`,
  ),
);
async function shutdown() {
  server.close();
  await db.$disconnect();
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
