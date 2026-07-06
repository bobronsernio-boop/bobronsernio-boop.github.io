// Register the Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Proxy bridge active with scope:', reg.scope))
      .catch(err => console.error('Proxy bridge registration failed:', err));
  });
}

// Your existing engine logic continues below...
// Ensure all your fetch requests in engine.js are using relative paths
// like '/tunnel?url=...' so they are intercepted by the SW.
const BACKEND_URL = "https://xena-backend-1a4t.onrender.com";

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/xn/')) {
    event.respondWith(fetch(`${BACKEND_URL}/tunnel`, {
      method: 'POST',
      body: JSON.stringify({ url: atob(event.request.url.split('/xn/')[1]), method: 'GET' })
    }));
  }
});
