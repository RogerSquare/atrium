// Unit tests for the service surface/health model (feat-service-surfaces-001).

const test = require('node:test');
const assert = require('node:assert');
const {
  effectiveHealthcheck, portRequired, resolveStatus, jobStatus, SURFACES,
} = require('./serviceModel');

// --- effectiveHealthcheck ------------------------------------------------

test('legacy service (no surface, no healthcheck) is port-based', () => {
  assert.strictEqual(effectiveHealthcheck({}), 'port');
});

test('surface derives a default healthcheck', () => {
  assert.strictEqual(effectiveHealthcheck({ surface: 'web' }), 'port');
  assert.strictEqual(effectiveHealthcheck({ surface: 'server' }), 'port');
  assert.strictEqual(effectiveHealthcheck({ surface: 'desktop' }), 'pid');
  assert.strictEqual(effectiveHealthcheck({ surface: 'cli' }), 'pid');
  assert.strictEqual(effectiveHealthcheck({ surface: 'job' }), 'none');
});

test('explicit healthcheck overrides the surface default', () => {
  assert.strictEqual(effectiveHealthcheck({ surface: 'web', healthcheck: 'pid' }), 'pid');
  assert.strictEqual(effectiveHealthcheck({ surface: 'cli', healthcheck: 'http' }), 'http');
});

// --- portRequired --------------------------------------------------------

test('port is required for legacy + web/server, not for desktop/cli/job', () => {
  assert.strictEqual(portRequired({}), true);
  assert.strictEqual(portRequired({ surface: 'web' }), true);
  assert.strictEqual(portRequired({ surface: 'server' }), true);
  assert.strictEqual(portRequired({ surface: 'desktop' }), false);
  assert.strictEqual(portRequired({ surface: 'cli' }), false);
  assert.strictEqual(portRequired({ surface: 'job' }), false);
});

test('an explicit pid healthcheck drops the port requirement even for web', () => {
  assert.strictEqual(portRequired({ surface: 'web', healthcheck: 'pid' }), false);
});

// --- resolveStatus -------------------------------------------------------

test('port-based status follows the network probe', () => {
  assert.strictEqual(resolveStatus({ surface: 'web' }, { reachable: true }), 'running');
  assert.strictEqual(resolveStatus({ surface: 'web' }, { reachable: false }), 'stopped');
  assert.strictEqual(resolveStatus({}, { reachable: true }), 'running'); // legacy
});

test('pid-based status follows the tracked process, ignoring the port', () => {
  assert.strictEqual(resolveStatus({ surface: 'cli' }, { tracked: { pid: 123 }, reachable: false }), 'running');
  assert.strictEqual(resolveStatus({ surface: 'desktop' }, { tracked: null }), 'stopped');
  assert.strictEqual(resolveStatus({ surface: 'desktop' }, { tracked: { pid: null } }), 'stopped');
});

test('job status reflects the last run', () => {
  assert.strictEqual(jobStatus(null), 'idle');
  assert.strictEqual(jobStatus({ pid: 42 }), 'running');
  assert.strictEqual(jobStatus({ pid: null, lastExitCode: 0 }), 'succeeded');
  assert.strictEqual(jobStatus({ pid: null, lastExitCode: 1 }), 'failed');
  assert.strictEqual(resolveStatus({ surface: 'job' }, { tracked: { pid: null, lastExitCode: 2 } }), 'failed');
});

test('SURFACES is the closed vocabulary', () => {
  assert.deepStrictEqual(SURFACES, ['web', 'server', 'desktop', 'cli', 'job']);
});
