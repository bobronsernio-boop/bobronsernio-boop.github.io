// XENA Engine Controller — Scramjet
(function() {
  'use strict';
  
  let scramjetController = null;
  let scramjetFrame = null;
  let initialized = false;
  
  async function init() {
    if (initialized) return;
    
    try {
      // Load Scramjet bundle
      await loadScript('/scram/scramjet.bundle.js');
      
      // Create controller
      const { ScramjetController } = $scramjetLoadController();
      scramjetController = new ScramjetController({
        prefix: '/scramjet/',
        files: {
          wasm: '/scram/scramjet.wasm.wasm',
          all: '/scram/scramjet.all.js',
          sync: '/scram/scramjet.sync.js'
        }
      });
      
      await scramjetController.init();
      
      // Create frame from existing iframe
      const frameEl = document.getElementById('rframe');
      scramjetFrame = scramjetController.createFrame(frameEl);
      
      initialized = true;
      console.log('[XENA] Scramjet ready');
      
      // Register SW
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('[XENA] SW registered');
      }
      
      // Update footer
      document.getElementById('footerstatus').textContent = 'scramjet ready';
      const dot = document.getElementById('statusdot');
      dot.style.background = '#22c55e';
      dot.style.boxShadow = '0 0 4px #22c55e';
    } catch (e) {
      console.error('[XENA] Init failed:', e);
      document.getElementById('footerstatus').textContent = 'scramjet: ' + e.message.slice(0, 30);
    }
  }
  
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  
  function navigate(url) {
    if (scramjetFrame) {
      try { scramjetFrame.navigate(url); return; } catch(e) {}
    }
    // Fallback
    document.getElementById('rframe').src = '/scramjet/' + btoa(url);
  }
  
  window.XENA = { init, navigate, getController: () => scramjetController };
  
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
