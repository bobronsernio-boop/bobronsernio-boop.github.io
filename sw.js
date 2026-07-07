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
    var headers = {};
    ['User-Agent','Accept','Accept-Language','Cookie','Range','Referer','Content-Type'].forEach(h => {
      var v = event.request.headers.get(h);
      if (v) headers[h] = v;
    });
    if (!headers['User-Agent']) {
      headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    }
    
    // Always use backend for reliability
    var body = null;
    if (!['GET','HEAD'].includes(event.request.method)) {
      body = Array.from(new Uint8Array(await event.request.clone().arrayBuffer()));
    }
    
    var resp = await fetch(BACKEND + '/tunnel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: target, method: event.request.method, headers, body })
    });
    
    if (!resp.ok) {
      // Fallback: direct fetch
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
      text = rewriteCSS(text, originalUrl);
      return new Response(text, { status: resp.status, headers: outHeaders });
    });
  }
  
  if (ct.includes('javascript') || ct.includes('ecmascript')) {
    return resp.text().then(text => {
      text = rewriteJS(text, originalUrl);
      return new Response(text, { status: resp.status, headers: outHeaders });
    });
  }
  
  return resp.arrayBuffer().then(buf => new Response(buf, { status: resp.status, headers: outHeaders }));
}

function rewriteURL(val, base) {
  // Skip empty, anchors, data URIs, javascript:, blob:, mailto:, etc.
  if (!val || val.startsWith('#') || val.startsWith('data:') || 
      val.startsWith('javascript:') || val.startsWith('about:') || 
      val.startsWith('blob:') || val.startsWith('mailto:') ||
      val.startsWith('tel:') || val.startsWith('//')) return null;
  
  // If it's already a proxied URL, skip
  if (val.startsWith('/xn/') || val.startsWith('/yt/')) return null;
  
  // If it's a root-relative path (/dist/..., /font/..., etc.)
  if (val.startsWith('/')) {
    try {
      var absolute = new URL(val, base).href;
      return '/xn/' + enc(absolute);
    } catch(e) { return null; }
  }
  
  // If it's a full URL
  if (val.includes('://')) {
    try {
      return '/xn/' + enc(new URL(val, base).href);
    } catch(e) { return null; }
  }
  
  // Relative path (not starting with /) — resolve against base
  try {
    var absolute = new URL(val, base).href;
    return '/xn/' + enc(absolute);
  } catch(e) { return null; }
  
  return null;
}

function rewriteHTML(html, base) {
  try {
    // Rewrite href, src, action, poster, data-src, data-href, srcset, imagesrcset
    html = html.replace(
      /\s(href|src|action|poster|data-src|data-href)=(['"])([^'"]*)\2/gi,
      function(m, attr, quote, val) {
        var rewritten = rewriteURL(val, base);
        if (rewritten) return ' ' + attr + '=' + quote + rewritten + quote;
        return m;
      }
    );
    
    // Rewrite srcset (comma-separated URLs)
    html = html.replace(
      /\ssrcset=(['"])([^'"]*)\1/gi,
      function(m, quote, val) {
        if (!val) return m;
        var items = val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
        var rewritten = items.map(function(item) {
          var parts = item.trim().split(/\s+/);
          if (!parts.length || !parts[0]) return item;
          var r = rewriteURL(parts[0], base);
          if (r) return r + (parts[1] ? ' ' + parts[1] : '');
          return item;
        });
        return ' srcset=' + quote + rewritten.join(', ') + quote;
      }
    );
    
    // Rewrite url() references in inline styles
    html = html.replace(
      /url\((['"]?)([^'")\s]+)\1\)/gi,
      function(m, quote, val) {
        var r = rewriteURL(val, base);
        if (r) return 'url(' + r + ')';
        return m;
      }
    );
    
    // Rewrite <link> href for stylesheets/preloads
    html = html.replace(
      /<link\s([^>]*?)href=(['"])([^'"]*)\2([^>]*?)>/gi,
      function(m, before, quote, val, after) {
        var r = rewriteURL(val, base);
        if (r) return '<link ' + before + 'href=' + quote + r + quote + after + '>';
        return m;
      }
    );
    
    // Rewrite <meta http-equiv="refresh" content="0;url=...">
    html = html.replace(
      /<meta\s([^>]*?)content=(['"])(\d+);\s*url=([^'"]*)\2([^>]*?)>/gi,
      function(m, before, quote, sec, url, after) {
        var r = rewriteURL(url, base);
        if (r) return '<meta ' + before + 'content=' + quote + sec + ';url=' + r + quote + after + '>';
        return m;
      }
    );
    
    // Inject runtime patcher
    var patcher = '<script>' +
    '(function(){' +
    'var K=[120,101,110,97];' +
    'function eu(u){var o="";for(var i=0;i<u.length;i++)o+=String.fromCharCode(u.charCodeAt(i)^K[i%4]);return btoa(o).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}' +
    'function pu(u){' +
    'if(!u||u.startsWith("#")||u.startsWith("data:")||u.startsWith("javascript:")||u.startsWith("about:")||u.startsWith("blob:")||u.startsWith("//"))return u;' +
    'if(u.startsWith("/xn/")||u.startsWith("/yt/"))return u;' +
    'try{var a=new URL(u,window.location.href).href;if(a.indexOf(window.origin)>-1)return u;return"/xn/"+eu(a);}catch(e){return u;}}' +
    
    // Patch setAttribute
    'var _sa=Element.prototype.setAttribute;' +
    'Element.prototype.setAttribute=function(n,v){' +
    'if(typeof v==="string"&&(n==="src"||n==="href"||n==="action"||n==="data-src"||n==="poster")){' +
    'var r=pu(v);if(r!==v)return _sa.call(this,n,r);}' +
    'return _sa.call(this,n,v);};' +
    
    // Patch Image.src
    'try{var _id=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");' +
    'if(_id&&_id.set){Object.defineProperty(HTMLImageElement.prototype,"src",{' +
    'set:function(v){if(typeof v==="string"){var r=pu(v);if(r!==v){_id.set.call(this,r);return;}}_id.set.call(this,v);},' +
    'get:function(){return _id.get.call(this);}});}}catch(e){}' +
    
    // Patch fetch
    'var _fw=window.fetch;' +
    'window.fetch=function(i,o){' +
    'if(typeof i==="string"){var r=pu(i);if(r!==i)return _fw(r,o);}' +
    'return _fw(i,o);};' +
    
    // Patch XMLHttpRequest
    'try{var _x=XMLHttpRequest.prototype.open;' +
    'XMLHttpRequest.prototype.open=function(m,u){' +
    'if(typeof u==="string"){var r=pu(u);if(r!==u)arguments[1]=r;}' +
    'return _x.apply(this,arguments);};}catch(e){}' +
    
    // Patch createElement to intercept script/link creation
    'var _ce=document.createElement.bind(document);' +
    'document.createElement=function(tag,opts){' +
    'var el=_ce(tag,opts);' +
    'if(tag==="script"||tag==="link"||tag==="img"||tag==="iframe"){' +
    'var _ss=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");' +
    '}' +
    'return el;};' +
    
    // Click handler for links
    'document.addEventListener("click",function(e){' +
    'var t=e.target;while(t&&t.tagName!=="A")t=t.parentElement;' +
    'if(t&&t.href){' +
    'var h=t.getAttribute("href");' +
    'if(h&&!h.startsWith("/xn/")&&!h.startsWith("#")&&!h.startsWith("javascript:")&&!h.startsWith("data:")&&!h.startsWith("about:")&&!h.startsWith("//")){' +
    'try{var a=new URL(h,window.location.href).href;if(a.indexOf(window.origin)===-1){e.preventDefault();window.parent.postMessage({type:"xena-open",url:a},"*");}}catch(e){}}}},true);' +
    
    // Submit handler
    'document.addEventListener("submit",function(e){' +
    'var f=e.target;if(!f)return;' +
    'var a=f.getAttribute("action");' +
    'if(a&&!a.startsWith("/xn/")&&!a.startsWith("#")&&!a.startsWith("javascript:")&&!a.startsWith("data:")&&!a.startsWith("//")){' +
    'e.preventDefault();try{window.location.href=pu(a);}catch(e){}}},true);' +
    
    '})();' +
    '</script></head>';
    
    html = html.replace('</head>', patcher);
    
  } catch(e) {
    console.error('rewriteHTML error:', e.message);
  }
  return html;
}

function rewriteCSS(text, base) {
  try {
    text = text.replace(
      /url\((['"]?)([^'")\s]+)\1\)/gi,
      function(m, quote, val) {
        var r = rewriteURL(val, base);
        if (r) return 'url(' + r + ')';
        return m;
      }
    );
    
    // Rewrite @import statements
    text = text.replace(
      /@import\s+(?:url\()?(['"]?)([^'")\s]+)\1(?:\))?/gi,
      function(m, quote, val) {
        var r = rewriteURL(val, base);
        if (r) return '@import \'' + r + '\'';
        return m;
      }
    );
  } catch(e) {}
  return text;
}

function rewriteJS(text, base) {
  try {
    // Rewrite string literals that look like URLs
    // This is a best-effort approach
    text = text.replace(
      /(['"])(https?:\/\/[^'"]+)\1/g,
      function(m, quote, url) {
        try {
          return quote + '/xn/' + enc(new URL(url, base).href) + quote;
        } catch(e) { return m; }
      }
    );
  } catch(e) {}
  return text;
}

function errorResponse(code, title, message) {
  return Response.redirect('/error.html?rc=' + btoa(JSON.stringify({
    code: code || 'XNA-502',
    title: title || 'Proxy Error',
    message: message || 'Unknown error',
    timestamp: Date.now()
  })));
}
