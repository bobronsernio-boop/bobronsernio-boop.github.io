// XENA Engine – Scramjet controller + iframe wiring
(function () {
  'use strict';

  let controller = null;
  let frame = null;
  let ready = false;

  // ---------- Load Scramjet bundle ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function init() {
    if (ready) return;
    try {
      await loadScript('/scram/scramjet.bundle.js');

      const { ScramjetController } = $scramjetLoadController();
      controller = new ScramjetController({
        prefix: '/scramjet/', // any prefix works – we use it only for the frame
        files: {
          wasm: '/scram/scramjet.wasm.wasm',
          all: '/scram/scramjet.all.js',
          sync: '/scram/scramjet.sync.js'
        }
      });

      await controller.init();

      // Create a ScramjetFrame from the existing iframe
      const iframe = document.getElementById('rframe');
      frame = controller.createFrame(iframe);

      // Register service‑worker
      if ('serviceWorker' in navigator) {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      }

      ready = true;
      console.log('[XENA] Scramjet ready');
    } catch (e) {
      console.error('[XENA] Scramjet init error:', e);
    }
  }

  // ---------- Public API ----------
  window.XENA = {
    init,
    navigate: url => {
      if (frame) {
        try {
          frame.navigate(url);
          return;
        } catch (_) {}
      }
      // Fallback – direct navigation
      document.getElementById('rframe').src = url;
    }
  };

  // Auto‑init on page load
  if (document.readyState === 'complete') init();
  else window.addEventListener('load', init);
})();
