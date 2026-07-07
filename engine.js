// XENA Engine - Proxy Bridge
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(reg) {
        console.log('Proxy bridge active with scope:', reg.scope);
        document.getElementById('statusdot').style.background = '#22c55e';
        document.getElementById('statusdot').style.boxShadow = '0 0 4px #22c55e';
        document.getElementById('footerstatus').textContent = 'connected';
      })
      .catch(function(err) {
        console.error('Proxy bridge registration failed:', err.message);
        document.getElementById('statusdot').style.background = '#ef4444';
        document.getElementById('statusdot').style.boxShadow = '0 0 4px #ef4444';
        document.getElementById('footerstatus').textContent = 'disconnected';
      });
  });
}
