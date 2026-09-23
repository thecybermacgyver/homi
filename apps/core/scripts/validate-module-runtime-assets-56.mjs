import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHomiDatabase } from "@homi/db";
import { loadHomiServerModules } from "../dist/module-host.js";
import {
  createHomiHouseholdModuleService,
} from "../dist/household-modules.js";
import {
  createHomiModuleAssetService,
} from "../dist/module-assets.js";

const appUrl = process.env.HOMI_TEST_APP_DATABASE_URL;
const installRoot = process.env.HOMI_TEST_MODULES_DIRECTORY;
if (!appUrl || !installRoot) {
  throw new Error(
    "HOMI_TEST_APP_DATABASE_URL and HOMI_TEST_MODULES_DIRECTORY are required.",
  );
}

const context = Object.freeze({
  requestId: "77777777-7777-4777-8777-777777777777",
  userId: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  membershipId: "33333333-3333-4333-8333-333333333333",
  householdPersonId: "44444444-4444-4444-8444-444444444444",
  clientId: "55555555-5555-4555-8555-555555555555",
  locale: "en-CA",
  timeZone: "America/Toronto",
});

const database = createHomiDatabase(appUrl);
const modules = await loadHomiServerModules({
  installRoot,
  database: database.db,
  requestContext: {
    async resolve() {
      return context;
    },
  },
});

assert.equal(modules.length, 1);
assert.equal(modules[0]?.moduleKey, "starter");

const lifecycle = createHomiHouseholdModuleService(
  database.db,
  modules,
);
const runtime = await lifecycle.runtime(context);
assert.equal(runtime.length, 1);

const descriptor = runtime[0];
assert.ok(descriptor);
assert.equal(descriptor.moduleKey, "starter");
assert.equal(descriptor.enabled, true);
assert.equal(descriptor.revision, "3");
assert.equal(descriptor.setupState, "configured");
assert.equal(descriptor.manifest.moduleApiVersion, 1);
assert.equal(
  descriptor.manifest.extensions.familyBoard[0]?.slot,
  "noticeboard",
);
assert.equal(
  descriptor.webEntrypointUrl,
  "/api/v1/core/module-assets/starter/0.1.0/dist/web.js",
);

const assets = createHomiModuleAssetService(
  database.db,
  installRoot,
);
const asset = await assets.read(
  "starter",
  "0.1.0",
  "dist/web.js",
);
assert.equal(
  asset.contentType,
  "text/javascript; charset=utf-8",
);

const disk = await readFile(
  resolve(
    installRoot,
    "starter",
    "0.1.0",
    "dist",
    "web.js",
  ),
);
assert.deepEqual(asset.body, disk);
assert.match(
  asset.body.toString("utf8"),
  /createHomiWebModule/,
);

await assert.rejects(
  () =>
    assets.read(
      "starter",
      "0.1.0",
      "migrations/0000_starter_initial.sql",
    ),
  (error) =>
    error instanceof Error &&
    error.name === "HomiModuleAssetError",
);

await database.close();

console.log(
  "PASS_56_REAL_REGISTRY_RUNTIME_DESCRIPTOR_MANAGED_WEB_ASSET",
);
