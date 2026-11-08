// Homi serves a module's web files straight to the browser, which cannot resolve
// bare names like "react". The build rewrites them to /module-runtime/ paths; a
// file that is missed breaks the whole module with "Failed to resolve module
// specifier". Every browser-side file in dist must import only relative paths or
// /module-runtime/ paths. Run after `pnpm build`.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const SERVER_ONLY = new Set(["server.js"]);
const specifier = /(?:^|[\s;}])(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|(?:^|[\s;])import\s*["']([^"']+)["']/g;

let checked = 0;
for (const name of (await readdir(dist)).filter((f) => f.endsWith(".js") && !SERVER_ONLY.has(f))) {
  const source = await readFile(join(dist, name), "utf8");
  for (const match of source.matchAll(specifier)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    assert.ok(
      target.startsWith("./") || target.startsWith("../") || target.startsWith("/module-runtime/"),
      `dist/${name} imports "${target}", which the browser cannot resolve. Rewrite it in the build.`,
    );
  }
  checked += 1;
}
console.log(`PASS_HOMI_WEATHER_WEB_IMPORTS (${checked} browser files)`);
