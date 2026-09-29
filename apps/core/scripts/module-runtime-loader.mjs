// Node loader hook for validators that import a module's shipped web entrypoint.
// Module web artifacts import the shell's browser runtime bridges (see
// scripts/rewrite-module-web-imports.mjs); this maps them back to the same
// packages the Homi web app's import map serves, so the exact artifact loads.
const RUNTIME_BRIDGES = new Map([
  ["/module-runtime/react.js", "react"],
  ["/module-runtime/react-jsx-runtime.js", "react/jsx-runtime"],
  ["/module-runtime/module-sdk.js", "@homi/module-sdk"],
  ["/module-runtime/ui.js", "@homi/ui"],
]);

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(RUNTIME_BRIDGES.get(specifier) ?? specifier, context);
}
