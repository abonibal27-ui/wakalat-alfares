const CACHE_VERSION = "ABONIBAL-PWA-FINAL-001";
const STATIC_CACHE = `${CACHE_VERSION}-static`;

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key.includes("ABONIBAL") || key.includes("abonibal"))
        .filter(key => !key.startsWith(CACHE_VERSION))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        return await fetch(req, { cache: "no-store" });
      } catch (_) {
        return await caches.match("/index.html") || Response.error();
      }
    })());
    return;
  }

  const url = new URL(req.url);
  const isIcon = url.pathname.startsWith("/icons/");
  if (isIcon) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      const cache = await caches.open(STATIC_CACHE);
      cache.put(req, res.clone());
      return res;
    })());
  }
});
