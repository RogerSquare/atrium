// Docker-backed service driver (feat-services-containers-001).
//
// The original Services manager spawned processes on the HOST by absolute path.
// A container cannot do that, and running the service inside the Atrium
// container does not work either: host node_modules are platform-specific
// (proven with artifex's @img/sharp-win32-x64 failing under linux-x64), and
// reinstalling them in-container would overwrite the host's copy through the
// read-write workspace mount.
//
// So container-mode service control talks to the Docker Engine API and manages
// SIBLING containers instead. Anything already containerized — artifex, memos,
// gitea — becomes manageable with no change to the project itself.
//
// Transport is plain HTTP via global fetch (Node 22), so there is no new
// dependency. DOCKER_HOST points at a socket proxy rather than the raw
// /var/run/docker.sock: the proxy is configured to allow only container
// inspect/start/stop/restart/logs, so a compromised Atrium cannot create
// privileged containers, exec into anything, or mount host paths. Handing the
// raw socket to an app that renders user content is effectively giving it root
// on the host.

const { logger } = require('./logger');

// Default matches the socket-proxy service in docker-compose.docker-services.yml.
// Unset on a native install, where this driver is simply unavailable.
const DOCKER_HOST = process.env.DOCKER_HOST || '';

// Engine API calls should fail fast — a wedged daemon must not hang a request.
const TIMEOUT_MS = Number(process.env.DOCKER_API_TIMEOUT_MS) || 8000;

function dockerConfigured() {
  return !!DOCKER_HOST;
}

// One request against the Engine API. Returns { ok, status, body } rather than
// throwing on HTTP errors, because "container already stopped" (304) and
// "no such container" (404) are normal conditions the caller reasons about.
async function dockerRequest(path, { method = 'GET', raw = false } = {}) {
  if (!dockerConfigured()) {
    return { ok: false, status: 0, body: null, error: 'Docker API not configured (DOCKER_HOST unset)' };
  }
  const url = `${DOCKER_HOST.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method, signal: controller.signal });
    const body = raw ? await res.text() : await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // Abort, connection refused, DNS failure — the daemon or proxy is not there.
    logger.warn({ err: err.message, path }, 'docker: request failed');
    return { ok: false, status: 0, body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// Is the Docker API actually reachable? Used for the capability report, so the
// UI can say "unavailable" instead of offering buttons that will fail.
async function dockerAvailable() {
  if (!dockerConfigured()) return false;
  const { ok } = await dockerRequest('/_ping', { raw: true });
  return ok;
}

// Map Docker's container state onto the status vocabulary the existing
// Services UI already understands, so the frontend needs no rework.
function mapState(state) {
  // Docker: created | running | paused | restarting | removing | exited | dead
  if (state === 'running') return 'running';
  if (state === 'restarting') return 'starting';
  return 'stopped';
}

// Pull the first published host port out of an inspect payload. Used so status
// reflects what Docker actually bound rather than what services.json guessed.
function firstPublishedPort(inspect) {
  const ports = inspect?.NetworkSettings?.Ports || {};
  for (const bindings of Object.values(ports)) {
    if (Array.isArray(bindings) && bindings.length && bindings[0].HostPort) {
      const n = parseInt(bindings[0].HostPort, 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// Inspect one container by name or id. `found: false` is a normal answer for a
// service whose container has not been created yet.
async function inspectContainer(nameOrId) {
  const { ok, status, body } = await dockerRequest(`/containers/${encodeURIComponent(nameOrId)}/json`);
  if (status === 404) return { found: false };
  if (!ok) return { found: false, error: `Docker inspect failed (${status})` };
  return {
    found: true,
    status: mapState(body?.State?.Status),
    dockerState: body?.State?.Status || 'unknown',
    startedAt: body?.State?.StartedAt || null,
    pid: body?.State?.Pid || null,
    port: firstPublishedPort(body),
    image: body?.Config?.Image || null,
  };
}

// start / stop / restart. Docker answers 304 when the container is already in
// the requested state — that is success from the caller's point of view, not
// an error worth surfacing.
async function containerAction(nameOrId, action) {
  const valid = ['start', 'stop', 'restart'];
  if (!valid.includes(action)) throw new Error(`Unsupported container action: ${action}`);

  const { ok, status, body } = await dockerRequest(
    `/containers/${encodeURIComponent(nameOrId)}/${action}`,
    { method: 'POST' },
  );

  if (ok || status === 304) return { ok: true, alreadyInState: status === 304 };
  if (status === 404) return { ok: false, error: `No container named "${nameOrId}"` };
  return { ok: false, error: body?.message || `Docker ${action} failed (${status})` };
}

// Tail logs. The Engine multiplexes stdout/stderr into a framed stream when the
// container has no TTY: each frame is an 8-byte header (stream type + length)
// followed by payload. Strip those headers or the UI shows binary noise every
// few characters.
async function containerLogs(nameOrId, tail = 200) {
  const { ok, status, body } = await dockerRequest(
    `/containers/${encodeURIComponent(nameOrId)}/logs?stdout=1&stderr=1&tail=${encodeURIComponent(tail)}`,
    { raw: true },
  );
  if (status === 404) return { ok: false, error: `No container named "${nameOrId}"` };
  if (!ok) return { ok: false, error: `Docker logs failed (${status})` };
  return { ok: true, logs: demuxLogStream(body || '') };
}

// Remove Docker's 8-byte stream framing. Frames only appear on non-TTY
// containers; a TTY container streams plain text, so leave anything that does
// not look framed untouched.
function demuxLogStream(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const type = text.charCodeAt(i);
    // A frame header starts with stream type 0/1/2 followed by three NUL bytes.
    const framed = (type === 0 || type === 1 || type === 2)
      && text.charCodeAt(i + 1) === 0
      && text.charCodeAt(i + 2) === 0
      && text.charCodeAt(i + 3) === 0;
    if (!framed) {
      out.push(text.slice(i));
      break;
    }
    const len = (text.charCodeAt(i + 4) << 24) | (text.charCodeAt(i + 5) << 16)
      | (text.charCodeAt(i + 6) << 8) | text.charCodeAt(i + 7);
    out.push(text.slice(i + 8, i + 8 + len));
    i += 8 + len;
  }
  return out.join('').split('\n').filter((l) => l.length > 0);
}

// A service is Docker-managed when it says so. Everything without an explicit
// type stays a host process, so an existing services.json keeps working.
function isContainerService(service) {
  return service?.type === 'container';
}

// The container name to act on. Falls back to the service id, which is the
// convention for anything registered without an explicit name.
function containerNameFor(service) {
  return service?.container_name || service?.id;
}

module.exports = {
  dockerConfigured,
  dockerAvailable,
  inspectContainer,
  containerAction,
  containerLogs,
  isContainerService,
  containerNameFor,
  // exported for tests
  mapState,
  firstPublishedPort,
  demuxLogStream,
};
