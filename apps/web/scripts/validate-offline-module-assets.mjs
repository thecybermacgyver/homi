import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const handlers = new Map();
const stored = new Map();
const cache = {
  async put(request, response) {
    stored.set(new URL(request.url).pathname, response);
  },
  async match(request, options = {}) {
    const url = new URL(request.url);
    return stored.get(options.ignoreSearch ? url.pathname : url.pathname + url.search);
  },
};
let online = true;
const context = {
  self: {
    location: { origin: "https://homi.test" },
    addEventListener(type, handler) { handlers.set(type, handler); },
  },
  caches: { async open() { return cache; } },
  fetch: async () => {
    if (!online) throw new Error("offline");
    return new Response("export const loaded = true;", { status: 200 });
  },
  Request, Response, URL, Error, Promise,
};
vm.runInNewContext(source, context);

async function dispatch(url) {
  let responsePromise;
  handlers.get("fetch")({
    request: new Request(url),
    respondWith(value) { responsePromise = value; },
  });
  assert.ok(responsePromise, "module asset request was not intercepted");
  return responsePromise;
}

const asset = "https://homi.test/api/v1/core/module-assets/calendar/0.6.9/web.js";
assert.equal(await (await dispatch(asset)).text(), "export const loaded = true;");
online = false;
assert.equal(
  await (await dispatch(asset + "?homi_retry=1")).text(),
  "export const loaded = true;",
);
console.log("PASS_OFFLINE_MODULE_ASSET_CACHE");
