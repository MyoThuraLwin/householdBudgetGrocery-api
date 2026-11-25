import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/application.js";
import { openapi } from "../src/contract.js";

test("import request defaults remain optional in the generated contract", () => {
  createApp();
  const schema =
    openapi().paths["/api/v1/price-imports/preview"].post.requestBody.content[
      "application/json"
    ].schema;
  assert.deepEqual(schema.required, ["format", "content"]);
  assert.equal(schema.properties.defaultAvailability.default, "unknown");
  assert.deepEqual(schema.properties.defaultAvailability.enum, [
    "available",
    "unknown",
  ]);
});
