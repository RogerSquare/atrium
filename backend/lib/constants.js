const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { resolveDataDir, buildDataPaths, ensureDataDirs } = require('./dataDir');

const PORT = Number(process.env.PORT) || 3001;

// All mutable state hangs off ONE root (devops-docker-datadir-001) so a
// container mounts a single volume instead of a dozen bind mounts. Defaults
// to the backend directory, which is exactly where every one of these paths
// used to be spelled out by hand — a native install sees no change.
const DATA_DIR = resolveDataDir({ defaultRoot: path.join(__dirname, '..') });
const paths = buildDataPaths(DATA_DIR);

// A fresh volume is an empty directory; create the state dirs before anything
// tries to write into them.
ensureDataDirs(paths);

const {
  TASKS_DIR, HISTORY_DIR, TRASH_DIR, ARCHIVED_DIR,
  APPROVALS_DIR, AGENT_TOKENS_DIR, AGENT_TOKENS_BLOCKLIST,
  USERS_DIR, CHAT_DIR, CHAT_FILE,
  SETTINGS_FILE, SERVICES_FILE, PROJECTS_FILE,
  // GitHub-watcher Loops persistence (feat-loops-model-001), loop AI-summary
  // run records (feat-loops-hook-agent-001), and reusable loop instruction
  // templates (feat-loopsv2-instructions-001). All runtime data — gitignored.
  // Their per-file ATRIUM_LOOP*_ env overrides still win over DATA_DIR so the
  // loop test scripts can keep pointing at throwaway files.
  LOOPS_FILE, LOOP_RUNS_DIR, LOOP_TEMPLATES_FILE,
  // Playwright e2e run artifacts (feat-e2e-tests-tab-001). Per-task subdirs;
  // each subdir is one run, capped at MAX_E2E_RUNS_PER_TASK newest-first.
  E2E_RUNS_DIR,
  // Auto-Enter capture log (bug-autoenter-ansi-cursor-strip-001 extension).
  // The terminal auto-Enter toggle records prompts it FAILS to recognize so
  // the misses can be mined for new detection patterns. Captures were
  // previously per-browser localStorage only; this backend store makes them
  // analyzable across sessions.
  AUTOENTER_DIR, AUTOENTER_CAPTURES_FILE,
  // Design Studio uploads + generated prototypes (were local to routes/design.js
  // until this refactor pulled them under the single data root).
  UPLOADS_DIR, PROTOTYPES_DIR,
  JWT_SECRET_FILE,
} = paths;

const MAX_CHAT_MESSAGES = 500;
const MAX_LOOP_RUNS_PER_LOOP = 30;
const MAX_E2E_RUNS_PER_TASK = 5;
const MAX_AUTOENTER_CAPTURES = 500;

// Source, not state — instructions.md lives in the repo and is read-only at
// runtime, so it stays repo-relative and deliberately does NOT move with
// ATRIUM_DATA_DIR. In a container it ships inside the image.
const INSTRUCTIONS_FILE = path.join(__dirname, '..', '..', 'instructions.md');

// JWT secret resolution: env var > persisted file > generate (dev) > fail (prod)

function resolveJwtSecret() {
  // 1. Environment variable takes priority
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // 2. Check for persisted secret file
  if (fs.existsSync(JWT_SECRET_FILE)) {
    const secret = fs.readFileSync(JWT_SECRET_FILE, 'utf-8').trim();
    if (secret.length >= 32) {
      return secret;
    }
  }

  // 3. In production, refuse to start without a proper secret
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable is required in production. Exiting.');
    process.exit(1);
  }

  // 4. In development, auto-generate and persist a random secret
  const generated = crypto.randomBytes(48).toString('base64');
  try {
    fs.writeFileSync(JWT_SECRET_FILE, generated, { mode: 0o600 });
    console.warn('[WARN] No JWT_SECRET set. Auto-generated dev secret saved to .jwt-secret (do not commit this file).');
  } catch (err) {
    console.warn('[WARN] No JWT_SECRET set. Using ephemeral dev secret (will change on restart).');
  }
  return generated;
}

const JWT_SECRET = resolveJwtSecret();

module.exports = {
  PORT, DATA_DIR, TASKS_DIR, HISTORY_DIR, USERS_DIR, SETTINGS_FILE,
  SERVICES_FILE, CHAT_DIR, CHAT_FILE, MAX_CHAT_MESSAGES,
  INSTRUCTIONS_FILE, JWT_SECRET, TRASH_DIR, ARCHIVED_DIR, PROJECTS_FILE, LOOPS_FILE, LOOP_RUNS_DIR, MAX_LOOP_RUNS_PER_LOOP, LOOP_TEMPLATES_FILE, APPROVALS_DIR,
  AGENT_TOKENS_DIR, AGENT_TOKENS_BLOCKLIST,
  E2E_RUNS_DIR, MAX_E2E_RUNS_PER_TASK,
  AUTOENTER_DIR, AUTOENTER_CAPTURES_FILE, MAX_AUTOENTER_CAPTURES,
  UPLOADS_DIR, PROTOTYPES_DIR,
};
