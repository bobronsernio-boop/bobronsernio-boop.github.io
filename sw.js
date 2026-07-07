// XENA v3 - Service Worker (standalone - no backend needed)
var K = [120, 101, 110, 97];

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

self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (url.pathname.startsWith('/xn/') || url.pathname.startsWith('/yt/')) {
    event.respondWith(handleRequest(event));
  }
});

async function handleRequest(event) {
  var url = new URL(event.request.url);
  var prefix = url.pathname.startsWith('/yt/') ? '/yt/' : '/xn/';
  var token = url.pathname.slice(prefix.length);
  
  if (!token) return new Response('No token', { status: 400 });
  
  var target = dec(token);
  if (!target) return new Response('Invalid token', { status: 400 });
  
  // Merge query params from the proxied URL
  if (url.search) {
    try {
      var tu = new URL(target);
      var sp = new URLSearchParams(url.search.substring(1));
      sp.forEach(function(v, k) {
        if (!tu.searchParams.has(k)) tu.searchParams.append(k, v);
      });
      target = tu.href;
    } catch(e) {}
  }
  
  try {
    // Build fetch headers from the original request
    var headers = {};
    
    // Forward these specific headers
    var forwardHeaders = ['User-Agent', 'Accept', 'Accept-Language', 'Cookie', 'Range', 'Referer', 'Content-Type'];
    forwardHeaders.forEach(function(h) {
      var v = event.request.headers.get(h);
      if (v) headers[h] = v;
    });
    
    // Always ensure a browser User-Agent
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }
    
    var fetchOpts = {
      method: event.request.method,
      headers: headers,
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow'
    };
    
    // Forward body for POST/PUT etc
    if (!['GET', 'HEAD'].includes(event.request.method)) {
      fetchOpts.body = await event.request.clone().blob();
    }
    
    var resp = await fetch(target, fetchOpts);
    
    // Process the response
    return processResponse(resp, target);
    
  } catch(err) {
    return new Response('Proxy error: ' + err.message, { status: 502 });
  }
}

function processResponse(resp, originalUrl) {
  var ct = (resp.headers.get('content-type') || '').toLowerCase();
  
  var outHeaders = {
    'Access-Control-Allow-Origin': '*',
    'X-Frame-Options': 'SAMEORIGIN'
  };
  
  var passHeaders = [
    'content-type', 'content-length', 'content-disposition', 'cache-control',
    'set-cookie', 'accept-ranges', 'content-range', 'last-modified', 'etag',
    'date', 'content-encoding'
  ];
  passHeaders.forEach(function(h) {
    var v = resp.headers.get(h);
    if (v) outHeaders[h] = v;
  });
  
  // Handle HTML - rewrite URLs
  if (ct.includes('text/html')) {
    return resp.text().then(function(html) {
      html = rewriteHTML(html, originalUrl);
      outHeaders['content-type'] = 'text/html; charset=utf-8';
      return new Response(html, { status: resp.status, headers: outHeaders });
    });
  }
  
  // Handle CSS - rewrite url() references
  if (ct.includes('css')) {
    return resp.text().then(function(text) {
      text = text.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, function(m, val) {
        if (!val || val.startsWith('data:') || val.startsWith('#')) return m;
        try { return "url('/xn/" + enc(new URL(val, originalUrl).href) + "')"; } catch(e) { return m; }
      });
      return new Response(text, { status: resp.status, headers: outHeaders });
    });
  }
  
  // Pass through everything else (images, video, JS, etc.)
  return resp.arrayBuffer().then(function(buf) {
    return new Response(buf, { status: resp.status, headers: outHeaders });
  });
}

function rewriteHTML(html, base) {
  try {
    // Rewrite href, src, action, poster, data-src, data-href
    html = html.replace(/\s(href|src|action|poster|data-src|data-href)=['"]([^'"]*)['"]/gi, function(m, attr, val) {
      if (!val || val.startsWith('#') || val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('about:') || val.startsWith('blob:') || !val.includes('://')) return m;
      try { return ' ' + attr + '="/xn/' + enc(new URL(val, base).href) + '"'; } catch(e) { return m; }
    });
    
    // Rewrite srcset
    html = html.replace(/\ssrcset=['"]([^'"]*)['"]/gi, function(m, val) {
      if (!val) return m;
      var items = val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      var rewritten = items.map(function(item) {
        var parts = item.trim().split(/\s+/);
        if (!parts.length) return item;
        try { return '/xn/' + enc(new URL(parts[0], base).href) + (parts[1] ? ' ' + parts[1] : ''); } catch(e) { return item; }
      });
      return ' srcset="' + rewritten.join(', ') + '"';
    });
    
    // Rewrite url() references in inline styles
    html = html.replace(/url\(['"]?([^'")\s]+)['"]?\)/gi, function(m, val) {
      if (!val || val.startsWith('data:') || val.startsWith('#')) return m;
      try { return "url('/xn/" + enc(new URL(val, base).href) + "')"; } catch(e) { return m; }
    });
    
    // Inject runtime patcher script before </head>
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