// XENA Engine - Proxy Bridge
var BACKEND_URL = "https://xena-backend-1a4t.onrender.com";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(reg) {
        console.log('Proxy bridge active with scope:', reg.scope);
      })
      .catch(function(err) {
        console.error('Proxy bridge registration failed:', err.message);
      });
  });

  // Listen for messages from SW asking for transport mode
  navigator.serviceWorker.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'xena-get-transport') {
      var mode = localStorage.getItem('xnTransportMode') || '1';
      event.ports[0].postMessage({
        type: 'xena-transport-mode',
        mode: mode
      });
    }
  });
}