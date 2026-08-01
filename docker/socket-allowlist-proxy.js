// Minimal allow-list proxy for the Docker Engine API (feat-services-containers-001,
// job capability: devops-runner-proxy-jobs-001).
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
// THE JOB CAPABILITY (devops-runner-proxy-jobs-001, accepted default Q2)
// ----------------------------------------------------------------------
// "Run tests in an ephemeral container" needs create/start/wait/logs/remove.
// That is a real widening of the surface, so it is fenced three ways:
//
//   1. OFF unless ATRIUM_RUNNER_IMAGES is a non-empty allow-list. Empty means
//      the feature does not exist — not "any image".
//   2. Job containers live in a proxy-owned namespace: names MUST match
//      atrium-job-*. create requires ?name=atrium-job-…, and the per-container
//      job verbs (start/wait/logs/json/remove) apply ONLY to that namespace.
//      stop/restart of registered services stay governed by ALLOWED_CONTAINERS
//      exactly as before.
//   3. The create BODY is parsed and validated before forwarding:
//      image must be on the allow-list; privileged/caps/devices/security-opt/
//      host namespaces/port publishing are refused; bind mounts are refused
//      except read-only binds under ATRIUM_RUNNER_WORKSPACE (unset ⇒ no binds).
//
// RESIDUAL CAPABILITY granted by the job shape, stated exactly: a caller can
// create and run containers FROM THE LISTED IMAGES ONLY, unprivileged, on the
// default bridge network, with at most a read-only view of the declared
// workspace subtree; it can read their logs, wait on them, and remove
// containers in the atrium-job-* namespace. It still cannot exec into any
// container, pull or build images (runner images must be pre-pulled by the
// operator), publish ports, mount anything writable, or touch containers
// outside the job namespace beyond the original six service shapes.
//
// THREAT MODEL
// ------------
// Assumes the Docker socket itself is trusted and that the caller (Atrium) may
// be compromised — by a malicious task description, a prompt injection into an
// agent, or a dependency. Under that assumption the worst a caller can do here
// is stop/restart a registered container, or (when the operator has opted in
// via ATRIUM_RUNNER_IMAGES) burn CPU in an unprivileged allow-listed container
// that can read the declared workspace. A container name is still
// attacker-chosen for the service verbs, so this does NOT prevent restarting
// an unrelated container on the same host; narrow that with ALLOWED_CONTAINERS.

const http = require('http');

const SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const PORT = Number(process.env.PROXY_PORT) || 2375;

// Optional hard restriction: comma-separated container names this proxy will
// act on at all. Empty means "any container on this host".
const ALLOWED_CONTAINERS = (process.env.ALLOWED_CONTAINERS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Job capability config. RUNNER_IMAGES empty ⇒ every job shape denies.
const RUNNER_IMAGES = (process.env.ATRIUM_RUNNER_IMAGES || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Host path prefix that may be bind-mounted READ-ONLY into job containers.
// Unset ⇒ no binds at all.
const RUNNER_WORKSPACE = (process.env.ATRIUM_RUNNER_WORKSPACE || '').trim();

// Docker names: alphanumerics plus _ . - (and an optional leading /).
const NAME = '[a-zA-Z0-9][a-zA-Z0-9_.-]*';
// Proxy-owned namespace for ephemeral test-job containers.
const JOB_PREFIX = 'atrium-job-';
const JOB_NAME = `${JOB_PREFIX}[a-zA-Z0-9][a-zA-Z0-9_.-]*`;
// Optional /v1.43 style version prefix that SDKs sometimes send.
const V = '(?:/v\\d+\\.\\d+)?';

// The complete set of things Atrium is allowed to ask for. Each entry captures
// the container name in group 1 where applicable, so it can be checked against
// ALLOWED_CONTAINERS. `job: true` rules exist only while the job capability is
// enabled and are scoped to the atrium-job-* namespace (exempt from
// ALLOWED_CONTAINERS — the namespace itself is the restriction).
const ALLOWLIST = [
  { method: 'GET', re: new RegExp(`^${V}/_ping$`), name: false },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${NAME})/json$`), name: true },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${NAME})/logs$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/start$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/stop$`), name: true },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${NAME})/restart$`), name: true },
];

const JOB_ALLOWLIST = [
  { method: 'POST', re: new RegExp(`^${V}/containers/create$`), kind: 'create-job' },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${JOB_NAME})/start$`) },
  { method: 'POST', re: new RegExp(`^${V}/containers/(${JOB_NAME})/wait$`) },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${JOB_NAME})/logs$`) },
  { method: 'GET', re: new RegExp(`^${V}/containers/(${JOB_NAME})/json$`) },
  { method: 'DELETE', re: new RegExp(`^${V}/containers/(${JOB_NAME})$`) },
];

const JOB_NAME_RE = new RegExp(`^${JOB_NAME}$`);

// Is `candidate` the workspace root or inside it? Pure string containment on
// normalized separators — no fs access (the proxy may not even see the host
// filesystem). Case-insensitive because Docker Desktop host paths on Windows
// are case-insensitive; '..' segments are rejected outright.
function isPathUnder(workspaceRoot, candidate) {
  if (!workspaceRoot || !candidate) return false;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  const root = norm(workspaceRoot).toLowerCase();
  const cand = norm(candidate).toLowerCase();
  if (!root || cand.split('/').includes('..')) return false;
  return cand === root || cand.startsWith(`${root}/`);
}

// Validate a POST /containers/create body against the job policy.
// Pure — config comes in as arguments so the whole matrix is unit-testable.
function validateCreateBody(body, { images = RUNNER_IMAGES, workspace = RUNNER_WORKSPACE } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'create body must be a JSON object' };
  }
  if (typeof body.Image !== 'string' || !images.includes(body.Image)) {
    return { ok: false, reason: `image "${body.Image || ''}" not in ATRIUM_RUNNER_IMAGES` };
  }

  const hc = body.HostConfig || {};
  if (hc.Privileged) return { ok: false, reason: 'privileged containers are refused' };
  if (Array.isArray(hc.CapAdd) && hc.CapAdd.length) return { ok: false, reason: 'CapAdd is refused' };
  if (Array.isArray(hc.Devices) && hc.Devices.length) return { ok: false, reason: 'Devices are refused' };
  if (Array.isArray(hc.SecurityOpt) && hc.SecurityOpt.length) return { ok: false, reason: 'SecurityOpt is refused' };
  for (const ns of ['PidMode', 'IpcMode', 'UtsMode', 'UsernsMode', 'CgroupParent', 'Cgroup']) {
    if (hc[ns]) return { ok: false, reason: `${ns} is refused` };
  }
  const net = hc.NetworkMode || '';
  if (net && !['default', 'bridge', 'none'].includes(net)) {
    return { ok: false, reason: `NetworkMode "${net}" is refused (default/bridge/none only)` };
  }
  if (hc.PortBindings && Object.keys(hc.PortBindings).length) {
    return { ok: false, reason: 'PortBindings are refused (jobs do not publish ports)' };
  }

  // Binds: "host:container[:mode]". Only read-only binds under the declared
  // workspace. No workspace declared ⇒ no binds at all.
  const binds = Array.isArray(hc.Binds) ? hc.Binds : [];
  for (const bind of binds) {
    if (typeof bind !== 'string') return { ok: false, reason: 'malformed bind' };
    const parts = bind.split(':');
    // Windows host paths contain a drive colon ("C:/w:/app:ro") — the mode is
    // the LAST segment, the container path the second-to-last.
    const mode = parts.length >= 3 ? parts[parts.length - 1] : '';
    const host = parts.length >= 3 ? parts.slice(0, parts.length - 2).join(':') : bind;
    const modes = mode.split(',').filter(Boolean);
    if (!modes.includes('ro')) return { ok: false, reason: `bind "${host}" must be read-only (:ro)` };
    if (!workspace) return { ok: false, reason: 'binds are refused: ATRIUM_RUNNER_WORKSPACE is not set' };
    if (!isPathUnder(workspace, host)) {
      return { ok: false, reason: `bind "${host}" is outside ATRIUM_RUNNER_WORKSPACE` };
    }
  }

  // Mounts API: same policy as Binds, structured form.
  const mounts = Array.isArray(hc.Mounts) ? hc.Mounts : [];
  for (const m of mounts) {
    if (!m || m.Type !== 'bind') return { ok: false, reason: `mount type "${m && m.Type}" is refused (bind only)` };
    if (m.ReadOnly !== true) return { ok: false, reason: `mount "${m.Source || ''}" must set ReadOnly: true` };
    if (!workspace) return { ok: false, reason: 'mounts are refused: ATRIUM_RUNNER_WORKSPACE is not set' };
    if (!isPathUnder(workspace, m.Source)) {
      return { ok: false, reason: `mount "${m.Source || ''}" is outside ATRIUM_RUNNER_WORKSPACE` };
    }
  }

  return { ok: true };
}

// Decide whether method+url is allowed at the PATH level. Config is injectable
// for tests; defaults read the process env once at module load.
// Returns { allowed, reason?, kind? } — kind 'create-job' tells the server this
// request additionally needs its body validated before forwarding.
function decide(method, rawUrl, cfg = {}) {
  const allowedContainers = cfg.allowedContainers || ALLOWED_CONTAINERS;
  const jobsEnabled = (cfg.runnerImages || RUNNER_IMAGES).length > 0;

  // Match on the PATH only — a query string must never influence the decision,
  // and must never let a caller smuggle a different path in. The ONE exception
  // is create's ?name=, which is read separately below and validated against
  // the job-name regex.
  let url;
  try {
    url = new URL(rawUrl, 'http://proxy');
  } catch {
    return { allowed: false, reason: 'unparseable url' };
  }
  const pathname = url.pathname;

  // Reject traversal outright rather than relying on normalisation.
  if (pathname.includes('..')) return { allowed: false, reason: 'path traversal' };

  for (const rule of ALLOWLIST) {
    if (rule.method !== method) continue;
    const m = pathname.match(rule.re);
    if (!m) continue;
    if (rule.name && allowedContainers.length && !allowedContainers.includes(m[1])) {
      // A job-namespace container may still use its verbs below.
      if (!(jobsEnabled && JOB_NAME_RE.test(m[1]))) {
        return { allowed: false, reason: `container "${m[1]}" not in ALLOWED_CONTAINERS` };
      }
    }
    return { allowed: true };
  }

  if (jobsEnabled) {
    for (const rule of JOB_ALLOWLIST) {
      if (rule.method !== method) continue;
      const m = pathname.match(rule.re);
      if (!m) continue;
      if (rule.kind === 'create-job') {
        // The container MUST be named into the proxy-owned job namespace —
        // an unnamed create would land outside it and become unmanageable.
        const name = url.searchParams.get('name') || '';
        if (!JOB_NAME_RE.test(name)) {
          return { allowed: false, reason: `create requires ?name=${JOB_PREFIX}<suffix>` };
        }
        return { allowed: true, kind: 'create-job', jobName: name };
      }
      return { allowed: true };
    }
  }

  return { allowed: false, reason: 'not in allow-list' };
}

// --- server ---------------------------------------------------------------

const MAX_CREATE_BODY = 1024 * 1024; // 1 MB — a create spec is a few KB.

function deny(res, req, reason, status = 403) {
  console.warn(`[socket-proxy] DENY ${req.method} ${req.url} (${reason})`);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `Forbidden by socket allow-list proxy: ${reason}` }));
  req.resume();
}

function forward(req, res, bodyBuffer = null) {
  const headers = { ...req.headers };
  if (bodyBuffer !== null) headers['content-length'] = Buffer.byteLength(bodyBuffer);
  const upstream = http.request(
    { socketPath: SOCKET, path: req.url, method: req.method, headers },
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
  if (bodyBuffer !== null) upstream.end(bodyBuffer);
  else req.pipe(upstream);
}

function handleRequest(req, res) {
  const decision = decide(req.method, req.url);

  if (!decision.allowed) {
    // Log every refusal — this is the audit trail if something starts probing.
    return deny(res, req, decision.reason);
  }

  if (decision.kind === 'create-job') {
    // Buffer + parse + validate the create spec, then forward EXACTLY the
    // bytes that were validated (never the raw stream).
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_CREATE_BODY) {
        req.destroy();
        return deny(res, req, 'create body too large');
      }
      chunks.push(c);
    });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      } catch {
        return deny(res, req, 'create body is not valid JSON', 400);
      }
      const verdict = validateCreateBody(body);
      if (!verdict.ok) return deny(res, req, verdict.reason);
      // State-creating action — always log it for the audit trail.
      console.log(`[socket-proxy] JOB CREATE name=${decision.jobName} image=${body.Image}`);
      forward(req, res, Buffer.concat(chunks));
    });
    return;
  }

  if (req.method === 'DELETE') {
    console.log(`[socket-proxy] JOB REMOVE ${req.url}`);
  }
  forward(req, res);
}

function startServer() {
  const server = http.createServer(handleRequest);
  server.listen(PORT, () => {
    console.log(`[socket-proxy] listening on ${PORT}, forwarding to ${SOCKET}`);
    console.log('[socket-proxy] allow-list:');
    for (const r of ALLOWLIST) console.log(`  ${r.method} ${r.re}`);
    if (RUNNER_IMAGES.length) {
      console.log('[socket-proxy] job capability ON — additional shapes:');
      for (const r of JOB_ALLOWLIST) console.log(`  ${r.method} ${r.re}`);
      console.log(`[socket-proxy] runner images: ${RUNNER_IMAGES.join(', ')}`);
      console.log(`[socket-proxy] runner workspace (ro binds): ${RUNNER_WORKSPACE || '(none — binds refused)'}`);
    } else {
      console.log('[socket-proxy] job capability OFF (ATRIUM_RUNNER_IMAGES empty)');
    }
    console.log(`[socket-proxy] container restriction: ${ALLOWED_CONTAINERS.length ? ALLOWED_CONTAINERS.join(', ') : '(any)'}`);
  });
  return server;
}

// Importable for tests; a server only when run directly (compose does
// `node /proxy.js`).
if (require.main === module) startServer();

module.exports = { decide, validateCreateBody, isPathUnder, JOB_PREFIX, startServer };
