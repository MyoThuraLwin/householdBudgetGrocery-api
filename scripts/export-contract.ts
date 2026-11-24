import { writeFile } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { openapi } from "../src/contract.js";
createApp();
await writeFile(
  new URL("../openapi.json", import.meta.url),
  JSON.stringify(openapi(), null, 2),
);
console.log("Exported openapi.json");
