// ─────────────────────────────────────────────────────────────
//  ARIA SERVICE WORKER  v2.0
//  Asset caching (cache-first) + Web Share Target forwarding
// ─────────────────────────────────────────────────────────────

// Bump this version string whenever you deploy new JS/CSS/HTML.
// The activate handler will automatically purge the old cache.
const CACHE_VERSION = 'aria-v3';

// App-shell assets to pre-cache on install.
// These load instantly on every subsequent visit — no network needed.
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
// API calls, auth, TTS, and AI completions must always hit the network.
const NEVER_CACHE_ORIGINS = [
  'mmtdtcmhvbruubrjgjrz.supabase.co',   // Supabase (auth + DB + edge functions)
  'api.anthropic.com',                    // Anthropic (if ever called direct)
  'api.elevenlabs.io',                    // ElevenLabs TTS
];

// ── 2b. Same-origin dynamic routes → network only ───────────
//    FIX: AI chat responses were being cached and replayed here.
if (
  url.origin === ALLOWED_ORIGIN &&
  NEVER_CACHE_PATHS.some(path => url.pathname.startsWith(path))
) {
  return;
}

// Same-origin path prefixes that must NEVER be cached.
// Caching these was the root cause of Aria replaying old AI responses.
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
      .then(() => self.skipWaiting())   // activate immediately, don't wait for tabs to close
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
          .filter(k => k !== CACHE_VERSION)   // delete anything that isn't the current version
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())        // take control of all open tabs immediately
  );
});

// ─────────────────────────────────────────────────────────────
//  FETCH — route every request through the right strategy
// ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // ── 1. Web Share Target (GET /?text=...&title=...) ──────────
  //    Intercept, forward to open windows, redirect to clean URL.
  //    Preserved exactly from original sw.js.
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

  // ── 2. API / dynamic origins → network only, never cache ────
  //    Supabase, Anthropic, ElevenLabs responses must be fresh.
  if (NEVER_CACHE_ORIGINS.some(host => url.hostname.includes(host))) {
    // Just let the request fall through — the browser handles it normally
    return;
  }

  // ── 3. Non-GET requests → network only ──────────────────────
  //    POST, PUT, DELETE etc. must never be served from cache.
  if (e.request.method !== 'GET') return;

  // ── 4. Cross-origin CDN assets (fonts, scripts) → stale-while-revalidate ──
  //    Cache a copy after first fetch; serve the cached version while
  //    fetching a fresh one in the background for next time.
  if (url.origin !== ALLOWED_ORIGIN) {
    e.respondWith(staleWhileRevalidate(e.request));
    return;
  }

  // ── 5. Same-origin assets → cache-first ─────────────────────
  //    JS, CSS, HTML: serve instantly from cache; fall back to
  //    network if not cached yet (and store the response for next time).
  e.respondWith(cacheFirst(e.request));
});

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Cache-First
//  Best for: versioned JS/CSS/HTML that rarely change mid-session.
//  Upgrade path: bump CACHE_VERSION → install event refills the cache.
// ─────────────────────────────────────────────────────────────
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  // Not in cache yet — fetch from network and store for next time
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(request, response.clone()); // clone: body can only be consumed once
    }
    return response;
  } catch {
    // Offline and not cached — return a minimal offline fallback
    return new Response('Aria is offline. Please reconnect.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  STRATEGY: Stale-While-Revalidate
//  Best for: CDN assets (Google Fonts, jsDelivr scripts).
//  Serves the cached copy immediately; quietly fetches a fresh
//  copy in the background so the next visit gets the update.
// ─────────────────────────────────────────────────────────────
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);

  // Kick off a background refresh regardless
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null); // swallow network errors silently

  // Return cached immediately if available, otherwise await network
  return cached || networkFetch;
}
