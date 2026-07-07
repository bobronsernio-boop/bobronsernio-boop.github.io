// XENA v3 - Service Worker (Render backend proxy)
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
    // Build headers
    var headers = {};
    ['User-Agent','Accept','Accept-Language','Cookie','Range','Referer','Content-Type'].forEach(h => {
      var v = event.request.headers.get(h);
      if (v) headers[h] = v;
    });
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }
    
    // Get transport mode
    var mode = 1;
    try { mode = parseInt(localStorage.getItem('xnTransportMode')) || 1; } catch(e) {}
    
    var resp;
    
    if (mode === 3) {
      // Mode 3: Direct SW fetch (no backend)
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
    } else {
      // Mode 1 & 2: Go through Render backend
      var body = null;
      if (!['GET','HEAD'].includes(event.request.method)) {
        body = Array.from(new Uint8Array(await event.request.clone().arrayBuffer()));
      }
      
      resp = await fetch(BACKEND + '/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, method: event.request.method, headers, body })
      });
      
      if (!resp.ok && resp.status !== 304) {
        // If backend fails, try direct as fallback
        console.log('Backend returned ' + resp.status + ', falling back to direct fetch');
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
    }
    
    return processResponse(resp, target);
    
  } catch(err) {
    console.error('Proxy error:', err.message);
    return errorResponse('XNA-502', 'Connection Failed', err.message);
  }
}

function processResponse(resp, originalUrl) {
  var ct = (resp.headers.get('content-type') || '').toLowerCase();
  
  var outHeaders = {
    'Access-Control-Allow-Origin': '*',
    'X-Frame-Options': 'SAMEORIGIN'
  };
  
  ['content-type','content-length','content-disposition','cache-control',
   'set-cookie','accept-ranges','content-range','last-modified','etag',
   'date','content-encoding'
  ].forEach(h => {
    var v = resp.headers.get(h);
    if (v) outHeaders[h] = v;
  });
  
  if (ct.includes('text/html')) {
    return resp.text().then(html => {
      html = rewriteHTML(html, originalUrl);
      outHeaders['content-type'] = 'text/html; charset=utf-8';
      return new Response(html, { status: resp.status, headers: outHeaders });
    });
  }
  
  if (ct.includes('css')) {
    return resp.text().then(text => {
      text = text.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, (m, val) => {
        if (!val || val.startsWith('data:') || val.startsWith('#')) return m;
        try { return "url('/xn/" + enc(new URL(val, originalUrl).href) + "')"; } catch(e) { return m; }
      });
      return new Response(text, { status: resp.status, headers: outHeaders });
    });
  }
  
  return resp.arrayBuffer().then(buf => new Response(buf, { status: resp.status, headers: outHeaders }));
}

function rewriteHTML(html, base) {
  try {
    html = html.replace(/\s(href|src|action|poster|data-src|data-href)=['"]([^'"]*)['"]/gi, (m, attr, val) => {
      if (!val || val.startsWith('#') || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('about:') || val.startsWith('blob:') || !val.includes('://')) return m;
      try { return ' ' + attr + '="/xn/' + enc(new URL(val, base).href) + '"'; } catch(e) { return m; }
    });
    
    html = html.replace(/\ssrcset=['"]([^'"]*)['"]/gi, (m, val) => {
      if (!val) return m;
      return ' srcset="' + val.split(',').map(s => {
        var parts = s.trim().split(/\s+/);
        if (!parts[0]) return s;
        try { return '/xn/' + enc(new URL(parts[0], base).href) + (parts[1] ? ' ' + parts[1] : ''); } catch(e) { return s; }
      }).join(', ') + '"';
    });
    
    html = html.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, (m, val) => {
      if (!val || val.startsWith('data:') || val.startsWith('#')) return m;
      try { return "url('/xn/" + enc(new URL(val, base).href) + "')"; } catch(e) { return m; }
    });
    
    var patcher = '<script>' +
    '(function(){' +
    'var K=[120,101,110,97];' +
    'function eu(u){var o="";for(var i=0;i<u.length;i++)o+=String.fromCharCode(u.charCodeAt(i)^K[i%4]);return btoa(o).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}' +
    'function pu(u){if(!u||!u.includes("://")||u.includes("/xn/")||u.indexOf(window.origin)>-1)return u;try{return"/xn/"+eu(new URL(u,window.location.href).href);}catch(e){return u;}}' +
    'var _sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(typeof v==="string"&&(n==="src"||n==="href"||n==="action"||n==="data-src")&&v.includes("://")&&!v.includes("/xn/")&&v.indexOf(window.origin)===-1){try{return _sa.call(this,n,pu(v));}catch(e){}}return _sa.call(this,n,v);};' +
    'try{var _id=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(_id&&_id.set){Object.defineProperty(HTMLImageElement.prototype,"src",{set:function(v){if(typeof v==="string"&&v.includes("://")&&!v.includes("/xn/")&&v.indexOf(window.origin)===-1){try{_id.set.call(this,pu(v));return;}catch(e){}}_id.set.call(this,v);},get:function(){return _id.get.call(this);}});}}catch(e){}' +
    'var _fw=window.fetch;window.fetch=function(i,o){if(typeof i==="string"&&i.includes("://")&&!i.includes("/xn/")&&i.indexOf(window.origin)===-1){return _fw(pu(i),o);}return _fw(i,o);};' +
    'try{var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(typeof u==="string"&&u.includes("://")&&!u.includes("/xn/")&&u.indexOf(window.origin)===-1){arguments[1]=pu(u);}return _x.apply(this,arguments);};}catch(e){}' +
    'var _ow=window.open;window.open=function(u,n,f){if(typeof u==="string"&&u.includes("://")&&!u.includes("/xn/")){var pu2=pu(u);if(pu2!==u){try{window.parent.postMessage({type:"xena-open",url:u},"*");}catch(e){}return null;}}return _ow.call(window,u,n,f);};' +
    'document.addEventListener("click",function(e){var t=e.target;while(t&&t.tagName!=="A")t=t.parentElement;if(t&&t.href){var h=t.getAttribute("href");if(h&&!h.startsWith("/xn/")&&!h.startsWith("#")&&!h.startsWith("javascript:")&&!h.startsWith("data:")&&!h.startsWith("about:")&&h.includes("://")){e.preventDefault();try{window.parent.postMessage({type:"xena-open",url:h},"*");}catch(e){}}}},true);' +
    'document.addEventListener("submit",function(e){var f=e.target;if(!f)return;var a=f.getAttribute("action");if(a&&!a.startsWith("/xn/")&&!a.startsWith("#")&&!a.startsWith("javascript:")&&!a.startsWith("data:")&&a.includes("://")){e.preventDefault();try{window.location.href=pu(a);}catch(e){}}},true);' +
    '})();' +
    '</script></head>';
    
    html = html.replace('</head>', patcher);
  } catch(e) {}
  return html;
}

function errorResponse(code, title, message) {
  return Response.redirect('/error.html?rc=' + btoa(JSON.stringify({
    code: code || 'XNA-502',
    title: title || 'Proxy Error',
    message: message || 'Unknown error',
    timestamp: Date.now()
  })));
}