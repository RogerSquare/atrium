// Service surface + health model (feat-service-surfaces-001).
//
// The registry used to assume every service was a port-listening web server:
// "running" meant a TCP connect succeeded, and a port was mandatory (Kaleidoscope
// was registered with port:0 to sneak a TUI past that). This generalizes it so a
// desktop app, a CLI/TUI, a run-to-completion job, or a Swift build can be
// registered honestly. Everything is ADDITIVE: a service with no `surface`
// behaves exactly as before (port-based status, port required).
//
// Pure and dependency-free, so the whole matrix is unit-tested without spawning
// anything.

const SURFACES = ['web', 'server', 'desktop', 'cli', 'job'];
const HEALTHCHECKS = ['port', 'pid', 'http', 'none'];

// A surface's default health signal when the service doesn't set one explicitly.
const SURFACE_DEFAULT_HEALTHCHECK = {
  web: 'port',      // a browser UI — previewable, listens on a port
  server: 'port',   // a backend/API — listens on a port, not previewable
  desktop: 'pid',   // a GUI app — no port; alive iff its process is
  cli: 'pid',       // a CLI/TUI — no port; alive iff its process is
  job: 'none',      // run-to-completion — status comes from the run, not a probe
};

// The effective healthcheck kind. Explicit `healthcheck` wins; otherwise it is
// derived from `surface`; a service with neither (legacy) is port-based.
function effectiveHealthcheck(service = {}) {
  if (HEALTHCHECKS.includes(service.healthcheck)) return service.healthcheck;
  const surface = service.surface;
  if (surface && SURFACE_DEFAULT_HEALTHCHECK[surface]) return SURFACE_DEFAULT_HEALTHCHECK[surface];
  return 'port';
}

// Does this service need a port at all? Only when its health is probed over the
// network. Used for validation (is `port` required?) and to decide whether the
// status path should run a probe.
function portRequired(service = {}) {
  if (service.surface === 'job') return false;
  const hc = effectiveHealthcheck(service);
  return hc === 'port' || hc === 'http';
}

// Status of a run-to-completion job from its tracked run.
function jobStatus(tracked) {
  if (tracked && tracked.pid) return 'running';
  if (!tracked || tracked.lastExitCode == null || tracked.lastExitCode === undefined) return 'idle';
  return tracked.lastExitCode === 0 ? 'succeeded' : 'failed';
}

// Resolve a status string from the available signal.
//   reachable — result of the port/http probe the route ran (ignored otherwise)
//   tracked   — the runningServices entry ({ pid, lastExitCode }) or null
function resolveStatus(service = {}, { reachable = false, tracked = null } = {}) {
  if (service.surface === 'job') return jobStatus(tracked);
  const hc = effectiveHealthcheck(service);
  if (hc === 'port' || hc === 'http') return reachable ? 'running' : 'stopped';
  // pid / none: alive iff we are tracking a live process for it.
  return tracked && tracked.pid ? 'running' : 'stopped';
}

module.exports = {
  SURFACES,
  HEALTHCHECKS,
  SURFACE_DEFAULT_HEALTHCHECK,
  effectiveHealthcheck,
  portRequired,
  resolveStatus,
  jobStatus,
};
