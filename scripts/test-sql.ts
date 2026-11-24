import { spawn } from "node:child_process";
const processUnderTest = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "tests/domain.test.ts",
    "tests/auth.test.ts",
    "tests/auth-integration.test.ts",
    "tests/integration.test.ts",
  ],
  { stdio: "inherit", env: { ...process.env, RUN_SQL_TESTS: "1" } },
);
processUnderTest.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
