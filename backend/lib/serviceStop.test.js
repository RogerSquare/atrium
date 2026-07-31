// Unit tests for the stop-strategy selection (devops-service-stop-xplat-001).

const test = require('node:test');
const assert = require('node:assert');
const { stopStrategy } = require('./serviceStop');

test('a tracked PID is stopped by PID, regardless of surface or platform', () => {
  assert.deepStrictEqual(
    stopStrategy({ surface: 'web', port: 3000 }, { pid: 4242 }, 'win32'),
    { kind: 'pid', pid: 4242, platform: 'win32' },
  );
  assert.deepStrictEqual(
    stopStrategy({ surface: 'cli' }, { pid: 99 }, 'linux'),
    { kind: 'pid', pid: 99, platform: 'linux' },
  );
});

test('a port service with no tracked PID falls back to a port-kill', () => {
  assert.deepStrictEqual(
    stopStrategy({ surface: 'web', port: 5173 }, null, 'darwin'),
    { kind: 'port', port: 5173, platform: 'darwin' },
  );
  // legacy service (no surface) with a port behaves the same
  assert.deepStrictEqual(
    stopStrategy({ port: 8080 }, null, 'linux'),
    { kind: 'port', port: 8080, platform: 'linux' },
  );
});

test('a portless surface with no tracked PID is already stopped (no-op)', () => {
  assert.strictEqual(stopStrategy({ surface: 'cli' }, null, 'linux').kind, 'none');
  assert.strictEqual(stopStrategy({ surface: 'desktop' }, null, 'win32').kind, 'none');
  assert.strictEqual(stopStrategy({ surface: 'job' }, { pid: null, lastExitCode: 0 }, 'darwin').kind, 'none');
});

test('a dead tracked entry (pid cleared) with a port still uses the port fallback', () => {
  assert.strictEqual(stopStrategy({ surface: 'web', port: 3000 }, { pid: null }, 'linux').kind, 'port');
});
