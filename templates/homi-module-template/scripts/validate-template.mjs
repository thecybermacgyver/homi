import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  parseHomiModuleManifest,
} from "@homi/module-sdk";

const manifest = parseHomiModuleManifest(
  JSON.parse(await readFile(new URL("../homi.module.json", import.meta.url), "utf8")),
);
assertHomiModuleCompatibility(manifest, HOMI_MODULE_API_VERSION);

assert.equal(manifest.moduleKey, "starter");
assert.equal(manifest.database?.schema, "mod_starter");
assert.ok(manifest.entrypoints.server);
assert.ok(manifest.entrypoints.web);
assert.ok(manifest.navigation.length > 0);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await collectSourceFiles(path)));
      continue;
    }
    if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) {
      result.push(path);
    }
  }

  return result;
}

const sourceDir = fileURLToPath(new URL("../src/", import.meta.url));
const sourceFiles = await collectSourceFiles(sourceDir);

const forbidden = [
  /from\s+["']@homi\/core(?:\/|["'])/,
  /from\s+["']@homi\/web(?:\/|["'])/,
  /from\s+["'][^"']*apps\/core\//,
  /from\s+["'][^"']*apps\/web\//,
  /from\s+["'][^"']*packages\/calendar\//,
  /from\s+["']@homi\/calendar(?:\/|["'])/,
];

for (const sourceFile of sourceFiles) {
  const source = await readFile(sourceFile, "utf8");
  for (const pattern of forbidden) {
    assert.equal(
      pattern.test(source),
      false,
      `Template source ${sourceFile} imports a private or feature-specific Homi implementation.`,
    );
  }
}

const migration = await readFile(
  new URL("../migrations/0000_starter_initial.sql", import.meta.url),
  "utf8",
);
assert.match(
  migration,
  /CREATE TABLE IF NOT EXISTS mod_starter\.items/,
);
assert.doesNotMatch(migration, /CREATE\s+SCHEMA/i);
assert.doesNotMatch(migration, /\bGRANT\b/i);
assert.doesNotMatch(migration, /INSERT\s+INTO\s+core\.modules/i);
assert.doesNotMatch(migration, /core\.household_modules/i);
assert.doesNotMatch(migration, /REFERENCES\s+(?!mod_starter\.)mod_[a-z0-9_]+\./i);

console.log("PASS_HOMI_MODULE_TEMPLATE_PUBLIC_CONTRACT");
