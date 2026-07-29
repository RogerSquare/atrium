// Feature flags for host-coupled surfaces (devops-docker-flags-001).
//
// Some features cannot work in a container by construction. The Services
// manager is the clearest case: it starts and stops OTHER dev servers by
// absolute host path, and a container cannot spawn a process on its host.
// Shipping it enabled-but-broken means buttons that silently do nothing,
// which is worse than not offering them.
//
// Flags default ON so the native Windows run is completely unaffected —
// turning something off is an explicit deployment decision.

// Values that read as "off". Everything else (including unset) is on, so a
// typo fails safe toward the current behaviour rather than silently
// disabling a feature.
const OFF_VALUES = new Set(['0', 'false', 'off', 'no', 'disabled']);

function isEnabled(name, env = process.env) {
  const raw = env && env[name];
  if (typeof raw !== 'string') return true;
  return !OFF_VALUES.has(raw.trim().toLowerCase());
}

// The Services manager: registry CRUD plus start/stop/restart of local dev
// servers. Reading the registry stays harmless when disabled (it just comes
// back empty); it is the process control that cannot work.
function servicesEnabled(env = process.env) {
  return isEnabled('ATRIUM_FEATURE_SERVICES', env);
}

// Snapshot for the /api/features endpoint and for logging at boot, so an
// operator can see what this instance actually offers without reading code.
// Is Docker-backed service control wired up? Distinct from `services` — a
// container instance can have the Services feature ON (so the panel renders
// and container-backed entries work) while still being unable to spawn host
// processes. The frontend uses this to explain which kinds of service it can
// actually act on (feat-services-containers-001).
function dockerServicesEnabled(env = process.env) {
  return servicesEnabled(env) && !!(env && env.DOCKER_HOST);
}

function featureSnapshot(env = process.env) {
  return {
    services: servicesEnabled(env),
    dockerServices: dockerServicesEnabled(env),
  };
}

// --- Does services.json ship in the image? NO. ---------------------------
//
// It is host-only configuration and is already treated that way: .gitignore
// lists `backend/services.json` under "Machine-specific config" and the repo
// carries services.example.json as the template. Every entry is an absolute
// host path plus a port on the host — none of which mean anything inside a
// container.
//
// Consequence: the container starts with an EMPTY registry regardless of this
// flag, so the Services UI is empty and hides itself on its own. The flag is
// belt-and-braces for the case where someone mounts a services.json anyway —
// it stops the start/stop buttons from appearing to work.
//
// Known gap: /api/demos/grouped reads the registry via lib/demos rather than
// through the gated route, so a mounted-but-disabled registry would still
// surface service groups there. Moot when services.json is absent (the
// intended container setup); tracked rather than fixed here to keep this
// change small.

// Shown to the client on a 501 so the UI can explain itself rather than
// surfacing a bare error code.
const SERVICES_DISABLED_REASON =
  'The Services manager is disabled on this instance. It starts and stops processes '
  + 'on the host machine, which a containerized Atrium cannot do. Unset '
  + 'ATRIUM_FEATURE_SERVICES to re-enable it on a native install.';

module.exports = {
  isEnabled,
  servicesEnabled,
  dockerServicesEnabled,
  featureSnapshot,
  SERVICES_DISABLED_REASON,
};
