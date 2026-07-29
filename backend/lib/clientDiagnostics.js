// Client-side diagnostic event log (bug-shell-clipboard-001).
//
// Built because clipboard bugs are invisible from the server: everything
// happens in the browser, the failures are silent by design (a denied
// permission resolves to a rejected promise, not an error page), and the
// symptom — "paste does nothing" — is identical whether the cause is a
// missing permission, a non-secure origin, a swallowed shortcut, or an
// unfocused document. Guessing between those cost several rounds.
//
// So the browser reports what it actually observed and the server keeps it.
//
// Deliberately NOT a general-purpose logging endpoint: it accepts a known set
// of fields, caps everything, and never echoes raw clipboard CONTENT — only
// lengths and outcomes. An endpoint that logged what you pasted would be a
// worse problem than the bug it diagnoses.

const fs = require('fs');
const path = require('path');

const MAX_EVENTS = 500;
const MAX_STRING = 300;

// Fields accepted from the client. Anything else is dropped rather than
// stored, so a compromised or buggy client cannot use this as free storage.
const ALLOWED_FIELDS = [
  'category',      // 'clipboard'
  'action',        // 'copy' | 'paste'
  'trigger',       // 'key' | 'button' | 'contextmenu' | 'native-paste'
  'result',        // 'ok' | 'empty' | 'denied' | 'unavailable' | 'error'
  'detail',        // short free text (error message, key combo, ...)
  'secureContext', // boolean
  'hasClipboardRead',
  'hasClipboardWrite',
  'permissionState', // 'granted' | 'denied' | 'prompt' | 'unsupported'
  'hasSelection',
  'selectionLength', // LENGTH only — never the text
  'textLength',      // LENGTH only — never the text
  'mouseTracking',
  'userAgent',
  'origin',
  'taskId',
];

function clampString(value) {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, MAX_STRING);
}

function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    const value = raw[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') out[key] = clampString(value);
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  if (Object.keys(out).length === 0) return null;
  out.at = new Date().toISOString();
  return out;
}

function createDiagnosticsLog({ file, maxEvents = MAX_EVENTS } = {}) {
  // In-memory ring is the source of truth for reads — the file is a
  // convenience for post-mortems after a restart, not a queryable store.
  let events = [];

  if (file) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(existing)) events = existing.slice(-maxEvents);
    } catch { /* absent or corrupt — start clean */ }
  }

  function persist() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(events, null, 2));
    } catch { /* diagnostics must never break the request they describe */ }
  }

  return {
    record(raw) {
      const event = sanitizeEvent(raw);
      if (!event) return null;
      events.push(event);
      if (events.length > maxEvents) events = events.slice(-maxEvents);
      persist();
      return event;
    },
    list({ limit = 100, category } = {}) {
      let out = events;
      if (category) out = out.filter(e => e.category === category);
      return out.slice(-Math.max(1, Math.min(limit, maxEvents)));
    },
    clear() {
      events = [];
      persist();
    },
    size() {
      return events.length;
    },
  };
}

module.exports = { createDiagnosticsLog, sanitizeEvent, ALLOWED_FIELDS, MAX_EVENTS };
