import { seedDemoUsers } from "./demo-users.js";
import { systemDb } from "../src/db.js";
try {
  await seedDemoUsers();
} finally {
  await systemDb.$disconnect();
}
