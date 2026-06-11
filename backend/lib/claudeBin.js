// Deterministic resolution of the `claude` executable for the embedded
// web-shell terminal (opt-webshell-claude-path-001).
//
// Background: backend/sockets/web-shell.js used to spawn a BARE `claude`
// via `cmd.exe /c claude ...`, leaving the binary to be resolved by the
// backend Node process's PATH snapshot (taken at launch). With two Claude
// Code installs on a machine, PATH order / restart timing could silently
// launch an older duplicate (this is exactly what devops-claude-terminal-
// version-001 chased down). Resolving to a concrete absolute path here,
// with an explicit override and an observable decision, removes that class
// of drift and also sidesteps the `cmd.exe /c` quote-stripping fragility —
// callers spawn the resolved binary DIRECTLY with an args array.
//
// Everything is dependency-injected (env, settings, fileExists, platform,
// homedir, pathLookup) so the resolver is unit-tested without touching the
// real filesystem, environment, or spawning `where`/`which`.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { SETTINGS_FILE } = require('./constants');

// --- Session-file path helpers (moved here from web-shell.js so the whole
// claude-launch decision lives in one testable module) -------------------
//
// claude stores sessions under ~/.claude/projects/<slug>/<uuid>.jsonl where
// the slug is the absolute cwd with every path separator AND `:` replaced
// by `-`. So `C:\Users\RogerSquare\Documents\opencode` becomes the slug
// `C--Users-RogerSquare-Documents-opencode`.
function claudeSlugForCwd(cwd) {
  return cwd.replace(/[\\/:]/g, '-');
}
function claudeSessionFile(cwd, sessionId, homedir = os.homedir()) {
  return path.join(homedir, '.claude', 'projects', claudeSlugForCwd(cwd), `${sessionId}.jsonl`);
}

function defaultFileExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

// Read the optional `claudeBin` override out of backend/settings.json.
// Returns the settings object (or {}). Never throws — a missing/garbage
// settings file just means "no override".
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) || {}; }
  catch { return {}; }
}

// PATH lookup of last resort: `where claude` (Windows) / `which claude`
// (POSIX). Returns the first resolved absolute path, or null on any error
// (not found, tool missing, timeout). Kept separate + injectable so the
// resolver's precedence logic is testable without shelling out.
function defaultPathLookup(platform = process.platform) {
  const tool = platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(tool, ['claude'], { encoding: 'utf-8', timeout: 5000 });
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

// Resolve the claude executable. Precedence:
//   1. Explicit env override  (WEB_SHELL_CLAUDE_BIN) — honored VERBATIM when
//      set, even if the file check fails, because it is an explicit operator
//      signal; the existence flag is returned/logged so a typo is visible.
//   2. settings.json `claudeBin` override — same verbatim-when-set rule.
//   3. Known native-installer location (~/.local/bin/claude[.exe]) — used
//      only when it actually exists.
//   4. PATH lookup (`where`/`which`) — used when it returns a path.
//   5. Bare `claude` fallback — last resort; lets the OS resolve it (matches
//      pre-hardening behavior so a single-install machine never breaks).
//
// Returns { bin, source, exists } where source is one of
//   'env' | 'settings' | 'known-location' | 'path' | 'bare-fallback'.
function resolveClaudeBin({
  env = process.env,
  settings = readSettings(),
  platform = process.platform,
  homedir = os.homedir(),
  fileExists = defaultFileExists,
  pathLookup = defaultPathLookup,
} = {}) {
  const envBin = env && env.WEB_SHELL_CLAUDE_BIN;
  if (envBin) {
    return { bin: envBin, source: 'env', exists: fileExists(envBin) };
  }

  const settingsBin = settings && settings.claudeBin;
  if (settingsBin) {
    return { bin: settingsBin, source: 'settings', exists: fileExists(settingsBin) };
  }

  const exe = platform === 'win32' ? 'claude.exe' : 'claude';
  const known = path.join(homedir, '.local', 'bin', exe);
  if (fileExists(known)) {
    return { bin: known, source: 'known-location', exists: true };
  }

  const fromPath = pathLookup(platform);
  if (fromPath) {
    return { bin: fromPath, source: 'path', exists: fileExists(fromPath) };
  }

  return { bin: 'claude', source: 'bare-fallback', exists: false };
}

// Build the claude argv for a session binding (no executable — that is the
// resolved bin). Mirrors the old buildClaudeCommand decision:
//   - tryResume && the on-disk session file exists -> ['--resume', <uuid>]
//     (revives the conversation)
//   - otherwise                                    -> ['--session-id', <uuid>]
//     (so the spawn never errors with "No conversation found")
//   - no sessionId                                 -> []  (bare interactive)
// Returns { args, decision, sessionFile, sessionFileExists } so the caller
// can log exactly what it chose and why.
function buildClaudeArgs(cwd, sessionId, tryResume, {
  fileExists = defaultFileExists,
  homedir = os.homedir(),
} = {}) {
  if (!sessionId) {
    return { args: [], decision: 'bare', sessionFile: null, sessionFileExists: false };
  }
  const sessionFile = claudeSessionFile(cwd, sessionId, homedir);
  const exists = fileExists(sessionFile);
  const useResume = !!tryResume && exists;
  return {
    args: useResume ? ['--resume', sessionId] : ['--session-id', sessionId],
    decision: useResume ? '--resume' : '--session-id',
    sessionFile,
    sessionFileExists: exists,
  };
}

// Best-effort `claude --version` for diagnostics, cached per resolved bin so
// we pay the subprocess cost at most once per distinct executable for the
// life of the backend. Never throws; returns 'unknown' on any failure.
const _versionCache = new Map();
function claudeVersion(bin) {
  if (_versionCache.has(bin)) return _versionCache.get(bin);
  let v = 'unknown';
  try {
    v = execFileSync(bin, ['--version'], { encoding: 'utf-8', timeout: 5000 }).trim() || 'unknown';
  } catch {
    v = 'unknown';
  }
  _versionCache.set(bin, v);
  return v;
}

module.exports = {
  resolveClaudeBin,
  buildClaudeArgs,
  claudeVersion,
  claudeSlugForCwd,
  claudeSessionFile,
  // exported for tests / advanced callers
  defaultPathLookup,
  readSettings,
};
