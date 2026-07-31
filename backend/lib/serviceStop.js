// Cross-platform service stop selection (devops-service-stop-xplat-001).
//
// The old stopByPort shelled Windows-only `netstat | findstr | taskkill`, so a
// native macOS/Linux install could not stop anything, and stopping-by-port could
// never address an app that does not listen (desktop/cli/job). This decides HOW
// to stop a service: prefer the tracked child PID (kill the process tree/group so
// children die too); fall back to a port-kill only for a legacy/web service with
// no tracked PID.
//
// Pure and platform-injectable so the selection logic is unit-tested without
// spawning anything; the route executes the chosen strategy.

const { portRequired } = require('./serviceModel');

function stopStrategy(service = {}, tracked = null, platform = process.platform) {
  const pid = tracked && tracked.pid;
  if (pid) return { kind: 'pid', pid, platform };
  if (portRequired(service) && service.port) return { kind: 'port', port: service.port, platform };
  // Nothing tracked and no port to probe (e.g. a cli/desktop we never started,
  // or one that already exited) — it is already stopped.
  return { kind: 'none', platform };
}

module.exports = { stopStrategy };
