import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HOMI_MODULE_API_VERSION,
  HomiModuleCompatibilityError,
  HomiModuleManifestError,
  assertHomiModuleCompatibility,
  isHomiFamilyBoardPlacement,
  resolveHomiFamilyBoardCardLimits,
  defineHomiServerModule,
  parseHomiModuleManifest,
} from "../dist/index.js";

const templateUrl = new URL(
  "../../../templates/homi-module-template/homi.module.json",
  import.meta.url,
);
const template = JSON.parse(await readFile(templateUrl, "utf8"));

function copy(value) {
  return structuredClone(value);
}

function rejectsManifest(mutator, expectedPattern) {
  const candidate = copy(template);
  mutator(candidate);
  assert.throws(
    () => parseHomiModuleManifest(candidate),
    (error) =>
      error instanceof HomiModuleManifestError &&
      expectedPattern.test(error.message),
  );
}

const parsed = parseHomiModuleManifest(template);
assert.equal(parsed.moduleKey, "starter");
assert.equal(parsed.version, "0.1.0");
assert.equal(parsed.database?.schema, "mod_starter");
assert.equal(parsed.entrypoints.server, "./dist/server.js");
assert.equal(parsed.entrypoints.web, "./dist/web.js");
assert.equal(parsed.navigation[0]?.path, "/modules/starter");
assert.equal(parsed.setup?.required, true);
assert.deepEqual(parsed.sync?.entities[0]?.operations, [
  "create",
  "update",
  "delete",
]);
assert.equal(
  parsed.extensions.familyBoard[0]?.label,
  "Family notes",
);

const multipleHomeCards = copy(template);
multipleHomeCards.extensions.familyBoard.push({
  surfaceId: "starter-summary",
  label: "Quick summary",
  slot: "noticeboard",
});
assert.equal(
  parseHomiModuleManifest(multipleHomeCards)
    .extensions.familyBoard.length,
  2,
);

const legacyHomeCard = copy(template);
delete legacyHomeCard.extensions.familyBoard[0].label;
assert.equal(
  parseHomiModuleManifest(legacyHomeCard)
    .extensions.familyBoard[0]?.label,
  "starter-board",
);

assertHomiModuleCompatibility(parsed, HOMI_MODULE_API_VERSION);

const setupAwareServerModule = defineHomiServerModule({
  moduleKey: "starter",
  moduleApiVersion: HOMI_MODULE_API_VERSION,
  getSetupStatus() {
    return { state: "unconfigured" };
  },
});
assert.deepEqual(
  await setupAwareServerModule.getSetupStatus(),
  { state: "unconfigured" },
);
assert.throws(
  () =>
    defineHomiServerModule({
      moduleKey: "starter",
      moduleApiVersion: HOMI_MODULE_API_VERSION,
      getSetupStatus: "not-a-function",
    }),
  /getSetupStatus must be a function/,
);

assert.throws(
  () => assertHomiModuleCompatibility(parsed, HOMI_MODULE_API_VERSION + 1),
  (error) =>
    error instanceof HomiModuleCompatibilityError &&
    error.code === "INCOMPATIBLE_HOMI_MODULE_API",
);

rejectsManifest(
  (candidate) => {
    candidate.typoField = true;
  },
  /unknown field 'typoField'/,
);

rejectsManifest(
  (candidate) => {
    candidate.database.schema = "core";
  },
  /database\.schema must be 'mod_starter'/,
);

rejectsManifest(
  (candidate) => {
    candidate.database.migrations = "../migrations";
  },
  /relative package path without traversal/,
);

rejectsManifest(
  (candidate) => {
    candidate.entrypoints.web = "/tmp/module.js";
  },
  /relative package path without traversal/,
);

rejectsManifest(
  (candidate) => {
    candidate.navigation[0].path = "/modules/starterish";
  },
  /must be inside \/modules\/starter/,
);

rejectsManifest(
  (candidate) => {
    candidate.navigation.push(copy(candidate.navigation[0]));
  },
  /navigation IDs must be unique/,
);

rejectsManifest(
  (candidate) => {
    candidate.coreCapabilities.push("database-root");
  },
  /Unsupported Core capability 'database-root'/,
);

rejectsManifest(
  (candidate) => {
    delete candidate.sync;
  },
  /sync is required for every Homi module/,
);

rejectsManifest(
  (candidate) => {
    candidate.coreCapabilities = candidate.coreCapabilities.filter(
      (capability) => capability !== "sync",
    );
  },
  /coreCapabilities must include 'sync'/,
);

rejectsManifest(
  (candidate) => {
    candidate.sync.entities = [];
  },
  /sync.entities must declare at least one synchronized entity/,
);

rejectsManifest(
  (candidate) => {
    candidate.sync.entities[0].operations.push("merge");
  },
  /Unsupported sync operation 'merge'/,
);

rejectsManifest(
  (candidate) => {
    candidate.sync.entities.push(copy(candidate.sync.entities[0]));
  },
  /duplicate entity types/,
);

rejectsManifest(
  (candidate) => {
    candidate.entrypoints = {};
  },
  /at least one server or web entrypoint/,
);

rejectsManifest(
  (candidate) => {
    candidate.moduleKey = "Starter";
  },
  /moduleKey has an invalid format/,
);

assert.equal(
  Object.hasOwn(parsed.extensions.familyBoard[0], "styles"),
  false,
);
const styledHomeCard = copy(template);
styledHomeCard.extensions.familyBoard[0].styles = [
  { id: "items", label: "List" },
  { id: "store-counts", label: "Counts by store" },
];
assert.deepEqual(
  parseHomiModuleManifest(styledHomeCard).extensions.familyBoard[0].styles,
  [
    { id: "items", label: "List" },
    { id: "store-counts", label: "Counts by store" },
  ],
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].styles = [{ id: "items", label: "List" }];
  },
  /between 2 and 6 card styles/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].styles = [
      { id: "items", label: "List" },
      { id: "items", label: "Again" },
    ];
  },
  /style IDs must be unique/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].styles = [
      { id: "items", label: "List", icon: "x" },
      { id: "counts", label: "Counts" },
    ];
  },
  /unknown field 'icon'/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].styles = [
      { id: "Items", label: "List" },
      { id: "counts", label: "Counts" },
    ];
  },
  /invalid format/,
);

const sizedHomeCard = copy(template);
sizedHomeCard.extensions.familyBoard[0].size = {
  default: { w: 3, h: 4 },
  min: { w: 2, h: 2 },
  max: { w: 6, h: 8 },
};
const declaredSize =
  parseHomiModuleManifest(sizedHomeCard).extensions.familyBoard[0].size;
assert.deepEqual(declaredSize, {
  default: { w: 3, h: 4 },
  min: { w: 2, h: 2 },
  max: { w: 6, h: 8 },
});
assert.deepEqual(resolveHomiFamilyBoardCardLimits(declaredSize, "wide"), {
  default: { w: 3, h: 4 },
  min: { w: 2, h: 2 },
  max: { w: 6, h: 8 },
});
assert.deepEqual(resolveHomiFamilyBoardCardLimits(declaredSize, "phone"), {
  default: { w: 4, h: 4 },
  min: { w: 2, h: 2 },
  max: { w: 4, h: 8 },
});
assert.deepEqual(resolveHomiFamilyBoardCardLimits(undefined, "wide"), {
  default: { w: 4, h: 4 },
  min: { w: 2, h: 2 },
  max: { w: 8, h: 12 },
});
assert.deepEqual(
  resolveHomiFamilyBoardCardLimits({ default: { w: 2, h: 2 } }, "phone").default,
  { w: 2, h: 2 },
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].size = { default: { w: 9, h: 2 } };
  },
  /\.w must be a whole number from 1 to 8/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].size = { default: { w: 2, h: 0 } };
  },
  /\.h must be a whole number from 1 to 12/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].size = {
      default: { w: 2, h: 2 },
      min: { w: 3, h: 2 },
    };
  },
  /must lie between/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].size = { default: { w: 2, h: 2, d: 1 } };
  },
  /unknown field 'd'/,
);

assert.equal(isHomiFamilyBoardPlacement({ x: 4, y: 0, w: 4, h: 3 }, "wide"), true);
assert.equal(isHomiFamilyBoardPlacement({ x: 4, y: 0, w: 4, h: 3 }, "phone"), false);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1.5, h: 3 }, "wide"), false);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1, h: 13 }, "wide"), false);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1 }, "wide"), false);

console.log("PASS_MODULE_SDK_MANIFEST_COMPATIBILITY_CONTRACT");
