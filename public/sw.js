const CACHE_NAME = "ds-mobile-runtime-v3";
const CORE_ASSETS = ["/", "/index.html", "/manifest.json"];

// Step 3.5 — Offline-First Data Sync ("Download Area"). Product photos live
// on Supabase Storage (cross-origin to this app), so the old fetch handler
// below — which only ever cached same-origin requests — silently left every
// photo un-cacheable. That meant "offline mode" showed the product list
// (from repository.ts's local cache) but every photo was a broken image.
// This dedicated cache, plus the message API at the bottom, fixes that.
const PHOTO_CACHE_NAME = "ds-mobile-photos-v1";
// Matches any Supabase Storage public object URL regardless of project
// domain or bucket name, e.g. https://<project>.supabase.co/storage/v1/object/public/product-photos/...
const STORAGE_OBJECT_PATH = "/storage/v1/object/public/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Keep the photo cache across activations — it's the whole point of
      // "download once, works offline forever" — only clean up stale
      // *runtime* asset caches from previous app versions.
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== PHOTO_CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isPhotoRequest(url) {
  return url.pathname.includes(STORAGE_OBJECT_PATH);
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Cross-origin: only handle Supabase Storage photo URLs, cache-first
  // (photoStorage.ts always writes a new, timestamped path per upload, so
  // a cached object never goes stale — safe to serve without revalidating).
  if (url.origin !== self.location.origin) {
    if (!isPhotoRequest(url)) return;
    event.respondWith((async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const cache = await caches.open(PHOTO_CACHE_NAME);
          cache.put(event.request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    try {
      const response = await fetch(event.request);
      if (response.ok && (url.pathname.startsWith("/assets/") ||
          url.pathname.endsWith(".js") || url.pathname.endsWith(".css") ||
          url.pathname.endsWith(".html") || url.pathname.endsWith(".json") ||
          url.pathname.endsWith(".wasm") || url.pathname.endsWith(".png") ||
          url.pathname.endsWith(".svg") || url.pathname.endsWith(".ico"))) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      if (cached) return cached;
      if (event.request.headers.get("accept")?.includes("text/html")) {
        return (await caches.match("/index.html")) || Response.error();
      }
      return Response.error();
    }
  })());
});

// ---- "Download Area" message API -----------------------------------------
// The DownloadAreaView screen talks to this worker directly (rather than
// just relying on passive caching-on-view) so staff get an explicit,
// reliable "download everything now" button with real progress, instead of
// hoping every photo happened to be viewed once while online.
self.addEventListener("message", (event) => {
  const { type, requestId } = event.data || {};
  const reply = (payload) => event.source && event.source.postMessage({ requestId, ...payload });

  if (type === "PRECACHE_PHOTOS") {
    const urls = Array.isArray(event.data.urls) ? event.data.urls : [];
    event.waitUntil((async () => {
      const cache = await caches.open(PHOTO_CACHE_NAME);
      let done = 0, failed = 0;
      for (const rawUrl of urls) {
        try {
          const existing = await cache.match(rawUrl);
          if (!existing) {
            const response = await fetch(rawUrl, { mode: "cors" });
            if (response.ok) await cache.put(rawUrl, response);
            else failed++;
          }
        } catch {
          failed++;
        }
        done++;
        reply({ type: "PRECACHE_PROGRESS", done, failed, total: urls.length });
      }
      reply({ type: "PRECACHE_DONE", done, failed, total: urls.length });
    })());
    return;
  }

  if (type === "CACHE_STATUS") {
    event.waitUntil((async () => {
      const cache = await caches.open(PHOTO_CACHE_NAME);
      const keys = await cache.keys();
      reply({ type: "CACHE_STATUS_RESULT", photosCached: keys.length });
    })());
    return;
  }

  if (type === "CLEAR_PHOTO_CACHE") {
    event.waitUntil((async () => {
      await caches.delete(PHOTO_CACHE_NAME);
      reply({ type: "CLEAR_PHOTO_CACHE_DONE" });
    })());
  }
});
