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
    
    var body = null;
    if (!['GET','HEAD'].includes(event.request.method)) {
      body = Array.from(new Uint8Array(await event.request.clone().arrayBuffer()));
    }
    
    // Try backend with timeout
    var resp;
    try {
      resp = await fetch(BACKEND + '/tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: target, method: event.request.method, headers, body })
      });
    } catch(e) {
      console.log('Backend error:', e.message);
      resp = null;
    }
    
    // Fallback to direct fetch if backend fails
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
    
    // Pass through directly - server already rewrote everything
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
    
    var ct = (resp.headers.get('content-type') || '').toLowerCase();
    
    // For HTML, inject runtime patcher if not already present
    if (ct.includes('text/html')) {
      return resp.text().then(function(html) {
        if (!html.includes('xena-open')) {
          html = injectPatcher(html, target);
        }
        outHeaders['content-type'] = 'text/html; charset=utf-8';
        return new Response(html, { status: resp.status, headers: outHeaders });
      });
    }
    
    // Everything else passes through
    return resp.arrayBuffer().then(function(buf) {
      return new Response(buf, { status: resp.status, headers: outHeaders });
    });
    
  } catch(err) {
    return errorResponse('XNA-502', 'Connection Failed', err.message);
  }
}

function injectPatcher(html, base) {
  try {
    var patcher = '<script>' +
    '(function(){' +
    'var K=[120,101,110,97];' +
    'function eu(u){var o="";for(var i=0;i<u.length;i++)o+=String.fromCharCode(u.charCodeAt(i)^K[i%4]);return btoa(o).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");}' +
    'function pu(u){' +
    'if(!u||typeof u!=="string"||u.startsWith("#")||u.startsWith("data:")||u.startsWith("javascript:")||u.startsWith("about:")||u.startsWith("blob:")||u.startsWith("//")||u.startsWith("ws:")||u.startsWith("wss:"))return u;' +
    'if(u.startsWith("/xn/")||u.startsWith("/yt/"))return u;' +
    'try{var a=new URL(u,window.location.href).href;if(a.indexOf(window.origin)>-1)return u;return"/xn/"+eu(a);}catch(e){return u}}' +
    'var _sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(typeof v==="string"&&["src","href","action","data-src","poster","data-href","cite","codebase","longdesc"].includes(n)){var r=pu(v);if(r!==v)return _sa.call(this,n,r)}return _sa.call(this,n,v)};' +
    'try{var _id=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,"src");if(_id&&_id.set){Object.defineProperty(HTMLImageElement.prototype,"src",{set:function(v){if(typeof v==="string"){var r=pu(v);if(r!==v){_id.set.call(this,r);return}}_id.set.call(this,v)},get:function(){return _id.get.call(this)}})}}catch(e){}' +
    'try{var _sd=Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype,"src");if(_sd&&_sd.set){Object.defineProperty(HTMLScriptElement.prototype,"src",{set:function(v){if(typeof v==="string"){var r=pu(v);if(r!==v){_sd.set.call(this,r);return}}_sd.set.call(this,v)},get:function(){return _sd.get.call(this)}})}}catch(e){}' +
    'try{var _ifd=Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype,"src");if(_ifd&&_ifd.set){Object.defineProperty(HTMLIFrameElement.prototype,"src",{set:function(v){if(typeof v==="string"){var r=pu(v);if(r!==v){_ifd.set.call(this,r);return}}_ifd.set.call(this,v)},get:function(){return _ifd.get.call(this)}})}}catch(e){}' +
    'var _fw=window.fetch;window.fetch=function(i,o){if(typeof i==="string"){var r=pu(i);if(r!==i)return _fw(r,o)}if(i&&i.url&&typeof i.url==="string"){var r=pu(i.url);if(r!==i.url){var n=new Request(r,i);return _fw(n,o)}}return _fw(i,o)};' +
    'try{var _x=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){if(typeof u==="string"){var r=pu(u);if(r!==u)arguments[1]=r}return _x.apply(this,arguments)}}catch(e){}' +
    'var _ow=window.open;window.open=function(u,n,f){if(typeof u==="string"&&!u.startsWith("/xn/")&&!u.startsWith("#")&&!u.startsWith("data:")&&!u.startsWith("about:")){try{var a=new URL(u,window.location.href).href;if(a.indexOf(window.origin)===-1){window.parent.postMessage({type:"xena-open",url:a},"*");return null}}catch(e){}}return _ow.apply(window,arguments)};' +
    'document.addEventListener("click",function(e){var t=e.target;while(t&&t.tagName!=="A")t=t.parentElement;if(t&&t.href){var h=t.getAttribute("href");if(h&&!h.startsWith("/xn/")&&!h.startsWith("#")&&!h.startsWith("javascript:")&&!h.startsWith("data:")&&!h.startsWith("about:")&&!h.startsWith("//")){try{var a=new URL(h,window.location.href).href;if(a.indexOf(window.origin)===-1){e.preventDefault();window.parent.postMessage({type:"xena-open",url:a},"*")}}catch(e){}}}},true);' +
    'document.addEventListener("submit",function(e){var f=e.target;if(!f||!f.tagName)return;var a=f.getAttribute("action");if(a&&!a.startsWith("/xn/")&&!a.startsWith("#")&&!a.startsWith("javascript:")&&!a.startsWith("data:")&&!a.startsWith("//")&&!a.startsWith("/")){e.preventDefault();try{window.location.href=pu(a)}catch(e){}}},true);' +
    'try{var _mo=new MutationObserver(function(muts){muts.forEach(function(mut){mut.addedNodes.forEach(function(n){if(n.nodeType===1){if((n.tagName==="IFRAME"||n.tagName==="EMBED"||n.tagName==="OBJECT")&&n.src&&!n.src.startsWith(window.origin)&&!n.src.startsWith("/xn/")&&!n.src.startsWith("about:")){try{n.src=pu(n.src)}catch(e){}}if(n.querySelectorAll){var els=n.querySelectorAll("[src],[href],[action],[data-src],[poster],[cite]");els.forEach(function(el){["src","href","action","data-src","poster","cite"].forEach(function(attr){var v=el.getAttribute(attr);if(v&&typeof v==="string"&&(v.includes("://")||v.startsWith("/"))&&!v.startsWith("/xn/")&&!v.startsWith("/yt/")&&!v.startsWith("#")&&!v.startsWith("data:")&&!v.startsWith("javascript:")&&!v.startsWith("about:")){var p=pu(v);if(p!==v){try{el.setAttribute(attr,p)}catch(e){}}}})})}}})})});_mo.observe(document.documentElement,{childList:true,subtree:true})}catch(e){}' +
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
