import { readFile, writeFile } from "node:fs/promises";

const file = process.argv[2];
if (!file) {
  throw new Error("Usage: rewrite-module-web-imports.mjs <web-entry>");
}

const replacements = new Map([
  ["react/jsx-runtime", "/module-runtime/react-jsx-runtime.js"],
  ["react", "/module-runtime/react.js"],
  ["@homi/module-sdk", "/module-runtime/module-sdk.js"],
  ["@homi/ui", "/module-runtime/ui.js"],
]);

let source = await readFile(file, "utf8");
for (const [specifier, browserPath] of replacements) {
  source = source.replaceAll(`"${specifier}"`, `"${browserPath}"`);
}
await writeFile(file, source);
