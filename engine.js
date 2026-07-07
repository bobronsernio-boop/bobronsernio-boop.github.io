// XENA Engine - Proxy Bridge
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
}
