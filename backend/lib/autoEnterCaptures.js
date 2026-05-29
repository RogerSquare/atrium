// Backend store for Auto-Enter prompt captures
// (bug-autoenter-ansi-cursor-strip-001 extension).
//
// The terminal's auto-Enter toggle scans recent stdout against a regex
// pattern set. When it's armed and output stalls on something it does NOT
// recognize (classifyTail → 'unknown'), the frontend records a snapshot.
// Those snapshots used to live only in per-browser localStorage, so the
// real-world misses driving "the button is only semi-functional" were
// invisible. Persisting them here makes them queryable across sessions —
// the data we mine to add new PROMPT_PATTERNS instead of guessing blind.
//
// Storage mirrors lib/chat.js: a single JSON array on disk, capped to the
// newest MAX_AUTOENTER_CAPTURES. Read-modify-write is serialized with the
// shared async mutex so concurrent POSTs can't clobber each other.

const fs = require('fs');
const path = require('path');
const {
  AUTOENTER_DIR,
  AUTOENTER_CAPTURES_FILE,
  AUTOENTER_FIRES_FILE,
  MAX_AUTOENTER_CAPTURES,
} = require('./constants');
const { withLock } = require('./lock');

const LOCK_KEY = 'autoenter:captures';
// Cap a single capture's tail so a runaway buffer can't bloat the file.
const MAX_TAIL_LEN = 4000;

// Fire events go to their own file so their high frequency can't evict the
// rarer-but-valuable misses (bug-autoenter-misfire-menus-001). Everything
// else (the 'unknown' misses, plus any future class) shares captures.json.
function fileFor(classification) {
  return classification === 'fire' ? AUTOENTER_FIRES_FILE : AUTOENTER_CAPTURES_FILE;
}

function ensureDir() {
  try {
    fs.mkdirSync(AUTOENTER_DIR, { recursive: true });
  } catch {
    /* already exists or unwritable — write will surface the real error */
  }
}

function loadCaptures(file = AUTOENTER_CAPTURES_FILE) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Missing file / parse error → empty log. Same fail-soft as lib/chat.js.
    return [];
  }
}

// Persist atomically: write a temp file then rename, so a crash mid-write
// can't leave a half-written JSON the next loadCaptures() would discard.
function saveCaptures(captures, file = AUTOENTER_CAPTURES_FILE) {
  ensureDir();
  const trimmed = captures.slice(-MAX_AUTOENTER_CAPTURES);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2));
  fs.renameSync(tmp, file);
  return trimmed;
}

// Normalize an incoming capture into the stored shape. Rejects (returns
// null) when there's no usable prompt text — the caller turns that into a
// 400 so junk doesn't accumulate.
function normalizeCapture(input, { now, user } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const tail = typeof src.bufferTail === 'string' ? src.bufferTail : '';
  if (!tail.trim()) return null;
  const ts = Number.isFinite(now) ? now : Date.now();
  return {
    bufferTail: tail.slice(0, MAX_TAIL_LEN),
    taskId: typeof src.taskId === 'string' ? src.taskId.slice(0, 128) : null,
    classification: typeof src.classification === 'string' ? src.classification : 'unknown',
    capturedAt: Number.isFinite(src.capturedAt) ? src.capturedAt : ts,
    loggedAt: ts,
    user: typeof user === 'string' ? user : null,
  };
}

// Append one capture under the lock. Returns { entry, total } or null when
// the input had no usable bufferTail. Fires land in fires.json, everything
// else in captures.json — keyed off the entry's classification.
async function appendCapture(input, meta = {}) {
  const entry = normalizeCapture(input, meta);
  if (!entry) return null;
  const file = fileFor(entry.classification);
  return withLock(`${LOCK_KEY}:${file}`, async () => {
    const captures = loadCaptures(file);
    captures.push(entry);
    const saved = saveCaptures(captures, file);
    return { entry, total: saved.length };
  });
}

// Read-only query: optional taskId / classification filters, newest-first,
// capped at `limit` (default 200, hard max = MAX_AUTOENTER_CAPTURES).
// `classification: 'fire'` reads the fires log; anything else reads the
// misses log (and still filters by classification within it).
function queryCaptures({ taskId, classification, limit } = {}) {
  let captures = loadCaptures(fileFor(classification));
  if (taskId) captures = captures.filter((c) => c && c.taskId === taskId);
  if (classification) captures = captures.filter((c) => c && c.classification === classification);
  captures = captures
    .slice()
    .sort((a, b) => (b?.capturedAt || 0) - (a?.capturedAt || 0));
  const n = Math.min(
    Number.isFinite(limit) && limit > 0 ? limit : 200,
    MAX_AUTOENTER_CAPTURES,
  );
  return { captures: captures.slice(0, n), total: captures.length };
}

// Clear one log. `classification: 'fire'` clears fires.json; otherwise the
// misses log. Pass nothing to clear misses (back-compat).
async function clearCaptures(classification) {
  const file = fileFor(classification);
  return withLock(`${LOCK_KEY}:${file}`, async () => {
    saveCaptures([], file);
    return { cleared: true };
  });
}

module.exports = {
  loadCaptures,
  saveCaptures,
  normalizeCapture,
  appendCapture,
  queryCaptures,
  clearCaptures,
  MAX_TAIL_LEN,
  // exported for tests that need to assert against the paths
  AUTOENTER_CAPTURES_FILE,
  AUTOENTER_FIRES_FILE,
};
