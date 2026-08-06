const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('./aiChatSessions');

// Unique keys per test — the store is module-level state.
let n = 0;
const freshKey = () => `task:test-${++n}`;

// Wire a parser to a real session, mirroring how routes/ai.js composes them.
const parserFor = (key, events = []) => sessions.createStreamParser({
  currentBuffer: () => sessions.get(key)?.buffer || '',
  onDelta: (text) => { sessions.appendText(key, text); events.push({ delta: text }); },
  onMessage: (text) => {
    const sep = (sessions.get(key)?.buffer || '') ? '\n\n' : '';
    sessions.appendText(key, sep + text);
    events.push({ message: text });
  },
  onResult: (text) => { sessions.replaceText(key, text); events.push({ result: text }); },
});

const line = (obj) => JSON.stringify(obj) + '\n';

test('session lifecycle: create, append, snapshot, finish removes', () => {
  const key = freshKey();
  sessions.createSession(key, { userMessage: 'hi' });
  assert.equal(sessions.isRunning(key), true);
  sessions.appendText(key, 'hello ');
  sessions.appendText(key, 'world');
  const snap = sessions.snapshot(key);
  assert.equal(snap.buffer, 'hello world');
  assert.equal(snap.status, 'running');
  assert.equal(snap.userMessage, 'hi');
  assert.equal(snap.proc, undefined); // proc must never leak into snapshots
  sessions.finish(key, { status: 'done' });
  assert.equal(sessions.get(key), null);
  assert.equal(sessions.snapshot(key), null);
});

test('markCancelled flags the session without removing it', () => {
  const key = freshKey();
  sessions.createSession(key);
  sessions.markCancelled(key);
  assert.equal(sessions.get(key).cancelled, true);
  assert.equal(sessions.isRunning(key), true);
  sessions.finish(key, { status: 'cancelled' });
});

test('text deltas accumulate in order', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hel' } } }));
  parser.write(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } } }));
  assert.equal(sessions.get(key).buffer, 'Hello');
  assert.equal(parser.parsedAnyEvent(), true);
  sessions.finish(key);
});

test('chunks split across writes are line-buffered correctly', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  const full = line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'abc' } } });
  parser.write(full.slice(0, 25));
  assert.equal(sessions.get(key).buffer, ''); // incomplete line: nothing yet
  parser.write(full.slice(25));
  assert.equal(sessions.get(key).buffer, 'abc');
  sessions.finish(key);
});

test('assistant message already streamed via deltas is not duplicated', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello world' } } }));
  parser.write(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } }));
  assert.equal(sessions.get(key).buffer, 'Hello world');
  sessions.finish(key);
});

test('assistant messages stream coarsely when no deltas are emitted (old CLI)', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'First turn.' }] } }));
  parser.write(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Second turn.' }] } }));
  assert.equal(sessions.get(key).buffer, 'First turn.\n\nSecond turn.');
  sessions.finish(key);
});

test('result event replaces the accumulated buffer', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Let me check that...' } } }));
  parser.write(line({ type: 'result', subtype: 'success', result: 'The final answer.' }));
  assert.equal(sessions.get(key).buffer, 'The final answer.');
  sessions.finish(key);
});

test('non-JSON noise lines are ignored without breaking the stream', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write('npm warn something unrelated\n');
  parser.write(line({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } } }));
  parser.write('not json either\n');
  assert.equal(sessions.get(key).buffer, 'ok');
  assert.equal(parser.parsedAnyEvent(), true);
  sessions.finish(key);
});

test('parsedAnyEvent stays false for pure-noise output (plain-text fallback signal)', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write('Just a plain text answer\nwith two lines\n');
  parser.flush();
  assert.equal(parser.parsedAnyEvent(), false);
  assert.equal(sessions.get(key).buffer, '');
  sessions.finish(key);
});

test('flush parses a trailing line with no newline', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(JSON.stringify({ type: 'result', result: 'tail' })); // no \n
  assert.equal(sessions.get(key).buffer, '');
  parser.flush();
  assert.equal(sessions.get(key).buffer, 'tail');
  sessions.finish(key);
});

test('tool-use and system events are counted but produce no text', () => {
  const key = freshKey();
  sessions.createSession(key);
  const parser = parserFor(key);
  parser.write(line({ type: 'system', subtype: 'init', session_id: 'abc' }));
  parser.write(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: {} }] } }));
  assert.equal(sessions.get(key).buffer, '');
  assert.equal(parser.parsedAnyEvent(), true);
  sessions.finish(key);
});

test('roomForKey namespaces thread keys', () => {
  assert.equal(sessions.roomForKey('task:feat-x-001'), 'ai:task:feat-x-001');
  assert.equal(sessions.roomForKey('user:roger'), 'ai:user:roger');
});
