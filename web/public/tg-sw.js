const cacheName = "vivaahmesh-tg-shell-v1";
const offlinePath = "/tg/offline";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const page = await fetch(offlinePath, { cache: "reload", credentials: "omit" });
    if (!page.ok || page.redirected) throw new Error("Offline shell unavailable");
    const html = await page.clone().text();
    const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+)"/g)]
      .map((match) => match[1]))];
    const cache = await caches.open(cacheName);
    await cache.addAll(["/icon-192.png", ...assets].map((url) => new Request(url, { credentials: "omit" })));
    await cache.put(offlinePath, page);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && url.pathname === "/tg") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(offlinePath)) ?? Response.error();
    }));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon-192.png") {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      return (await cache.match(request)) ?? fetch(request);
    })());
  }
});
