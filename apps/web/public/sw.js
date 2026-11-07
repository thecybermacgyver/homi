const SHELL_CACHE = "homi-shell-v24";
// Module files live in their own cache so a new worker version never discards
// them: the URLs carry the module version, so old entries are harmless, and a
// device that loses them is left unable to start any module while offline until
// it next loads Homi online.
const MODULE_CACHE = "homi-modules-v1";
const isModuleFile = (pathname) =>
  pathname.startsWith("/api/v1/core/module-assets/") ||
  pathname.startsWith("/module-runtime/");
// Brand images are not versioned, so they are carried across worker upgrades too.
const isBrandFile = (pathname) => pathname.startsWith("/brand/");
// When the server is down, Cloudflare (or any proxy) still answers, with a 5xx
// error page. That is a successful fetch as far as the browser is concerned,
// so only a thrown error used to reach the offline fallback. Treat a 5xx or a
// slow answer as "offline" whenever there is a saved copy to fall back to.
const NAVIGATION_TIMEOUT_MS = 5000;
const isServerFailure = (response) => response.status >= 500;
// A proxy in front of Homi (Cloudflare, nginx) answers with an HTML error page
// when the origin is down; Homi's own API only ever answers with JSON. Turning
// that page into a failed network call lets the app use its saved sign-in and
// offline data: its offline mode is keyed to transport failures, so without
// this it read the 5xx page as "signed out" and showed the sign-in screen.
const isProxyErrorPage = (response) =>
  response.status >= 500 &&
  (response.headers.get("content-type") ?? "").includes("text/html");
async function fetchApi(request) {
  const response = await fetch(request);
  return isProxyErrorPage(response) ? Response.error() : response;
}
async function fetchWithTimeout(request, timeoutMs, init) {
  if (!timeoutMs) return fetch(request, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
const STATIC_SEEDS = [
  "/manifest.webmanifest",
  "/brand/homi_icon_192.png",
  "/brand/homi_icon_512.png",
  "/brand/homi_icon.png",
  "/brand/homi_logo.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const response = await fetch("/", { cache: "no-store" });
    if (response.ok) {
      const html = await response.clone().text();
      await cache.put("/", response);
      const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
        .map((match) => match[1]);
      await Promise.all(
        [...STATIC_SEEDS, ...assetPaths].map(async (path) => {
          try {
            const asset = await fetch(path, { cache: "no-store" });
            if (asset.ok) {
              await cache.put(path, asset);
            }
          } catch {
            // A later online request can populate a missing non-shell asset.
          }
        }),
      );
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter(
      (key) => key.startsWith("homi-shell-") && key !== SHELL_CACHE,
    );
    // Module files and brand images saved by an older worker version (they
    // used to share the versioned shell cache) are carried over before that
    // cache is deleted. Hashed /assets files are not: the new install saves
    // the ones the new shell needs.
    const modules = await caches.open(MODULE_CACHE);
    const shell = await caches.open(SHELL_CACHE);
    for (const key of stale) {
      const old = await caches.open(key);
      for (const request of await old.keys()) {
        const { pathname } = new URL(request.url);
        const target = isModuleFile(pathname)
          ? modules
          : isBrandFile(pathname)
            ? shell
            : null;
        if (!target || (await target.match(request))) continue;
        const saved = await old.match(request);
        if (saved) await target.put(request, saved);
      }
    }
    await Promise.all(stale.map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isApi =
    url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/");
  if (request.method !== "GET") {
    // Sign-in, client registration and mutation delivery are POSTs.
    if (isApi) event.respondWith(fetchApi(request));
    return;
  }

  if (url.pathname.startsWith("/api/v1/core/module-assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(MODULE_CACHE);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) await cache.put(request, response.clone());
        if (!isServerFailure(response)) return response;
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        return isProxyErrorPage(response) ? Response.error() : response;
      } catch {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw new Error("The installed Homi module is unavailable offline.");
      }
    })());
    return;
  }

  if (isApi) {
    event.respondWith(fetchApi(request));
    return;
  }

  if (url.pathname.startsWith("/module-runtime/")) {
    event.respondWith((async () => {
      const cache = await caches.open(MODULE_CACHE);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) await cache.put(request, response.clone());
        if (!isServerFailure(response)) return response;
        const cached = await cache.match(request);
        if (cached) return cached;
        return isProxyErrorPage(response) ? Response.error() : response;
      } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw new Error("Homi module runtime bridge is unavailable offline.");
      }
    })());
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match("/");
      try {
        // With no saved copy there is nothing better to show, so wait as long as it takes.
        const response = await fetchWithTimeout(request, cached ? NAVIGATION_TIMEOUT_MS : 0);
        if (response.ok) {
          await cache.put("/", response.clone());
          return response;
        }
        if (cached && isServerFailure(response)) return cached;
        return response;
      } catch {
        if (cached) return cached;
        throw new Error("Homi application shell is unavailable offline.");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

// Web Push: the server sends the reminder's text already written, encrypted
// to this device. Always show something: a push the browser cannot attribute
// to a visible notification is penalised or revoked.
self.addEventListener("push", (event) => {
  let note = { title: "Homi", body: "You have a new notification.", tag: "homi", url: "/" };
  try {
    if (event.data) note = { ...note, ...event.data.json() };
  } catch {
    // keep the generic notification
  }
  event.waitUntil((async () => {
    await self.registration.showNotification(note.title, {
      body: note.body,
      tag: note.tag,
      icon: "/brand/homi_icon_192.png",
      badge: "/brand/homi_icon_192.png",
      data: { url: note.url },
    });
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) client.postMessage({ type: "homi-push" });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
