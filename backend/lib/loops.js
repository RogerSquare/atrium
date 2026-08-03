const fs = require('fs');
const { LOOPS_FILE } = require('./constants');
const { logger } = require('./logger');
const { scheduleError, normalizeSchedule } = require('./loopSchedule');

/**
 * Loops registry (feat-loops-model-001)
 *
 * A "Loop" is a user-configurable GitHub watcher. This module owns the schema,
 * validation, and file-based persistence (loops.json). Scheduling/polling and
 * hook-tracked agent runs live in later phases (loopManager, loopsHook) — this
 * phase is the data model + CRUD only.
 *
 * Persistence mirrors the rest of the backend: plain JSON, atomic write
 * (.tmp -> rename) to avoid corruption on a mid-write crash.
 */

const WATCH_TYPES = ['prs', 'ci', 'commits', 'issues'];
const ACTION_TYPES = ['update_fields', 'comment', 'ai_summary'];
const SCOPES = ['project', 'global'];
const MODES = ['watcher', 'worker', 'playbook'];
const STATUSES = ['idle', 'running', 'error'];
const MIN_INTERVAL_MS = 60000;       // floor: 1 minute
const DEFAULT_INTERVAL_MS = 300000;  // default: 5 minutes

// Worker execution-policy config (feat-loopsv2-execparams-001), nested under
// loop.worker. Lenient: normalizeWorker coerces + fills defaults so old loops
// (no worker field) and partial updates keep working.
const WORKER_DEFAULTS = {
  base_branch: 'main',
  branch_prefix: 'loop/',
  setup_command: '',
  test_command: '',
  lint_command: '',
  build_command: '',
  require_checks_pass: true,
  open_pr: true,
  draft_pr: false,
};

function normalizeWorker(w) {
  const x = (w && typeof w === 'object' && !Array.isArray(w)) ? w : {};
  const str = (v, d) => (typeof v === 'string' ? v : d);
  const bool = (v, d) => (typeof v === 'boolean' ? v : d);
  return {
    base_branch: (str(x.base_branch, WORKER_DEFAULTS.base_branch).trim() || WORKER_DEFAULTS.base_branch),
    branch_prefix: str(x.branch_prefix, WORKER_DEFAULTS.branch_prefix),
    setup_command: str(x.setup_command, ''),
    test_command: str(x.test_command, ''),
    lint_command: str(x.lint_command, ''),
    build_command: str(x.build_command, ''),
    require_checks_pass: bool(x.require_checks_pass, true),
    open_pr: bool(x.open_pr, true),
    draft_pr: bool(x.draft_pr, false),
  };
}

// Fields a client may set on create/update. Engine-managed runtime fields
// (status, last_run_at, next_run_at, last_result, last_error, snapshot) and
// immutable fields (id, created_at) are never accepted from the API.
const EDITABLE_FIELDS = ['name', 'scope', 'project', 'repo', 'watch', 'actions', 'interval_ms', 'schedule', 'enabled', 'instructions', 'mode', 'prompt_template', 'extra_context', 'worker'];

class LoopValidationError extends Error {
  constructor(details) {
    super('Invalid loop');
    this.name = 'LoopValidationError';
    this.status = 400;
    this.details = details;
  }
}

// --- Persistence ---------------------------------------------------------

function atomicWriteFileSync(filePath, content) {
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, filePath);
}

function loadAll() {
  if (!fs.existsSync(LOOPS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOOPS_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn({ err }, 'Failed to parse loops.json; treating as empty');
    return [];
  }
}

function saveAll(loops) {
  atomicWriteFileSync(LOOPS_FILE, JSON.stringify(loops, null, 2));
}

// --- Id generation -------------------------------------------------------

function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return slug || 'watcher';
}

function generateId(name, existingIds) {
  const base = `loop-${slugify(name)}`;
  let candidate = base;
  let counter = 2;
  while (existingIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter++;
  }
  return candidate;
}

// --- Validation ----------------------------------------------------------

function isSubset(arr, allowed) {
  return Array.isArray(arr) && arr.every((v) => allowed.includes(v));
}

/**
 * Validate a (possibly partial) loop payload. On `partial`, only present fields
 * are checked — used for updates. Returns the cleaned editable subset; throws
 * LoopValidationError with a per-field details object otherwise.
 *
 * `merged` is the post-merge view (existing + patch) used for cross-field rules
 * like "project required when scope=project".
 */
function validate(input, { partial = false, merged = null } = {}) {
  const errors = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);

  if (!partial || has('name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) {
      errors.name = 'name is required and must be a non-empty string';
    }
  }
  if (!partial || has('scope')) {
    if (!SCOPES.includes(input.scope)) {
      errors.scope = `scope must be one of ${SCOPES.join(', ')}`;
    }
  }
  if (has('watch')) {
    if (!isSubset(input.watch, WATCH_TYPES) || input.watch.length === 0) {
      errors.watch = `watch must be a non-empty subset of ${WATCH_TYPES.join(', ')}`;
    }
  }
  if (has('actions')) {
    if (!isSubset(input.actions, ACTION_TYPES) || input.actions.length === 0) {
      errors.actions = `actions must be a non-empty subset of ${ACTION_TYPES.join(', ')}`;
    }
  }
  if (has('interval_ms')) {
    if (!Number.isFinite(input.interval_ms) || input.interval_ms < MIN_INTERVAL_MS) {
      errors.interval_ms = `interval_ms must be a number >= ${MIN_INTERVAL_MS}`;
    }
  }
  if (has('schedule')) {
    const schedErr = scheduleError(input.schedule ?? null);
    if (schedErr) errors.schedule = schedErr;
  }
  if (has('enabled') && typeof input.enabled !== 'boolean') {
    errors.enabled = 'enabled must be a boolean';
  }
  if (has('instructions') && input.instructions !== null && typeof input.instructions !== 'string') {
    errors.instructions = 'instructions must be a string or null';
  }
  if (has('mode') && !MODES.includes(input.mode)) {
    errors.mode = `mode must be one of ${MODES.join(', ')}`;
  }
  for (const f of ['prompt_template', 'extra_context']) {
    if (has(f) && input[f] !== null && typeof input[f] !== 'string') errors[f] = `${f} must be a string or null`;
  }
  if (has('worker') && input.worker !== null && (typeof input.worker !== 'object' || Array.isArray(input.worker))) {
    errors.worker = 'worker must be an object';
  }

  // Cross-field: scope-dependent requirements (evaluated against the merged view)
  const view = merged || input;
  if (view.scope === 'project') {
    if (typeof view.project !== 'string' || !view.project.trim()) {
      errors.project = 'project is required when scope is "project"';
    }
  } else if (view.scope === 'global' && view.mode !== 'playbook') {
    // Playbooks don't poll a repo — a global playbook is a standalone
    // scheduled prompt and needs neither project nor repo.
    if (typeof view.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(view.repo)) {
      errors.repo = 'repo (owner/name) is required when scope is "global"';
    }
  }
  if (view.mode === 'playbook') {
    const instr = typeof view.instructions === 'string' ? view.instructions.trim() : '';
    if (!instr) errors.instructions = 'instructions are required for playbook loops — the playbook IS the prompt';
  }

  if (Object.keys(errors).length) throw new LoopValidationError(errors);
}

function pickEditable(input) {
  const out = {};
  for (const f of EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(input, f)) out[f] = input[f];
  }
  return out;
}

// --- CRUD ----------------------------------------------------------------

function list() {
  return loadAll();
}

function get(id) {
  return loadAll().find((l) => l.id === id) || null;
}

function create(input, { now = new Date().toISOString() } = {}) {
  const clean = pickEditable(input || {});
  // Apply defaults before validation so scope/watch/actions are well-formed.
  if (clean.scope === undefined) clean.scope = 'project';
  if (clean.watch === undefined) clean.watch = ['prs', 'ci'];
  if (clean.actions === undefined) clean.actions = ['update_fields', 'comment'];
  if (clean.interval_ms === undefined) clean.interval_ms = DEFAULT_INTERVAL_MS;
  if (clean.enabled === undefined) clean.enabled = true;
  if (clean.project === undefined) clean.project = null;
  if (clean.repo === undefined) clean.repo = null;
  if (clean.instructions === undefined) clean.instructions = null;
  if (clean.mode === undefined) clean.mode = 'watcher';
  if (clean.prompt_template === undefined) clean.prompt_template = null;
  if (clean.extra_context === undefined) clean.extra_context = null;

  validate(clean, { partial: false });

  const loops = loadAll();
  const existingIds = new Set(loops.map((l) => l.id));
  const loop = {
    id: generateId(clean.name, existingIds),
    name: clean.name.trim(),
    scope: clean.scope,
    project: clean.scope === 'project' ? clean.project : null,
    repo: clean.scope === 'global' ? clean.repo : (clean.repo || null),
    watch: clean.watch,
    actions: clean.actions,
    interval_ms: clean.interval_ms,
    schedule: normalizeSchedule(clean.schedule ?? null),
    enabled: clean.enabled,
    instructions: clean.instructions ?? null,
    mode: clean.mode || 'watcher',
    prompt_template: clean.prompt_template ?? null,
    extra_context: clean.extra_context ?? null,
    worker: normalizeWorker(clean.worker),
    status: 'idle',
    last_run_at: null,
    next_run_at: null,
    last_result: null,
    last_error: null,
    snapshot: { prs: {}, branches: {}, issues: {} },
    created_at: now,
    updated_at: now,
  };
  loops.push(loop);
  saveAll(loops);
  return loop;
}

function update(id, patch, { now = new Date().toISOString() } = {}) {
  const loops = loadAll();
  const idx = loops.findIndex((l) => l.id === id);
  if (idx === -1) return null;

  const clean = pickEditable(patch || {});
  const merged = { ...loops[idx], ...clean };
  validate(clean, { partial: true, merged });

  // Deep-merge the nested worker config so partial worker updates don't drop fields.
  if (clean.worker !== undefined) {
    merged.worker = normalizeWorker({ ...(loops[idx].worker || {}), ...(clean.worker || {}) });
  }

  // Schedule replaces wholesale (it's two fields); null clears it back to interval mode.
  if (clean.schedule !== undefined) {
    merged.schedule = normalizeSchedule(clean.schedule ?? null);
  }

  // Keep project/repo consistent with the (possibly changed) scope.
  if (merged.scope === 'project') merged.repo = clean.repo !== undefined ? clean.repo : merged.repo;
  if (merged.scope === 'global') merged.project = null;

  merged.id = loops[idx].id;            // immutable
  merged.created_at = loops[idx].created_at; // immutable
  merged.updated_at = now;
  loops[idx] = merged;
  saveAll(loops);
  return merged;
}

function remove(id) {
  const loops = loadAll();
  const next = loops.filter((l) => l.id !== id);
  if (next.length === loops.length) return false;
  saveAll(next);
  return true;
}

// Internal helper for the engine (later phases) to persist runtime fields
// without going through the editable-field-restricted API.
function patchRuntime(id, runtimeFields, { now = new Date().toISOString() } = {}) {
  const loops = loadAll();
  const idx = loops.findIndex((l) => l.id === id);
  if (idx === -1) return null;
  loops[idx] = { ...loops[idx], ...runtimeFields, updated_at: now };
  saveAll(loops);
  return loops[idx];
}

module.exports = {
  list, get, create, update, remove, patchRuntime,
  validate, generateId, loadAll, saveAll,
  LoopValidationError,
  WATCH_TYPES, ACTION_TYPES, SCOPES, MODES, STATUSES, MIN_INTERVAL_MS, DEFAULT_INTERVAL_MS, WORKER_DEFAULTS, normalizeWorker,
};
