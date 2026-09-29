import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Server faults must be logged at error level; client-caused rejections are
// expected outcomes recorded at info level. The app logs to stdout, so the
// probe runs in a child process and this script reads its log lines.
if (process.argv[2] === "probe") {
  const { buildApp } = await import("../dist/app.js");
  // The probe routes never reach the app's services.
  const dependencies = new Proxy({ modules: [] }, {
    get: (target, key) =>
      key in target ? target[key] : new Proxy(() => {}, { get: () => () => {} }),
  });
  const app = buildApp(dependencies);
  app.get("/probe/fault", async () => {
    throw new Error("probe server fault");
  });
  app.get("/probe/missing", async () => {
    throw Object.assign(new Error("probe missing"), {
      statusCode: 404,
      code: "PROBE_NOT_FOUND",
    });
  });
  const fault = await app.inject({ method: "GET", url: "/probe/fault" });
  const missing = await app.inject({ method: "GET", url: "/probe/missing" });
  assert.equal(fault.statusCode, 500);
  assert.equal(fault.json().error.code, "INTERNAL_ERROR");
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, "PROBE_NOT_FOUND");
  await app.close();
} else {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), "probe"],
    { encoding: "utf8" },
  );
  assert.equal(child.status, 0, child.stderr);
  const entries = child.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  const errors = entries.filter((entry) => entry.level >= 50);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].err?.message, "probe server fault");
  const rejected = entries.filter((entry) => entry.msg === "Request rejected");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].level, 30);
  assert.equal(rejected[0].statusCode, 404);
  assert.equal(rejected[0].code, "PROBE_NOT_FOUND");
  console.log("PASS_CORE_REQUEST_LOGGING faults=error rejections=info");
}
