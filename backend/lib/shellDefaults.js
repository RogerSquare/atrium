// Platform-portable shell selection for the PTY surfaces (devops-docker-shell-portable-001).
//
// Background: sockets/terminal.js hardcoded `cmd.exe` with no env escape and
// fell back to `USERPROFILE || 'C:\'` for cwd. sockets/web-shell.js honoured
// WEB_SHELL_DEFAULT_SHELL for the interactive case but still wrapped arbitrary
// commands in `cmd.exe /c`. Neither survives a Linux container.
//
// Both surfaces now share these resolvers, so there is one place that knows
// what a shell is on this platform. Everything is injectable (env, platform,
// homedir) so the Linux behaviour is unit-tested from Windows — which matters,
// because the container is the whole point and we cannot run it here.
//
// Windows behaviour is deliberately unchanged: on win32 with no env override
// these return exactly what the old hardcoded values did.

const os = require('os');

// POSIX fallback when nothing is configured. bash rather than sh because the
// web-shell drives interactive CLIs (claude) that expect a real interactive
// shell; the runtime image installs bash for this reason.
const POSIX_DEFAULT_SHELL = '/bin/bash';
const WINDOWS_DEFAULT_SHELL = 'cmd.exe';

// Interactive shell to spawn.
//
//   1. ATRIUM_SHELL — the generic override, applies to both PTY surfaces.
//   2. WEB_SHELL_DEFAULT_SHELL — pre-existing, kept working for back-compat.
//   3. Platform default — cmd.exe on Windows, /bin/bash elsewhere.
function resolveDefaultShell({ env = process.env, platform = process.platform } = {}) {
  const override = pickEnv(env, 'ATRIUM_SHELL') || pickEnv(env, 'WEB_SHELL_DEFAULT_SHELL');
  if (override) return override;
  return platform === 'win32' ? WINDOWS_DEFAULT_SHELL : POSIX_DEFAULT_SHELL;
}

// Turn an arbitrary command STRING into a {cmd, args} pair that runs it
// through a shell, so PATH search and shell builtins behave as the caller
// expects. The web-shell's global modal passes free-form strings, so this
// cannot be an argv array.
//
// Note the asymmetry: `cmd.exe /c` versus `sh -c`. Both take the command as a
// single trailing argument, so callers are unaffected by which one is chosen.
function buildShellCommandArgs(command, { env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32') {
    return { cmd: WINDOWS_DEFAULT_SHELL, args: ['/c', command] };
  }
  // Deliberately /bin/sh, not the interactive shell: running a one-shot
  // command does not need bash, and sh is guaranteed present on any POSIX
  // base image even if bash somehow is not.
  return { cmd: '/bin/sh', args: ['-c', command] };
}

// Working directory for a new PTY. An explicit cwd from the client wins;
// otherwise the user's home. The old `USERPROFILE || 'C:\'` chain resolved to
// a nonexistent path on Linux, which makes pty.spawn throw.
function resolveShellCwd(configCwd, { homedir = os.homedir() } = {}) {
  if (typeof configCwd === 'string' && configCwd.trim()) return configCwd;
  return homedir;
}

function pickEnv(env, key) {
  const raw = env && env[key];
  return (typeof raw === 'string' && raw.trim()) ? raw : null;
}

module.exports = {
  resolveDefaultShell,
  buildShellCommandArgs,
  resolveShellCwd,
  POSIX_DEFAULT_SHELL,
  WINDOWS_DEFAULT_SHELL,
};
