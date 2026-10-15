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

assert.equal(manifest.moduleKey, "kiss");
assert.equal(manifest.database?.schema, "mod_kiss");
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
  new URL("../migrations/0000_kiss_initial.sql", import.meta.url),
  "utf8",
);
assert.match(
  migration,
  /CREATE TABLE IF NOT EXISTS mod_kiss\.partnerships/,
);


// Every migration stays inside the module's own schema.
const second = await readFile(
  new URL("../migrations/0001_kiss_dates_quizzes_intimacy.sql", import.meta.url),
  "utf8",
);
assert.match(second, /CREATE TABLE IF NOT EXISTS mod_kiss\.swipes/);

const third = await readFile(
  new URL("../migrations/0002_kiss_daily_quizzes.sql", import.meta.url),
  "utf8",
);
assert.match(third, /ADD COLUMN IF NOT EXISTS day date/);

for (const sql of [migration, second, third]) {
  assert.doesNotMatch(sql, /CREATE\s+SCHEMA/i);
  assert.doesNotMatch(sql, /\bGRANT\b/i);
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+core\.modules/i);
  assert.doesNotMatch(sql, /core\.household_modules/i);
  assert.doesNotMatch(sql, /REFERENCES\s+(?!mod_kiss\.)mod_[a-z0-9_]+\./i);
  assert.doesNotMatch(sql, /\b(?:FROM|JOIN|UPDATE|INTO)\s+(?!mod_kiss\.)(?:core|mod_[a-z0-9_]+)\./i);
}

console.log("PASS_HOMI_MODULE_TEMPLATE_PUBLIC_CONTRACT");
