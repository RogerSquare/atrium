// Trust-proxy resolution (devops-harden-remote-001).
//
// Express's `trust proxy` setting decides whether req.ip comes from the
// socket address or from X-Forwarded-For. It matters here because
// express-rate-limit keys on req.ip: behind a reverse proxy with trust off,
// every client shares the proxy's address and the 5/min auth limiter becomes
// a global login DoS — one guesser locks everyone out. Trusting blindly is
// the opposite failure: with no proxy in front, any client can spoof
// X-Forwarded-For and dodge the limiter entirely.
//
// So the default is OFF and the operator states their topology explicitly:
//
//   ATRIUM_TRUST_PROXY=            → off (default; direct exposure)
//   ATRIUM_TRUST_PROXY=true        → 1 hop (the common single reverse proxy)
//   ATRIUM_TRUST_PROXY=2           → N hops (CDN in front of a proxy, etc.)
//   ATRIUM_TRUST_PROXY=loopback    → any Express named preset or subnet
//   ATRIUM_TRUST_PROXY=10.0.0.0/8  → passed through verbatim
//
// `true` deliberately maps to 1 hop, not Express's permissive `true` —
// trusting the entire chain re-opens the spoofing hole and express-rate-limit
// v7 rejects that configuration outright.
function resolveTrustProxy(env = process.env) {
  const raw = (env.ATRIUM_TRUST_PROXY || '').trim();
  if (!raw || raw.toLowerCase() === 'false' || raw === '0') return false;
  if (raw.toLowerCase() === 'true') return 1;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  return raw;
}

module.exports = { resolveTrustProxy };
