const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3001;
const TASKS_DIR = path.join(__dirname, '..', 'tasks');
const HISTORY_DIR = path.join(TASKS_DIR, '.history');
const TRASH_DIR = path.join(TASKS_DIR, '.trash');
const ARCHIVED_DIR = path.join(TASKS_DIR, '.archived');
const APPROVALS_DIR = path.join(__dirname, '..', 'approvals');
const AGENT_TOKENS_DIR = path.join(__dirname, '..', 'agent-tokens');
const AGENT_TOKENS_BLOCKLIST = path.join(AGENT_TOKENS_DIR, '.blocklist.json');
const USERS_DIR = path.join(__dirname, '..', 'users');
const SETTINGS_FILE = path.join(__dirname, '..', 'settings.json');
const SERVICES_FILE = path.join(__dirname, '..', 'services.json');
const CHAT_DIR = path.join(__dirname, '..', 'chat');
const CHAT_FILE = path.join(CHAT_DIR, 'chat-messages.json');
const MAX_CHAT_MESSAGES = 500;
const INSTRUCTIONS_FILE = path.join(__dirname, '..', '..', 'instructions.md');
const PROJECTS_FILE = path.join(__dirname, '..', 'projects.json');
// GitHub-watcher Loops persistence (feat-loops-model-001). Runtime data,
// gitignored like settings.json/services.json. Env override lets tests point
// at a throwaway file instead of clobbering real loops.
const LOOPS_FILE = process.env.ATRIUM_LOOPS_FILE || path.join(__dirname, '..', 'loops.json');
// Loop AI-summary run records (feat-loops-hook-agent-001). One JSON per run,
// per-loop subdir, capped newest-first. Runtime data — gitignored. Each record
// captures the FULL context fed to the agent + its output, for review.
const LOOP_RUNS_DIR = path.join(__dirname, '..', 'loop-runs');
const MAX_LOOP_RUNS_PER_LOOP = 30;
// Reusable loop instruction templates (feat-loopsv2-instructions-001). Runtime
// data, gitignored. Env override for tests.
const LOOP_TEMPLATES_FILE = process.env.ATRIUM_LOOP_TEMPLATES_FILE || path.join(__dirname, '..', 'loop-templates.json');
// Playwright e2e run artifacts (feat-e2e-tests-tab-001). Per-task subdirs;
// each subdir is one run, capped at MAX_E2E_RUNS_PER_TASK newest-first.
const E2E_RUNS_DIR = path.join(__dirname, '..', 'e2e-runs');
const MAX_E2E_RUNS_PER_TASK = 5;

// Auto-Enter capture log (bug-autoenter-ansi-cursor-strip-001 extension).
// The terminal auto-Enter toggle records prompts it FAILS to recognize so
// the misses can be mined for new detection patterns. Captures were
// previously per-browser localStorage only; this backend store makes them
// analyzable across sessions. Runtime data — gitignored like backend/chat/.
const AUTOENTER_DIR = path.join(__dirname, '..', 'autoenter');
const AUTOENTER_CAPTURES_FILE = path.join(AUTOENTER_DIR, 'captures.json');
const MAX_AUTOENTER_CAPTURES = 500;

// JWT secret resolution: env var > persisted file > generate (dev) > fail (prod)
const JWT_SECRET_FILE = path.join(__dirname, '..', '.jwt-secret');

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
  PORT, TASKS_DIR, HISTORY_DIR, USERS_DIR, SETTINGS_FILE,
  SERVICES_FILE, CHAT_DIR, CHAT_FILE, MAX_CHAT_MESSAGES,
  INSTRUCTIONS_FILE, JWT_SECRET, TRASH_DIR, ARCHIVED_DIR, PROJECTS_FILE, LOOPS_FILE, LOOP_RUNS_DIR, MAX_LOOP_RUNS_PER_LOOP, LOOP_TEMPLATES_FILE, APPROVALS_DIR,
  AGENT_TOKENS_DIR, AGENT_TOKENS_BLOCKLIST,
  E2E_RUNS_DIR, MAX_E2E_RUNS_PER_TASK,
  AUTOENTER_DIR, AUTOENTER_CAPTURES_FILE, MAX_AUTOENTER_CAPTURES,
};
