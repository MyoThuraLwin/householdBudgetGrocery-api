import { readFile } from "node:fs/promises";
import { createApp } from "../src/application.js";
import { openapi } from "../src/contract.js";

createApp();
const committed = await readFile(
  new URL("../openapi.json", import.meta.url),
  "utf8",
);
if (committed.trim() !== JSON.stringify(openapi(), null, 2).trim()) {
  console.error(
    "openapi.json is out of date. Run npm run contract and regenerate the app's API types.",
  );
  process.exitCode = 1;
} else {
  console.log("openapi.json matches the API source.");
}
