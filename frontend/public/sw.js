/**
 * INTEGRITY Platform — Service Worker
 *
 * Caching strategies:
 *   _next/static/**  → Cache-First  (content-hashed → safe forever)
 *   fonts / icons    → Cache-First  (long-lived)
 *   GET /api/**      → Network-First with stale-fallback (5-min TTL)
 *   Navigation HTML  → Network-First with offline shell fallback
 *
 * Mutations (POST/PUT/PATCH/DELETE /api/**) are NEVER cached here —
 * the application's syncQueue handles offline queuing for those.
 */

const CACHE_VERSION = "v4";
const STATIC_CACHE  = `integrity-static-${CACHE_VERSION}`;
const API_CACHE     = `integrity-api-${CACHE_VERSION}`;
const SHELL_CACHE   = `integrity-shell-${CACHE_VERSION}`;

// Static assets we pre-cache on install so the app shell is always available
const PRECACHE_URLS = [
  "/",
  "/student",
  "/login",
  "/offline.html",
];

// ── Install ────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch(() => {/* non-fatal — pages may not exist yet */})
    ).then(() => self.skipWaiting())
  );
});

// ── Activate ───────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const KNOWN_CACHES = [STATIC_CACHE, API_CACHE, SHELL_CACHE];
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !KNOWN_CACHES.includes(k))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch ──────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept non-GET mutations — let them hit the network directly;
  // the app's syncQueue handles offline queuing for these.
  if (request.method !== "GET") return;

  // 1. Next.js static chunks & public assets → Cache-First
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image") ||
    /\.(ico|png|jpg|jpeg|svg|webp|woff2?|ttf|otf)$/.test(url.pathname)
  ) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // 2. API GET calls → Network-First (5-min TTL), stale fallback
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstWithCache(request, API_CACHE, 5 * 60));
    return;
  }

  // 3. Navigation requests → Network-First, offline shell fallback
  if (request.mode === "navigate") {
    event.respondWith(networkFirstWithShellFallback(request));
    return;
  }
});

// ── Background Sync ────────────────────────────────────────────────
// When the browser fires a background sync event (on reconnect) we
// notify all open clients so they can flush the syncQueue.
self.addEventListener("sync", (event) => {
  if (event.tag === "integrity-sync") {
    event.waitUntil(notifyClientsToSync());
  }
});

// ── Push (future) ─────────────────────────────────────────────────
// Placeholder for exam-time push notifications.
self.addEventListener("push", (_event) => { /* reserved */ });

// ── Helpers ───────────────────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithCache(request, cacheName, maxAgeSeconds) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      // Store with a timestamp header so we can enforce TTL
      const headers = new Headers(response.headers);
      headers.set("sw-cached-at", Date.now().toString());
      const cloned = new Response(await response.clone().arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      cache.put(request, cloned);
    }
    return response;
  } catch {
    // Network failed → try cache
    const cached = await caches.match(request);
    if (cached) {
      const cachedAt = parseInt(cached.headers.get("sw-cached-at") || "0", 10);
      if (Date.now() - cachedAt < maxAgeSeconds * 1000) {
        return cached;
      }
    }
    return new Response(
      JSON.stringify({ success: false, offline: true, error: { message: "You are offline" } }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function networkFirstWithShellFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request) ||
                   await caches.match("/offline.html") ||
                   await caches.match("/");
    if (cached) return cached;
    return new Response(
      "<html><body><h1>You are offline</h1><p>Please reconnect to continue your exam.</p></body></html>",
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }
}

async function notifyClientsToSync() {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) {
    client.postMessage({ type: "SW_SYNC_NOW" });
  }
}
