const BACKEND_URL = "https://xena-backend-1a4t.onrender.com";

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('/xn/')) {
    event.respondWith(fetch(`${BACKEND_URL}/tunnel`, {
      method: 'POST',
      body: JSON.stringify({ url: atob(event.request.url.split('/xn/')[1]), method: 'GET' })
    }));
  }
});
