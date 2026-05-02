// Aria Service Worker — handles Web Share Target
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── Security: only forward share data to same-origin windows ────────
const ALLOWED_ORIGIN = self.location.origin;

// ── Security: sanitize and cap share payload fields ─────────────────
function sanitizeShareField(val, maxLen) {
  if (typeof val !== 'string') return '';
  // Strip any HTML/script injection attempts
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .slice(0, maxLen)
    .trim();
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle same-origin requests
  if (url.origin !== ALLOWED_ORIGIN) return;

  // Intercept share_target requests (GET /?text=...&title=...&url=...)
  if (url.pathname === '/' && (url.searchParams.has('text') || url.searchParams.has('title'))) {
    // Sanitize and cap all share fields before forwarding
    const title     = sanitizeShareField(url.searchParams.get('title') || '', 200);
    const text      = sanitizeShareField(url.searchParams.get('text')  || '', 2000);
    const sharedUrl = sanitizeShareField(url.searchParams.get('url')   || '', 2048);

    e.respondWith(
      (async () => {
        // Only send to same-origin windows
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          // Verify client is same origin before posting
          if (new URL(client.url).origin === ALLOWED_ORIGIN) {
            client.postMessage({ type: 'SHARE_TARGET', title, text, url: sharedUrl });
          }
        }
        // Redirect to clean URL so params don't persist in history
        return Response.redirect('/', 303);
      })()
    );
  }
});