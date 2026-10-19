// Kill switch for the legacy static site's service worker (sultan-v27-*), which cached images cache-first forever.
// Browsers that still have it re-fetch /sw.js, get THIS file, and it removes itself: clears every cache, unregisters,
// and reloads open tabs so they are served by the network (fresh pages, revocable media) again. The Next.js site
// registers no service worker; nothing else should ever be placed here.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) c.navigate(c.url).catch(() => {});
    })(),
  );
});
