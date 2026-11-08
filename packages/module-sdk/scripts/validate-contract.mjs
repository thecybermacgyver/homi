import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HOMI_MODULE_API_VERSION,
  HomiModuleCompatibilityError,
  HomiModuleManifestError,
  assertHomiModuleCompatibility,
  isHomiFamilyBoardPlacement,
  snapToFamilyBoardGrid,
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
// A declared min and max are accepted but no longer limit the member: any card
// can be any size from half a cell to the whole board.
assert.deepEqual(resolveHomiFamilyBoardCardLimits(declaredSize, "wide"), {
  default: { w: 3, h: 4 },
  min: { w: 0.5, h: 0.5 },
  max: { w: 8, h: 40 },
});
assert.deepEqual(resolveHomiFamilyBoardCardLimits(declaredSize, "phone"), {
  default: { w: 4, h: 4 },
  min: { w: 0.5, h: 0.5 },
  max: { w: 4, h: 40 },
});
assert.deepEqual(resolveHomiFamilyBoardCardLimits(undefined, "wide"), {
  default: { w: 4, h: 4 },
  min: { w: 0.5, h: 0.5 },
  max: { w: 8, h: 40 },
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
  /\.h must be a whole number from 1 to 40/,
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
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1.3, h: 3 }, "wide"), false);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1, h: 41 }, "wide"), false);
// Positions and sizes may be any multiple of 1/8 of a cell, no smaller than half a cell.
assert.equal(isHomiFamilyBoardPlacement({ x: 0.5, y: 1.25, w: 2.375, h: 3.125 }, "wide"), true);
assert.equal(isHomiFamilyBoardPlacement({ x: 0.125, y: 0, w: 3.875, h: 0.5 }, "phone"), true);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 2.3, h: 2 }, "wide"), false, "not a multiple of 1/8");
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 0.375, h: 2 }, "wide"), false, "smaller than half a cell");
assert.equal(isHomiFamilyBoardPlacement({ x: 6, y: 0, w: 2.125, h: 2 }, "wide"), false, "off the right edge");
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: Number.NaN, h: 2 }, "wide"), false);
assert.equal(snapToFamilyBoardGrid(2.31), 2.25);
assert.equal(snapToFamilyBoardGrid(2.32), 2.375);
assert.equal(snapToFamilyBoardGrid(0.07), 0.125, "rounds to the nearest eighth");
assert.equal(snapToFamilyBoardGrid(3), 3, "whole cells stay whole");
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1, h: 40 }, "wide"), true);
assert.equal(isHomiFamilyBoardPlacement({ x: 3, y: 0, w: 1, h: 1 }, "phone"), true);
assert.equal(isHomiFamilyBoardPlacement({ x: 0, y: 0, w: 1 }, "wide"), false);

// A card may ask the board to draw it without Homi's frame.
assert.equal(
  Object.hasOwn(parsed.extensions.familyBoard[0], "frame"),
  false,
  "a card that declares no frame keeps the default framed card",
);
const bareHomeCard = copy(template);
bareHomeCard.extensions.familyBoard[0].frame = "none";
assert.equal(parseHomiModuleManifest(bareHomeCard).extensions.familyBoard[0].frame, "none");
const framedHomeCard = copy(template);
framedHomeCard.extensions.familyBoard[0].frame = "card";
assert.equal(parseHomiModuleManifest(framedHomeCard).extensions.familyBoard[0].frame, "card");
const scaledHomeCard = copy(template);
scaledHomeCard.extensions.familyBoard[0].fit = "scale";
assert.equal(parseHomiModuleManifest(scaledHomeCard).extensions.familyBoard[0].fit, "scale");
const nativeHomeCard = copy(template);
nativeHomeCard.extensions.familyBoard[0].fit = "native";
assert.equal(parseHomiModuleManifest(nativeHomeCard).extensions.familyBoard[0].fit, "native");
assert.equal(
  Object.hasOwn(parsed.extensions.familyBoard[0], "fit"),
  false,
  "a card that declares no fit sizes itself, as every module was built to",
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].fit = "stretch";
  },
  /fit must be "scale" or "native"/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].frame = "bare";
  },
  /frame must be "card" or "none"/,
);
rejectsManifest(
  (candidate) => {
    candidate.extensions.familyBoard[0].frame = true;
  },
  /frame must be "card" or "none"/,
);

console.log("PASS_MODULE_SDK_MANIFEST_COMPATIBILITY_CONTRACT");
