import test from "node:test";
import assert from "node:assert/strict";
import { databaseSettings } from "../src/database-config.js";

test("Vercel selects SQL authentication with encrypted, validated Azure connections", () => {
  const { authentication, config } = databaseSettings({
    VERCEL: "1", SQL_SERVER: "example.database.windows.net",
    SQL_DATABASE: "Example", SQL_USER: "runtime", SQL_PASSWORD: "example-only",
    SQL_TRUST_CERTIFICATE: "true",
  });
  assert.equal(authentication, "sql");
  assert.equal(config.user, "runtime");
  assert.equal(config.password, "example-only");
  assert.equal(config.port, 1433);
  assert.equal(config.options?.encrypt, true);
  assert.equal(config.options?.trustServerCertificate, false);
  assert.equal(config.pool?.min, 0);
});

test("Vercel rejects a local Windows authentication setting", () => {
  assert.throws(() => databaseSettings({ VERCEL: "1", SQL_AUTH: "windows" }), /local Windows/);
});

test("invalid authentication and SQL ports fail explicitly", () => {
  assert.throws(() => databaseSettings({ SQL_AUTH: "typo" }), /SQL_AUTH/);
  for (const SQL_PORT of ["0", "65536", "abc", "1433.5"])
    assert.throws(() => databaseSettings({ SQL_AUTH: "sql", SQL_PORT }), /SQL_PORT/);
});

test("SQL connections validate certificates by default outside Azure too", () => {
  const { config } = databaseSettings({ SQL_AUTH: "sql", SQL_SERVER: "test.example" });
  assert.equal(config.options?.trustServerCertificate, false);
});
