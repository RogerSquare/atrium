const fs = require('fs');
const path = require('path');
const { LOOP_RUNS_DIR } = require('./constants');
const { logger } = require('./logger');
const { getIO } = require('./io');

/**
 * Per-loop activity / audit trail (feat-loopsv2-activity-001).
 *
 * Records what a loop actually DID — field updates, comments, status moves,
 * tasks created, AI summaries, terminal runs, errors — so changes are auditable
 * in the loop cockpit's Activity tab. Stored as a capped JSON array per loop
 * (atomic write); each append emits a `loop_activity` socket event for live UI.
 */

const MAX_ENTRIES = 200;

function filePath(loopId) {
  return path.join(LOOP_RUNS_DIR, String(loopId).replace(/[^a-zA-Z0-9_-]/g, '_'), 'activity.json');
}

function load(loopId) {
  const p = filePath(loopId);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn({ err, loopId }, 'loopActivity: failed to parse; treating as empty');
    return [];
  }
}

function save(loopId, list) {
  const p = filePath(loopId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p + '.tmp', JSON.stringify(list, null, 2));
  fs.renameSync(p + '.tmp', p);
}

// Append one audit entry. `type` is a short tag; `message` is human-readable;
// `refs` carries optional { task_id, pr_number, pr_url, run_id }. Returns the entry.
function append(loopId, { type, message, refs = {} } = {}, { now = new Date().toISOString() } = {}) {
  if (!loopId || !type) return null;
  const entry = {
    id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    loop_id: loopId,
    ts: now,
    type,
    message: message || type,
    refs,
  };
  try {
    const list = load(loopId);
    list.push(entry);
    save(loopId, list.slice(-MAX_ENTRIES));
    try { const io = getIO(); if (io) io.emit('loop_activity', entry); } catch { /* io not ready */ }
  } catch (err) {
    logger.warn({ err: err.message, loopId }, 'loopActivity: append failed');
  }
  return entry;
}

// Newest first for the UI feed.
function list(loopId) {
  return load(loopId).slice().reverse();
}

module.exports = { append, list, MAX_ENTRIES };
