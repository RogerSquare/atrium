// Serving the built SPA from Express (devops-docker-serve-spa-001).
//
// Background: the backend never served frontend/dist. In development Vite
// serves the SPA on :5173 and proxies /api + /socket.io to :3001, which is
// fine — but frontend/vite.config.js also carries
// `allowedHosts: ['board.r-that.com']`, meaning the Vite DEV server was also
// the production frontend. That is not something to carry into an image.
//
// Serving the build from Express collapses the app to a single port, which
// is what the container needs, and retires the dev-server-in-production
// arrangement at the same time.
//
// The path predicate is kept pure and exported so the "never shadow the API"
// rule is unit-tested rather than trusted.

const path = require('path');
const fs = require('fs');

// Prefixes the SPA fallback must NEVER answer for. These belong to the API,
// the websocket, or the docs UI; swallowing them would turn a genuine 404
// into a silent 200 of index.html, which is maddening to debug from the
// frontend (you get HTML where you expected JSON).
const RESERVED_PREFIXES = ['/api', '/socket.io'];

// Resolve the directory holding the built SPA.
//
//   1. ATRIUM_FRONTEND_DIST when set and non-blank — lets the image put the
//      build somewhere other than a sibling of backend/.
//   2. defaultDir (../frontend/dist) otherwise — the repo layout.
function resolveFrontendDist({ env = process.env, defaultDir } = {}) {
  const raw = env && env.ATRIUM_FRONTEND_DIST;
  if (typeof raw === 'string' && raw.trim()) {
    return path.resolve(raw.trim());
  }
  return defaultDir;
}

// Should this request fall back to index.html?
//
// Only GET/HEAD — a POST to an unknown path is a client bug and deserves a
// 404, not an HTML page. Reserved prefixes are passed through untouched.
function isSpaFallbackRequest(method, urlPath) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  for (const prefix of RESERVED_PREFIXES) {
    if (urlPath === prefix || urlPath.startsWith(`${prefix}/`)) return false;
  }
  return true;
}

// A build is usable only if index.html is actually there. An empty or
// half-copied dist/ should read as "not built", not as a broken 200.
function hasBuild(distDir) {
  try {
    return !!distDir && fs.existsSync(path.join(distDir, 'index.html'));
  } catch {
    return false;
  }
}

// Cache policy:
//   - Vite writes content-hashed filenames into assets/, so those are safe to
//     cache forever — the name changes when the content does.
//   - index.html must NOT be cached, or a deploy is invisible until the
//     browser decides to revalidate.
//   - Everything else (favicon, fonts, demo files) keeps express.static's
//     default etag/last-modified revalidation.
function cacheHeadersFor(distDir) {
  const assetsDir = path.join(distDir, 'assets') + path.sep;
  return (res, filePath) => {
    if (path.basename(filePath) === 'index.html') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.startsWith(assetsDir)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  };
}

module.exports = {
  resolveFrontendDist,
  isSpaFallbackRequest,
  hasBuild,
  cacheHeadersFor,
  RESERVED_PREFIXES,
};
