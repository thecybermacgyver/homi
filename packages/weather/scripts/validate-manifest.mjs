import { readFile } from "node:fs/promises";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  parseHomiModuleManifest,
} from "@homi/module-sdk";

const raw = JSON.parse(
  await readFile(new URL("../homi.module.json", import.meta.url), "utf8"),
);
const manifest = parseHomiModuleManifest(raw);

assertHomiModuleCompatibility(manifest, HOMI_MODULE_API_VERSION);

console.log(
  `Validated ${manifest.moduleKey}@${manifest.version} for Homi module API ${manifest.moduleApiVersion}.`,
);
