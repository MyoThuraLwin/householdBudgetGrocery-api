import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parse } from "dotenv";
const path = new URL("../.env", import.meta.url);
const current = await readFile(path, "utf8").catch(() => "");
if (Buffer.byteLength(parse(current).JWT_SECRET ?? "") >= 32)
  console.log(
    "JWT signing key is already configured; existing environment preserved.",
  );
else {
  await writeFile(
    path,
    current.replace(/^JWT_SECRET=.*\r?\n?/gm, "") +
      (current.endsWith("\n") || !current ? "" : "\n") +
      "JWT_SECRET=" +
      randomBytes(48).toString("base64url") +
      "\n",
  );
  console.log("Created a random JWT signing key in the ignored api/.env file.");
}
