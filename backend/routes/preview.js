const express = require('express');
const http = require('http');
const { getServices } = require('../lib/services');

const router = express.Router();

// Validate that the target port belongs to a registered service
function getRegisteredServicePort(port) {
  const portNum = parseInt(port, 10);
  if (isNaN(portNum) || portNum < 1 || portNum > 65535) return null;
  const services = getServices();
  const match = services.find(s => s.port === portNum);
  return match ? portNum : null;
}

// Check content-type helpers
function isHtmlResponse(contentType) {
  return contentType && contentType.includes('text/html');
}

function isJsResponse(contentType) {
  if (!contentType) return false;
  return contentType.includes('javascript') || contentType.includes('ecmascript');
}

function isCssResponse(contentType) {
  return contentType && contentType.includes('text/css');
}

// Rewrite absolute paths in JS module code so ES import statements like
//   import Foo from "/node_modules/.vite/deps/react.js"
// become
//   import Foo from "/api/preview/5174/node_modules/.vite/deps/react.js"
// This covers: static import/export, dynamic import(), and source map URLs.
function rewriteJsAbsolutePaths(js, prefix) {
  return js
    // Rewrite ES module imports/exports: from "/...", import "/...", import("/..."
    .replace(/(from\s+|import\s*\(\s*|import\s+)(['"`])\/((?!api\/preview\/))/g, `$1$2${prefix}/$3`)
    // Rewrite sourcemap URLs
    .replace(/(\/\/# sourceMappingURL=)\/((?!api\/preview\/))/g, `$1${prefix}/$2`)
    // Rewrite Vite's hardcoded base path: const base = "/" || "/"
    .replace(/(const\s+base(?:\$1)?\s*=\s*)["']\/["']\s*\|\|\s*["']\/["']/g, `$1"${prefix}/" || "${prefix}/"`)
    // Rewrite fetch/new URL calls with string literal absolute paths
    .replace(/((?:fetch|new\s+URL)\s*\(\s*)(['"`])\/((?!api\/preview\/|https?:))/g, `$1$2${prefix}/$3`);
}

// Rewrite absolute url() paths in CSS so assets load through the proxy
function rewriteCssAbsolutePaths(css, prefix) {
  return css.replace(/(url\(\s*['"]?)\/((?!api\/preview\/))/g, `$1${prefix}/$2`);
}

// Rewrite absolute paths in HTML attributes (src="/...", href="/...") so they
// route through the proxy. The <base> tag only affects relative URLs, not
// absolute-path references like "/src/main.jsx".
function rewriteHtmlPaths(html, prefix) {
  return html.replace(/(src|href|action)=(["'])\/((?!\/|api\/preview\/|https?:))/g, `$1=$2${prefix}/$3`);
}

// Build the script injected into proxied HTML. It:
// 1. Resets location to "/" so SPA routers (BrowserRouter) see the correct path
// 2. Intercepts fetch/XHR to route API calls through the proxy
// 3. Patches WebSocket for Vite HMR
function buildProxyScript(targetPort) {
  return `<script>
(function(){
  var B='/api/preview/${targetPort}';
  var P='preview_${targetPort}_';
  // Namespace localStorage so previewed apps don't share storage with the host app
  var _getItem=Storage.prototype.getItem;
  var _setItem=Storage.prototype.setItem;
  var _removeItem=Storage.prototype.removeItem;
  Storage.prototype.getItem=function(k){return _getItem.call(this,P+k);};
  Storage.prototype.setItem=function(k,v){return _setItem.call(this,P+k,v);};
  Storage.prototype.removeItem=function(k){return _removeItem.call(this,P+k);};
  // Fix SPA routing: BrowserRouter reads window.location.pathname.
  // Without this it sees "/api/preview/5174/" which matches no app routes.
  try{history.replaceState(null,'','/');}catch(e){}
  // Patch fetch
  var _f=window.fetch;
  window.fetch=function(u,o){
    if(typeof u==='string'&&u.startsWith('/')&&!u.startsWith(B)){u=B+u;}
    else if(u instanceof Request&&u.url){
      var p=new URL(u.url).pathname;
      if(p.startsWith('/')&&!p.startsWith(B)){u=new Request(B+p,u);}
    }
    return _f.call(this,u,o);
  };
  // Patch XMLHttpRequest
  var _o=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){
    if(typeof u==='string'&&u.startsWith('/')&&!u.startsWith(B)){u=B+u;}
    return _o.apply(this,[m,u].concat(Array.prototype.slice.call(arguments,2)));
  };
  // Patch WebSocket for Vite HMR
  var _W=window.WebSocket;
  window.WebSocket=function(u,p){
    try{
      var url=new URL(u);
      if(url.hostname==='localhost'||url.hostname==='127.0.0.1'){
        url.port='${targetPort}';
        u=url.toString();
      }
    }catch(e){}
    return p!==undefined?new _W(u,p):new _W(u);
  };
  window.WebSocket.prototype=_W.prototype;
  window.WebSocket.CONNECTING=_W.CONNECTING;
  window.WebSocket.OPEN=_W.OPEN;
  window.WebSocket.CLOSING=_W.CLOSING;
  window.WebSocket.CLOSED=_W.CLOSED;
  // Rewrite absolute paths before the browser fetches them.
  // Intercept property setters on src/href/poster so React's property
  // assignments get rewritten BEFORE the browser initiates the request.
  function rw(v){
    if(typeof v==='string'&&v.startsWith('/')&&!v.startsWith(B)&&!v.startsWith('//'))return B+v;
    return v;
  }
  ['src','href','poster'].forEach(function(attr){
    [HTMLImageElement,HTMLVideoElement,HTMLSourceElement,HTMLScriptElement,HTMLLinkElement,HTMLAnchorElement,HTMLIFrameElement].forEach(function(Ctor){
      if(!Ctor||!Ctor.prototype)return;
      var desc=Object.getOwnPropertyDescriptor(Ctor.prototype,attr);
      if(!desc||!desc.set)return;
      var origSet=desc.set;
      var origGet=desc.get;
      Object.defineProperty(Ctor.prototype,attr,{
        set:function(v){origSet.call(this,rw(v));},
        get:function(){return origGet?origGet.call(this):'';},
        configurable:true
      });
    });
  });
  // Also patch setAttribute for libraries that use it directly
  var _sa=Element.prototype.setAttribute;
  Element.prototype.setAttribute=function(n,v){
    if((n==='src'||n==='href'||n==='poster')&&typeof v==='string'){v=rw(v);}
    return _sa.call(this,n,v);
  };
  // Fix srcset via MutationObserver (less common, attribute-based)
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(m.type==='attributes'&&m.attributeName==='srcset'){
        var el=m.target,ss=el.getAttribute('srcset');
        if(ss&&ss.includes('/')&&!ss.includes(B)){
          _sa.call(el,'srcset',ss.replace(/(^|,\s*)\//g,'$1'+B+'/'));
        }
      }
    });
  }).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['srcset']});
  // Listen for Design Studio CSS injection via postMessage
  window.addEventListener('message',function(e){
    if(e.data&&e.data.type==='design-studio-css'){
      window._dsLastCss=e.data.css||'';
      var old=document.getElementById('design-studio-overrides');
      if(old)old.remove();
      if(e.data.css){
        var s=document.createElement('style');
        s.id='design-studio-overrides';
        s.textContent=e.data.css;
        document.head.appendChild(s);
      }
    }
    // Re-check: if CSS was lost (SPA navigation), re-apply from cache
    if(e.data&&e.data.type==='design-studio-css-check'){
      if(window._dsLastCss&&!document.getElementById('design-studio-overrides')){
        var s=document.createElement('style');
        s.id='design-studio-overrides';
        s.textContent=window._dsLastCss;
        document.head.appendChild(s);
      }
    }
    // Element inspector: toggle inspect mode
    if(e.data&&e.data.type==='design-studio-inspect'){
      var enabled=e.data.enabled;
      var overlay=document.getElementById('ds-inspect-overlay');
      var label=document.getElementById('ds-inspect-label');
      if(enabled){
        if(!overlay){
          overlay=document.createElement('div');
          overlay.id='ds-inspect-overlay';
          overlay.style.cssText='position:fixed;pointer-events:none;border:2px solid #007AFF;background:rgba(0,122,255,0.08);z-index:99999;transition:all 80ms ease;display:none;border-radius:4px;';
          document.body.appendChild(overlay);
          label=document.createElement('div');
          label.id='ds-inspect-label';
          label.style.cssText='position:fixed;z-index:100000;pointer-events:none;background:#007AFF;color:#fff;font:bold 10px/1.3 -apple-system,sans-serif;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap;';
          document.body.appendChild(label);
        }
        var hovered=null;
        window._dsInspectMove=function(ev){
          var el=document.elementFromPoint(ev.clientX,ev.clientY);
          if(!el||el===overlay||el===label||el.id==='design-studio-overrides')return;
          hovered=el;
          var r=el.getBoundingClientRect();
          overlay.style.left=r.left+'px';overlay.style.top=r.top+'px';
          overlay.style.width=r.width+'px';overlay.style.height=r.height+'px';
          overlay.style.display='block';
          var cls=el.className&&typeof el.className==='string'?'.'+el.className.trim().split(/\s+/).join('.'):'';
          var tag=el.tagName.toLowerCase();
          var id=el.id?'#'+el.id:'';
          label.textContent=tag+id+(cls.length>1?cls:'');
          label.style.left=Math.min(r.left,window.innerWidth-150)+'px';
          label.style.top=Math.max(0,r.top-20)+'px';
          label.style.display='block';
        };
        window._dsInspectClick=function(ev){
          ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
          if(!hovered)return;
          var el=hovered;
          var r=el.getBoundingClientRect();
          var cls=el.className&&typeof el.className==='string'?el.className.trim():'';
          var cs=window.getComputedStyle(el);
          var styles={};
          ['color','backgroundColor','fontSize','fontWeight','fontFamily','padding','margin',
           'borderRadius','boxShadow','display','flexDirection','gap','gridTemplateColumns',
           'width','height','maxWidth','opacity','position'].forEach(function(p){
            styles[p]=cs.getPropertyValue(p.replace(/([A-Z])/g,'-$1').toLowerCase());
          });
          window.parent.postMessage({
            type:'design-studio-element-selected',
            tag:el.tagName.toLowerCase(),
            id:el.id||null,
            className:cls,
            selector:(el.id?'#'+el.id:el.tagName.toLowerCase()+(cls?'.'+cls.split(/\s+/).join('.'):''))
              .slice(0,120),
            computedStyles:styles,
            dimensions:{width:Math.round(r.width),height:Math.round(r.height)},
            textContent:(el.textContent||'').slice(0,60)
          },'*');
        };
        document.addEventListener('mousemove',window._dsInspectMove,true);
        document.addEventListener('click',window._dsInspectClick,true);
      } else {
        // Disable inspect
        if(overlay){overlay.style.display='none';}
        if(label){label.style.display='none';}
        if(window._dsInspectMove)document.removeEventListener('mousemove',window._dsInspectMove,true);
        if(window._dsInspectClick)document.removeEventListener('click',window._dsInspectClick,true);
      }
    }
  });
})();
</script>`;
}

function rewriteHtml(html, targetPort) {
  const prefix = `/api/preview/${targetPort}`;
  // Rewrite src/href attributes with absolute paths
  html = rewriteHtmlPaths(html, prefix);
  // Inject the runtime script after <head>
  const script = buildProxyScript(targetPort);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${script}`);
  }
  return script + html;
}

// Shared proxy handler
function proxyRequest(targetPort, targetPath, req, res) {
  const queryString = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?').slice(1).join('?') : '';

  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath + queryString,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${targetPort}` },
    timeout: 30000
  };

  // Remove headers that would confuse the target or prevent reading the body
  delete options.headers['accept-encoding'];
  // Fix content-length for proxied body
  delete options.headers['content-length'];

  // Forward request body for POST/PUT/PATCH
  let bodyData = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body && typeof req.body === 'object') {
      bodyData = JSON.stringify(req.body);
      options.headers['content-type'] = 'application/json';
      options.headers['content-length'] = Buffer.byteLength(bodyData);
    }
  }

  const proxyReq = http.request(options, (proxyRes) => {
    // Copy headers but strip iframe-blocking ones
    const headers = { ...proxyRes.headers };
    delete headers['x-frame-options'];
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];

    // Rewrite absolute redirects through the proxy
    if (headers.location && headers.location.startsWith('/')) {
      headers.location = `/api/preview/${targetPort}${headers.location}`;
    }

    const ct = headers['content-type'] || '';
    const needsRewrite = isHtmlResponse(ct) || isJsResponse(ct) || isCssResponse(ct);

    if (needsRewrite) {
      const chunks = [];
      proxyRes.on('data', (chunk) => chunks.push(chunk));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf-8');
        const prefix = `/api/preview/${targetPort}`;

        if (isHtmlResponse(ct)) {
          body = rewriteHtml(body, targetPort);
        } else if (isJsResponse(ct)) {
          body = rewriteJsAbsolutePaths(body, prefix);
        } else if (isCssResponse(ct)) {
          body = rewriteCssAbsolutePaths(body, prefix);
        }

        // Update content-length after modification
        headers['content-length'] = Buffer.byteLength(body);
        delete headers['transfer-encoding'];

        res.writeHead(proxyRes.statusCode, headers);
        res.end(body);
      });
    } else {
      // Binary/other: stream directly
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    }
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Service did not respond in time' });
    }
  });

  proxyReq.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: `Cannot reach service on port ${targetPort}: ${err.message}` });
    }
  });

  if (bodyData) {
    proxyReq.write(bodyData);
  }
  proxyReq.end();
}

/**
 * @swagger
 * /api/preview/{port}:
 *   get:
 *     summary: Service preview proxy
 *     description: "Proxies requests to a registered service. Rewrites HTML/CSS/JS paths, strips iframe-blocking headers, and injects routing patches. 10-second timeout."
 *     tags: [Preview]
 *     parameters:
 *       - in: path
 *         name: port
 *         required: true
 *         schema:
 *           type: integer
 *         description: Must be a registered service port
 *     responses:
 *       200:
 *         description: Proxied response from the target service
 *       403:
 *         description: Port not registered
 */
// Use middleware-style handler to catch all paths under /:port
// This avoids Express 5's strict path-to-regexp wildcard rules
router.use('/:port', (req, res) => {
  const targetPort = getRegisteredServicePort(req.params.port);
  if (!targetPort) {
    return res.status(403).json({ error: 'Port is not a registered service' });
  }

  // req.url contains the path after the mount point (after /:port)
  const targetPath = req.url || '/';
  proxyRequest(targetPort, targetPath, req, res);
});

module.exports = router;
