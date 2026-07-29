// Unit tests for backend/lib/dockerServices.js (feat-services-containers-001).
//
// These cover the pure translation layer — Docker's vocabulary into Atrium's.
// The HTTP calls themselves are exercised against a real daemon in the task's
// verification, not mocked here.

const test = require('node:test');
const assert = require('node:assert');

const {
  mapState,
  firstPublishedPort,
  demuxLogStream,
  isContainerService,
  containerNameFor,
} = require('./dockerServices');

// --- state mapping -------------------------------------------------------

test('running maps to running', () => {
  assert.strictEqual(mapState('running'), 'running');
});

test('restarting reads as starting, not stopped', () => {
  // Showing "stopped" for a restarting container makes the UI look broken
  // mid-restart and invites a second click.
  assert.strictEqual(mapState('restarting'), 'starting');
});

test('every other docker state collapses to stopped', () => {
  for (const s of ['created', 'paused', 'removing', 'exited', 'dead', 'unknown', undefined]) {
    assert.strictEqual(mapState(s), 'stopped', `${s} should read as stopped`);
  }
});

// --- port discovery ------------------------------------------------------

test('reads the published host port from an inspect payload', () => {
  // Shape taken from a real `docker inspect artifex`: 3002/tcp -> host 3080.
  const inspect = {
    NetworkSettings: { Ports: { '3002/tcp': [{ HostIp: '0.0.0.0', HostPort: '3080' }] } },
  };
  assert.strictEqual(firstPublishedPort(inspect), 3080);
});

test('an unpublished or absent port map yields null, not a crash', () => {
  assert.strictEqual(firstPublishedPort({ NetworkSettings: { Ports: {} } }), null);
  assert.strictEqual(firstPublishedPort({ NetworkSettings: {} }), null);
  assert.strictEqual(firstPublishedPort({}), null);
  assert.strictEqual(firstPublishedPort(null), null);
  // Exposed but not bound to a host port — Docker gives null bindings.
  assert.strictEqual(firstPublishedPort({ NetworkSettings: { Ports: { '80/tcp': null } } }), null);
});

// --- log stream de-multiplexing -----------------------------------------

// Build a Docker log frame: 1 byte stream type, 3 NUL, 4-byte big-endian length.
function frame(streamType, payload) {
  const len = payload.length;
  return String.fromCharCode(streamType, 0, 0, 0,
    (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff) + payload;
}

test('strips the 8-byte framing from a non-TTY log stream', () => {
  const raw = frame(1, 'server listening\n') + frame(2, 'a warning\n');
  assert.deepStrictEqual(demuxLogStream(raw), ['server listening', 'a warning']);
});

test('plain TTY output passes through untouched', () => {
  // TTY containers are not framed; treating them as framed would eat characters.
  assert.deepStrictEqual(demuxLogStream('hello\nworld\n'), ['hello', 'world']);
});

test('empty input yields no lines', () => {
  assert.deepStrictEqual(demuxLogStream(''), []);
});

// --- service type discrimination ----------------------------------------

test('only an explicit container type is Docker-managed', () => {
  assert.ok(isContainerService({ type: 'container' }));
  assert.strictEqual(isContainerService({ type: 'process' }), false);
  // THE COMPATIBILITY GUARANTEE: an existing services.json entry has no `type`
  // and must keep behaving as a host process.
  assert.strictEqual(isContainerService({ id: 'legacy', cwd: 'C:\\x', startCmd: 'npm start' }), false);
  assert.strictEqual(isContainerService(null), false);
});

test('container name falls back to the service id', () => {
  assert.strictEqual(containerNameFor({ id: 'artifex-backend', container_name: 'artifex' }), 'artifex');
  assert.strictEqual(containerNameFor({ id: 'artifex' }), 'artifex');
});
