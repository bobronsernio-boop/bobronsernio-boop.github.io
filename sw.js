// XENA v3 - Service Worker (Proxy bridge)
var K = [120, 101, 110, 97];
var BACKEND = "https://xena-backend-1a4t.onrender.com";

function enc(u) {
  var o = '';
  for (var i = 0; i < u.length; i++) o += String.fromCharCode(u.charCodeAt(i) ^ K[i % 4]);
  return btoa(o).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function dec(s) {
  try {
    var t = s.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var b = atob(t), o = '';
    for (var i = 0; i < b.length; i++) o += String.fromCharCode(b.charCodeAt(i) ^ K[i % 4]);
    return o;
  } catch(e) { return null; }
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  var url = new URL(event.request.url);
  if (url.pathname.startsWith('/xn/') || url.pathname.startsWith('/yt/')) {
    event.respondWith(handle(event));
  }
});

async function handle(event) {
  var url = new URL(event.request.url);
  var prefix = url.pathname.startsWith('/yt/') ? '/yt/' : '/xn/';
  var token = url.pathname.slice(prefix.length);
  
  if (!token) return new Response('No token', { status: 400 });
  
  var target = dec(token);
  if (!target) return new Response('Invalid token', { status: 400 });
  
  // Merge query params
  if (url.search) {
    try {
      var tu = new URL(target);
      var sp = new URLSearchParams(url.search.substring(1));
      sp.forEach((v, k) => { if (!tu.searchParams.has(k)) tu.searchParams.append(k, v); });
      target = tu.href;
    } catch(e) { target += url.search; }
  }
  
  try {
    var headers = {};
    ['User-Agent','Accept','Accept-Language','Cookie','Range','Referer','Content-Type'].forEach(h => {
      var v = event.request.headers.get(h);
      if (v) headers[h] = v;
    });
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }
    
    // Check if this is a media file - use stream endpoint
    var pathExt = target.split('.').pop().toLowerCase();
    var mediaExts = ['jpg','jpeg','png','gif','webp','bmp','ico','svg','mp4','webm','ogg','mp3','wav','flac','m3u8','ts','m4s','m4v','mov','avi','mkv','wmv','flv','woff','woff2','ttf','eot','otf'];
    var isMedia = mediaExts.indexOf(pathExt) !== -1;
    
    var body = null;
    if (!['GET','HEAD'].includes(event.request.method)) {
      body = Array.from(new Uint8Array(await event.request.clone().arrayBuffer()));
    }
    
    var resp;
    
    if (isMedia) {
      // Use stream endpoint for media
      try {
        resp = await fetch(BACKEND + '/tunnel/stream?url=' + encodeURIComponent(target), {
          method: 'GET',
          headers: { 'Range': headers['Range'] || '', 'User-Agent': headers['User-Agent'] }
        });
      } catch(e) {
        resp = null;
      }
    }
    
    if (!resp || !resp.ok) {
      try {
        resp = await fetch(BACKEND + '/tunnel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: target, method: event.request.method, headers, body })
        });
      } catch(e) {
        resp = null;
      }
    }
    
    // Fallback to direct
    if (!resp || !resp.ok) {
      var fetchOpts = {
        method: event.request.method,
        headers: headers,
        mode: 'cors',
        credentials: 'omit',
        redirect: 'follow'
      };
      if (!['GET','HEAD'].includes(event.request.method)) {
        fetchOpts.body = await event.request.clone().blob();
      }
      resp = await fetch(target, fetchOpts);
    }
    
    var outHeaders = {
      'Access-Control-Allow-Origin': '*',
      'X-Frame-Options': 'SAMEORIGIN'
    };
    ['content-type','content-length','content-disposition','cache-control',
     'set-cookie','accept-ranges','content-range','last-modified','etag',
     'date'
    ].forEach(h => {
      var v = resp.headers.get(h);
      if (v) outHeaders[h] = v;
    });
    
    return resp.arrayBuffer().then(function(buf) {
      return new Response(buf, { status: resp.status, headers: outHeaders });
    });
    
  } catch(err) {
    return new Response('Proxy error: ' + err.message, { status: 502 });
  }
}
