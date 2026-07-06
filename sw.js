// sw.js - Service Worker for Proxy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Intercept requests directed to the tunnel
  if (url.pathname.startsWith('/tunnel')) {
    event.respondWith(
      fetch(event.request.url, {
        method: event.request.method,
        headers: event.request.headers,
        body: event.request.body
      })
    );
  }
});
