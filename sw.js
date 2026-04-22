// AccEqu MotoMec — service worker
// Cache first per gli asset statici, network first per l'HTML.
const VERSION = "v1.2.0";
const CACHE_STATIC = `accequ-static-${VERSION}`;
const CACHE_RUNTIME = `accequ-runtime-${VERSION}`;

const CODES = [
  "21100022","21100027","21100028","21100029","21100280","21100284",
  "21100288","21100289","21100290","21100345","21100353","21100358",
  "21100359","21100381","21100387","21100390","21100391","21100392",
  "21100393","21100394","21100395","21100398","21201074","2000313",
  "2000314","2000543","2000544","2000545","2000546","2000564",
  "2002460","2003340","2005084","3000286","3003959","41200279A"
];

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./data.js",
  "./quote.js",
  "./manifest.webmanifest",
  "./vendor/xlsx.full.min.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  ...CODES.map(c => `./img/${c}.jpg`)
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_STATIC);
      // Use best-effort addAll: ignore failures for optional assets
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_RUNTIME)
          .map((k) => caches.delete(k))
      );
      self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // HTML: network-first (to get fresh data.js/app.js references)
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      (async () => {
        try {
          const resp = await fetch(req);
          const cache = await caches.open(CACHE_RUNTIME);
          cache.put(req, resp.clone());
          return resp;
        } catch {
          const cached = await caches.match(req, { ignoreSearch: true });
          return cached || caches.match("./index.html");
        }
      })()
    );
    return;
  }

  // Static: cache-first, fallback network
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.status === 200) {
          const cache = await caches.open(CACHE_RUNTIME);
          cache.put(req, resp.clone());
        }
        return resp;
      } catch {
        return cached || new Response("offline", { status: 503 });
      }
    })()
  );
});
