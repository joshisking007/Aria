// ─────────────────────────────────────────────────────────────
//  ARIA SERVICE WORKER  v3.1
//  SAFE asset caching (cache-first) + Web Share Target forwarding
//  FIXED v3.1: stale index.html bug — HTML is now network-first,
//              not cached at install time. API path list expanded.
// ─────────────────────────────────────────────────────────────

// Bump this version string whenever you deploy new JS/CSS/HTML.
const CACHE_VERSION = 'aria-v3.1';

// App-shell assets to pre-cache on install.
// ⚠️  index.html deliberately REMOVED — it is served network-first
//     (see step 8 below) so users always get the latest shell.
const SHELL_ASSETS = [
  '/style.css',
  '/aria-games.css',
  '/aria-core.js',
  '/aria-app.js',
  '/aria-games.js',
  '/manifest.json',
];

// Domains whose requests should NEVER be cached.
const NEVER_CACHE_ORIGINS = [
  'mmtdtcmhvbruubrjgjrz.supabase.co', // Supabase (auth + DB + edge functions)
  'api.anthropic.com',                // Anthropic
  'api.elevenlabs.io',                // ElevenLabs
];

// Same-origin routes that must NEVER be cached (AI/chat endpoints).
const NEVER_CACHE_PATHS = [
  '/api/',
  '/functions/',
  '/chat',
  '/message',
  '/completion',
  '/stream',
  // Supabase edge-function paths that appear as same-origin after rewrites:
  '/aria-ai',
  '/aria-tts',
];

// ── security: only forward share data to same-origin windows ──
const ALLOWED_ORIGIN = self.location.origin;

// ── security: sanitize and cap share payload fields ──
function sanitizeShareField(val, maxLen) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, maxLen)
    .trim();
}

// ─────────────────────────────────────────────────────────────
//  INSTALL — pre-cache the app shell (no HTML)
// ─────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────────────
//  ACTIVATE — purge stale caches from previous versions
// ─────────────────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== CACHE_VERSION)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────────────
//  FETCH — route every request through the right strategy
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── 1. Web Share Target (GET /?text=...&title=...) ──────────
  if (
    url.origin === ALLOWED_ORIGIN &&
    url.pathname === '/' &&
    (url.searchParams.has('text') || url.searchParams.has('title'))
  ) {
    const title     = sanitizeShareField(url.searchParams.get('title') || '', 200);
    const text      = sanitizeShareField(url.searchParams.get('text')  || '', 2000);
    const sharedUrl = sanitizeShareField(url.searchParams.get('url')   || '', 2048);

    e.respondWith(
      (async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          if (new URL(client.url).origin === ALLOWED_ORIGIN) {
            client.postMessage({ type: 'SHARE_TARGET', title, text, url: sharedUrl });
          }
        }
        return Response.redirect('/', 303);
      })()
    );
    return;
  }

  // ── 2. Never cache certain external API domains ─────────────
  if (NEVER_CACHE_ORIGINS.some(host => url.hostname.includes(host))) {
    return;
  }

  // ── 3. Never cache certain same-origin dynamic routes ───────
  if (
    url.origin === ALLOWED_ORIGIN &&
    NEVER_CACHE_PATHS.some(path => url.pathname.startsWith(path))
  ) {
    return;
  }

  // ── 4. Non-GET requests must never be cached ────────────────
  if (e.request.method !== 'GET') return;

  // ── 5. HTML documents → network-first (prevents stale shell) ─
  //  This is the FIX for the stale-hit bug.
  //  index.html (and any other HTML page) is always fetched fresh
  //  from the network. The cached copy is only used as a fallback
  //  when the network is completely unreachable (offline).
  const isHtml =
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    e.request.headers.get('Accept')?.includes('text/html');

  if (isHtml && url.origin === ALLOWED_ORIGIN) {
    e.respondWith(networkFirstHtml(e.request));
    return;
  }

  // ── 6. Only cache STATIC asset file types (safe caching) ────
  const isStaticAsset =
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.gif') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.ttf') ||
    url.pathname.endsWith('.otf') ||
    url.pathname.endsWith('.json');

  // If it's not a static asset, do NOT cache it.
  if (!isStaticAsset) {
    return;
  }

  // ── 7. Cross-origin static assets → stale-while-revalidate ───
  if (url.origin !== ALLOWED_ORIGIN) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // ── 8. Same-origin static assets → cache-first ──────────────
  e.respondWith(cacheFirst(e.request));
});

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Network-First (for HTML)
//  Always tries the network. Falls back to cache only offline.
//  Updates the cache whenever a fresh response arrives.
// ─────────────────────────────────────────────────────────────
async function networkFirstHtml(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline — serve cached shell if available
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Aria is offline. Please reconnect.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Cache-First (for JS/CSS/fonts/images)
// ─────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);

    if (response && response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone());
    }

    return response;
  } catch {
    return new Response('Aria is offline. Please reconnect.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Stale-While-Revalidate (for cross-origin assets)
// ─────────────────────────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || networkFetch;
}
