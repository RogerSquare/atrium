// Minimal allow-list proxy for the Docker Engine API (feat-services-containers-001).
//
// WHY THIS EXISTS
// ---------------
// Atrium needs exactly four Docker capabilities to manage a service:
// inspect a container, read its logs, and start/stop/restart it. Nothing else.
//
// The obvious off-the-shelf option, tecnativa/docker-socket-proxy, cannot
// express that. Its HAProxy template gates whole path prefixes:
//
//     http-request deny  unless METH_GET || { env(POST) -m bool }
//     http-request allow if { path -m reg ^/containers } { env(CONTAINERS) }
//
// So CONTAINERS=1 (needed for inspect/logs) combined with POST=1 (needed for
// start/stop) also permits POST /containers/create and
// POST /containers/{id}/exec. That was verified against the real proxy, not
// assumed: exec returned 201 Created, and create was rejected only because the
// requested image happened to be absent. With any local image, a caller could
// have created a privileged container bind-mounting / — i.e. host root.
//
// This proxy is deny-by-default and matches on the exact method + path shapes
// Atrium actually calls. Anything else gets a 403 and a log line.
//
// It is deliberately dependency-free and small enough to audit in one sitting.
//
// THREAT MODEL
// ------------
// Assumes the Docker socket itself is trusted and that the caller (Atrium) may
// be compromised — by a malicious task description, a prompt injection into an
// agent, or a dependency. Under that assumption the worst a caller can do here
// is stop or restart a container that is already registered on this host. It
// cannot create containers, exec into them, mount host paths, pull or build
// images, or read any other part of the daemon.
//
// A container name is still attacker-chosen, so this does NOT prevent
// restarting an unrelated container on the same host. Narrowing that further
// would mean passing an explicit allow-list of names via ALLOWED_CONTAINERS.

const http = require('http');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PORT = Number(process.env.PROXY_PORT) || 2375;

// Optional hard restriction: comma-separated container names this proxy will
// act on at all. Empty means "any container on this host".
const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Docker names: alphanumerics plus _ . - (and an optional leading /).
const NAME = '[a-zA-Z0-9][a-zA-Z0-9_.-]*';
// Optional /v1.43 style version prefix that SDKs sometimes send.
const V = '(?:/v\\d+\\.\\d+)?';

// The complete set of things Atrium is allowed to ask for. Each entry captures
// the container name in group 1 where applicable, so it can be checked against
// ALLOWED_CONTAINERS.
const ALLOWLIST = [
  { method: 'GET', re: new RegExp(`^${V}/_ping$`), name: false },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${NAME})/json$`), name: true },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${NAME})/logs$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/start$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/stop$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/restart$`), name: true },
];

function decide(method, rawUrl) {
  // Match on the PATH only — a query string must never influence the decision,
  // and must never let a caller smuggle a different path in.
  let pathname;
  try {
    pathname = new URL(rawUrl, 'http://proxy').pathname;
  } catch {
    return { allowed: false, reason: 'unparseable url' };
  }

  // Reject traversal outright rather than relying on normalisation.
  if (pathname.includes('..')) return { allowed: false, reason: 'path traversal' };

  for (const rule of ALLOWLIST) {
    if (rule.method !== method) continue;
    const m = pathname.match(rule.re);
    if (!m) continue;
    if (rule.name && ALLOWED_CONTAINERS.length && !ALLOWED_CONTAINERS.includes(m[1])) {
      return { allowed: false, reason: `container "${m[1]}" not in ALLOWED_CONTAINERS` };
    }
    return { allowed: true };
  }
  return { allowed: false, reason: 'not in allow-list' };
}

const server = http.createServer((req, res) => {
  const { allowed, reason } = decide(req.method, req.url);

  if (!allowed) {
    // Log every refusal — this is the audit trail if something starts probing.
    console.warn(`[socket-proxy] DENY ${req.method} ${req.url} (${reason})`);
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Forbidden by socket allow-list proxy: ${reason}` }));
    // Drain so the client is not left hanging on an unread request body.
    req.resume();
    return;
  }

  const upstream = http.request(
    { socketPath: SOCKET, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error(`[socket-proxy] upstream error: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `Docker socket unreachable: ${err.message}` }));
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`[socket-proxy] listening on ${PORT}, forwarding to ${SOCKET}`);
  console.log('[socket-proxy] allow-list:');
  for (const r of ALLOWLIST) console.log(`  ${r.method} ${r.re}`);
  console.log(`[socket-proxy] container restriction: ${ALLOWED_CONTAINERS.length ? ALLOWED_CONTAINERS.join(', ') : '(any)'}`);
});
