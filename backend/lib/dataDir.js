// Single-root resolution for all of Atrium's mutable state (devops-docker-datadir-001).
//
// Background: every state path used to be spelled `path.join(__dirname, '..')`
// directly in constants.js. That works fine for the native run but makes the
// container story miserable — a dozen separate bind mounts, one per state
// directory, each of which has to be remembered and kept in sync.
//
// This module introduces ONE root (ATRIUM_DATA_DIR) that every state path
// hangs off, so a container mounts a single volume. The default is the
// backend directory, which reproduces the historical layout byte for byte —
// an existing native install sees no change whatsoever.
//
// Everything is dependency-injected (env, defaultRoot) so resolution is
// unit-tested without touching the real environment, matching the style
// already established by lib/claudeBin.js.

const path = require('path');
const fs = require('fs');

// Resolve the root under which all mutable state lives.
//
//   1. ATRIUM_DATA_DIR when set and non-blank — resolved to an absolute path
//      so a relative value behaves predictably regardless of the process cwd.
//   2. defaultRoot (the backend directory) otherwise — the historical layout.
function resolveDataDir({ env = process.env, defaultRoot } = {}) {
  const raw = env && env.ATRIUM_DATA_DIR;
  if (typeof raw === 'string' && raw.trim()) {
    return path.resolve(raw.trim());
  }
  return defaultRoot;
}

// A narrower per-file env override, when set and non-blank, beats the value
// derived from the data root.
function pick(env, key, fallback) {
  const raw = env && env[key];
  return (typeof raw === 'string' && raw.trim()) ? raw : fallback;
}

// Build every mutable-state path from a single root.
//
// Nested paths are derived from their parent (HISTORY_DIR from TASKS_DIR,
// CHAT_FILE from CHAT_DIR, ...) rather than re-rooted independently, so
// there is exactly one place to change if a parent ever moves.
function buildDataPaths(root, env = process.env) {
  const TASKS_DIR = path.join(root, 'tasks');
  const CHAT_DIR = path.join(root, 'chat');
  const AGENT_TOKENS_DIR = path.join(root, 'agent-tokens');
  const AUTOENTER_DIR = path.join(root, 'autoenter');
  const UPLOADS_DIR = path.join(root, 'uploads', 'design');

  return {
    TASKS_DIR,
    HISTORY_DIR: path.join(TASKS_DIR, '.history'),
    TRASH_DIR: path.join(TASKS_DIR, '.trash'),
    ARCHIVED_DIR: path.join(TASKS_DIR, '.archived'),

    APPROVALS_DIR: path.join(root, 'approvals'),

    AGENT_TOKENS_DIR,
    AGENT_TOKENS_BLOCKLIST: path.join(AGENT_TOKENS_DIR, '.blocklist.json'),

    USERS_DIR: path.join(root, 'users'),

    CHAT_DIR,
    CHAT_FILE: path.join(CHAT_DIR, 'chat-messages.json'),

    SETTINGS_FILE: path.join(root, 'settings.json'),
    SERVICES_FILE: path.join(root, 'services.json'),
    PROJECTS_FILE: path.join(root, 'projects.json'),

    // These three predate ATRIUM_DATA_DIR — the loop test scripts point them
    // at throwaway files so a test run never clobbers real loops. The narrower
    // per-file override therefore wins over the broader root.
    LOOPS_FILE: pick(env, 'ATRIUM_LOOPS_FILE', path.join(root, 'loops.json')),
    LOOP_RUNS_DIR: pick(env, 'ATRIUM_LOOP_RUNS_DIR', path.join(root, 'loop-runs')),
    LOOP_TEMPLATES_FILE: pick(env, 'ATRIUM_LOOP_TEMPLATES_FILE', path.join(root, 'loop-templates.json')),

    E2E_RUNS_DIR: path.join(root, 'e2e-runs'),

    AUTOENTER_DIR,
    AUTOENTER_CAPTURES_FILE: path.join(AUTOENTER_DIR, 'captures.json'),

    UPLOADS_DIR,
    PROTOTYPES_DIR: path.join(UPLOADS_DIR, 'prototypes'),

    JWT_SECRET_FILE: path.join(root, '.jwt-secret'),
  };
}

// Create every state directory if it does not already exist.
//
// A fresh container volume is an empty directory, so without this the first
// write to any state dir throws ENOENT. mkdir recursive is idempotent, so
// this is safe to call on every boot and never touches existing content.
//
// Only directories are created — files (settings.json, loops.json, ...) are
// left alone so their owning modules keep control of default content.
function ensureDataDirs(paths) {
  const dirs = [
    paths.TASKS_DIR, paths.HISTORY_DIR, paths.TRASH_DIR, paths.ARCHIVED_DIR,
    paths.APPROVALS_DIR, paths.AGENT_TOKENS_DIR, paths.USERS_DIR, paths.CHAT_DIR,
    paths.LOOP_RUNS_DIR, paths.E2E_RUNS_DIR, paths.AUTOENTER_DIR,
    paths.UPLOADS_DIR, paths.PROTOTYPES_DIR,
  ];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { resolveDataDir, buildDataPaths, ensureDataDirs };
