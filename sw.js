// Aria Service Worker — handles Web Share Target
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Intercept share_target requests (GET /?text=...&title=...&url=...)
  if (url.pathname === '/' && (url.searchParams.has('text') || url.searchParams.has('title'))) {
    const title = url.searchParams.get('title') || '';
    const text  = url.searchParams.get('text')  || '';
    const sharedUrl = url.searchParams.get('url') || '';

    e.respondWith(
      (async () => {
        // Send the shared data to the app window
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'SHARE_TARGET', title, text, url: sharedUrl });
        }
        // Redirect to clean URL so params don't persist
        return Response.redirect('/', 303);
      })()
    );
  }
});
