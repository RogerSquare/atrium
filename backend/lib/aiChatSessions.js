// In-flight AI chat session store + claude stream-json parser
// (feat-ai-chat-stream-001).
//
// The old /api/ai/chat held the HTTP response open while `claude --print`
// ran to completion, so the panel showed nothing for the whole generation
// and a page refresh lost the response entirely. Sessions now live here,
// keyed by thread (`task:<id>` / `user:<username>`), accumulating the
// streamed text server-side. Socket clients that join the thread's room
// mid-generation get the accumulated buffer as a snapshot and live deltas
// after it — that is what makes streams resumable across refreshes.
//
// Everything here is pure state + parsing (no child_process, no socket.io)
// so it can be unit tested without spawning anything.

const sessions = new Map();

const roomForKey = (key) => `ai:${key}`;

// Session shape. `proc` is attached by the route and deliberately excluded
// from snapshots — it must never serialize to a client.
const createSession = (key, meta = {}) => {
  const session = {
    key,
    buffer: '',
    status: 'running', // running | done | error | cancelled
    error: null,
    cancelled: false,
    startedAt: new Date().toISOString(),
    userMessage: meta.userMessage || '',
    proc: null,
  };
  sessions.set(key, session);
  return session;
};

const get = (key) => sessions.get(key) || null;
const isRunning = (key) => sessions.get(key)?.status === 'running';

// Client-safe view of a session. Null when the thread has nothing in flight —
// finished sessions are removed, so a snapshot means "attach to this".
const snapshot = (key) => {
  const s = sessions.get(key);
  if (!s) return null;
  return {
    key: s.key,
    buffer: s.buffer,
    status: s.status,
    startedAt: s.startedAt,
    userMessage: s.userMessage,
  };
};

const appendText = (key, text) => {
  const s = sessions.get(key);
  if (s) s.buffer += text;
};

const replaceText = (key, text) => {
  const s = sessions.get(key);
  if (s) s.buffer = text;
};

const finish = (key, { status = 'done', error = null } = {}) => {
  const s = sessions.get(key);
  if (!s) return null;
  s.status = status;
  s.error = error;
  s.proc = null;
  sessions.delete(key);
  return s;
};

const markCancelled = (key) => {
  const s = sessions.get(key);
  if (s) s.cancelled = true;
};

// --- stream-json parsing ---
//
// `claude --print --output-format stream-json --verbose
// --include-partial-messages` emits NDJSON. The events we care about:
//
//   {type:'stream_event', event:{type:'content_block_delta',
//     delta:{type:'text_delta', text:'...'}}}        → token-level append
//   {type:'assistant', message:{content:[{type:'text', text:'...'}]}}
//     → a completed assistant message (per turn; duplicates prior deltas)
//   {type:'result', result:'...'}                    → canonical final answer
//
// On CLIs without --include-partial-messages support there are no
// stream_event lines and the assistant events carry the streaming; the
// endsWith() dedupe below makes both shapes safe to handle unconditionally.

const messageText = (message) => {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
};

// Line-buffered NDJSON parser. Feed it raw stdout chunks; it fires:
//   onDelta(text)     — append `text` to the visible buffer
//   onMessage(text)   — a full assistant message not already in the buffer
//   onResult(text)    — the final result; replaces the buffer
// `currentBuffer()` lets the dedupe check see what has been accumulated.
const createStreamParser = ({ onDelta, onMessage, onResult, currentBuffer }) => {
  let pending = '';
  let parsedAnyEvent = false;

  const handleEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    parsedAnyEvent = true;

    if (event.type === 'stream_event') {
      const delta = event.event?.delta;
      if (event.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && delta.text) {
        onDelta(delta.text);
      }
      return;
    }

    if (event.type === 'assistant') {
      const text = messageText(event.message);
      // Deltas (when supported) have already streamed this exact text; only
      // surface it when the buffer tail doesn't contain it.
      if (text && !currentBuffer().endsWith(text)) {
        onMessage(text);
      }
      return;
    }

    if (event.type === 'result') {
      if (typeof event.result === 'string' && event.result.length > 0) {
        onResult(event.result);
      }
    }
  };

  const write = (chunk) => {
    pending += chunk;
    let idx;
    while ((idx = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, idx).trim();
      pending = pending.slice(idx + 1);
      if (!line) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        // Non-JSON noise on stdout (npm banners, warnings) — ignore the line.
      }
    }
  };

  const flush = () => {
    const line = pending.trim();
    pending = '';
    if (!line) return;
    try {
      handleEvent(JSON.parse(line));
    } catch {
      /* ignore trailing partial line */
    }
  };

  return { write, flush, parsedAnyEvent: () => parsedAnyEvent };
};

module.exports = {
  roomForKey,
  createSession,
  get,
  isRunning,
  snapshot,
  appendText,
  replaceText,
  finish,
  markCancelled,
  createStreamParser,
  messageText,
};
