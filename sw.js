// ─────────────────────────────────────────────────────────────
//  ARIA SERVICE WORKER  v3.0
//  SAFE asset caching (cache-first) + Web Share Target forwarding
//  FIXED: prevents AI/chat/API responses from being cached/replayed
// ─────────────────────────────────────────────────────────────

// Bump this version string whenever you deploy new JS/CSS/HTML.
const CACHE_VERSION = 'aria-v3';

// App-shell assets to pre-cache on install.
// Keep this list small and stable.
const SHELL_ASSETS = [
  '/',
  '/index.html',
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
//  INSTALL — pre-cache the app shell
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

  // ── 5. Only cache STATIC asset file types (safe caching) ────
  // This prevents caching HTML/API responses that cause loops.
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

  // ── 6. Cross-origin static assets → stale-while-revalidate ───
  if (url.origin !== ALLOWED_ORIGIN) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // ── 7. Same-origin static assets → cache-first ──────────────
  e.respondWith(cacheFirst(e.request));
});

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Cache-First
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
//  STRATEGY: Stale-While-Revalidate
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
