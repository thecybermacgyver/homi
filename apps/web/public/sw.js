const SHELL_CACHE = "homi-shell-v21";
// When the server is down, Cloudflare (or any proxy) still answers, with a 5xx
// error page. That is a successful fetch as far as the browser is concerned,
// so only a thrown error used to reach the offline fallback. Treat a 5xx or a
// slow answer as "offline" whenever there is a saved copy to fall back to.
const NAVIGATION_TIMEOUT_MS = 5000;
const isServerFailure = (response) => response.status >= 500;
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
    await Promise.all(
      keys
        .filter((key) => key.startsWith("homi-shell-") && key !== SHELL_CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/v1/core/module-assets/")) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) await cache.put(request, response.clone());
        if (!isServerFailure(response)) return response;
        const cached = await cache.match(request, { ignoreSearch: true });
        return cached ?? response;
      } catch {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw new Error("The installed Homi module is unavailable offline.");
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/health/")) {
    return;
  }

  if (url.pathname.startsWith("/module-runtime/")) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) await cache.put(request, response.clone());
        if (!isServerFailure(response)) return response;
        const cached = await cache.match(request);
        return cached ?? response;
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
