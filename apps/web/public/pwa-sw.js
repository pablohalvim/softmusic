const CACHE_VERSION = "softmusic-pwa-v2";
const OFFLINE_URL = "/";

function isApiRequest(request, url) {
  const accept = request.headers.get("Accept") || "";
  if (accept.includes("application/vnd.softmusic")) return true;
  if (request.headers.get("Authorization")) return true;
  // Mesma origem em prod (VITE_API_URL vazio): paths do BFF.
  const apiPrefixes = [
    "/auth/",
    "/bands",
    "/invites/",
    "/dashboard/",
    "/songs",
    "/jobs/",
    "/library",
    "/billing",
    "/invoices",
    "/metrics",
    "/health",
  ];
  return apiPrefixes.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix),
  );
}

function isStaticAsset(url) {
  return /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|woff2?|ttf|ico|map)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        await cache.addAll([OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"]);
      } catch {
        /* falha ao pré-cachear não deve bloquear a instalação */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clients) {
        client.postMessage({ type: "PWA_VERSION_ACTIVATED", version: CACHE_VERSION });
      }
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Versão sempre da rede, para detectar novos deploys.
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // API / JSON autenticado: nunca cachear (causa dados “congelados” no PWA).
  if (isApiRequest(request, url)) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  // Navegações: network-first com fallback para o shell em cache (offline).
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(OFFLINE_URL, response.clone());
          return response;
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const cached = await cache.match(OFFLINE_URL);
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // JS/CSS: network-first para a SPA não ficar em bundle antigo após deploy.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        try {
          const response = await fetch(request);
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          const cached = await cache.match(request);
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Demais (manifest, etc.): stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});
