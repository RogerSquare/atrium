// CORS origin policy (devops-docker-compose-001).
//
// Background: the old check compared the Origin header against a fixed list of
// localhost ports (3000/3001/5173/5174/8080) plus anything in ALLOWED_ORIGINS.
// That was fine while the SPA was always served by Vite on a known port, but
// the container serves the SPA from its own origin on whatever host port the
// operator published — so `docker compose up` with ATRIUM_PORT=3100 produced
// `CORS: origin http://localhost:3100 not allowed` on every API call,
// including login and register. The failure is especially unhelpful because
// the board renders fine (a plain GET of index.html is not preflighted) and
// only breaks once the app starts talking to the API.
//
// The old code did carry a "same-origin" comment, but it only covered the
// case where Origin is ABSENT (curl, server-to-server). Browsers DO send
// Origin on same-origin POST/PUT/DELETE, so genuine same-origin browser
// traffic still fell through to the allowlist.
//
// Fix: treat a request as same-origin when the Origin's host matches the Host
// header the browser actually used. That is safe — a browser sets Origin
// itself and page JavaScript cannot forge it, so "Origin host == Host" means
// the request came from the page this server just served. Non-browser clients
// can spoof both, but they are not subject to CORS in the first place.

// True when the Origin header refers to the same host:port the request was
// addressed to. Comparison is on `host` (hostname + port), so a port mismatch
// is correctly treated as cross-origin.
function isSameOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false;
  try {
    return new URL(origin).host.toLowerCase() === String(hostHeader).trim().toLowerCase();
  } catch {
    // Origin was not a parseable URL (malformed, or the literal "null" that
    // sandboxed iframes and file:// pages send) — not same-origin.
    return false;
  }
}

// Parse ALLOWED_ORIGINS plus the built-in defaults.
//
// The localhost port list stays for the `npm run dev` workflow, where Vite is
// on 5173 and the API on 3001 — genuinely cross-origin, so it cannot be
// covered by the same-origin rule above.
function buildAllowedOrigins(env = process.env) {
  const origins = new Set();

  if (env.ALLOWED_ORIGINS) {
    env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean).forEach((o) => origins.add(o));
  }

  // Dev convenience: the Vite dev server and the API are on different ports,
  // which is cross-origin by definition. Skipped in production unless nothing
  // was configured, matching the previous behaviour.
  if (env.NODE_ENV !== 'production' || origins.size === 0) {
    [3000, 3001, 5173, 5174, 8080].forEach((p) => {
      origins.add(`http://localhost:${p}`);
      origins.add(`http://127.0.0.1:${p}`);
    });
  }

  // Playwright's hosted trace viewer fetches /api/e2e-runs/.../trace.zip when
  // a reviewer opens a trace from the Tests tab.
  origins.add('https://trace.playwright.dev');

  return origins;
}

// Build the predicate used by both the HTTP and socket.io CORS layers.
// Returns (origin, hostHeader) => boolean.
function buildOriginChecker(allowedOrigins) {
  return (origin, hostHeader) => {
    // No Origin at all: curl, server-to-server, same-origin GET. Not a
    // browser cross-origin request, so nothing to guard against.
    if (!origin) return true;

    // The page this server served, talking back to it. Always allowed,
    // whatever port it happens to be published on.
    if (isSameOrigin(origin, hostHeader)) return true;

    return allowedOrigins.has(origin);
  };
}

module.exports = { isSameOrigin, buildAllowedOrigins, buildOriginChecker };
