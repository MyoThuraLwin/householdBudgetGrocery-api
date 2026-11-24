import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import app from "../index.js";

test("the Vercel handler serves public routes and rejects unauthenticated data access without SQL", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const root = await fetch(origin);
    assert.equal(root.status, 200);
    assert.equal(root.headers.get("cache-control"), "no-store");
    assert.equal(root.headers.get("x-content-type-options"), "nosniff");
    assert.equal(root.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.ok(root.headers.get("content-security-policy"));
    assert.equal((await root.json()).service, "Homewise API");
    const contract = await fetch(origin + "/api/v1/openapi.json");
    assert.equal(contract.status, 200);
    assert.ok((await contract.json()).paths["/api/v1/health"]);
    const data = await fetch(origin + "/api/v1/household");
    assert.equal(data.status, 401);
    assert.equal(data.headers.get("cache-control"), "no-store");
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
