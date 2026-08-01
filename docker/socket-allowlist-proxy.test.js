// Policy tests for the Docker socket allow-list proxy
// (feat-services-containers-001 + devops-runner-proxy-jobs-001).
//
// decide() and validateCreateBody() take their config as arguments, so the
// entire security matrix runs without a Docker daemon or a listening server.

const test = require('node:test');
const assert = require('node:assert');
const { decide, validateCreateBody, isPathUnder } = require('./socket-allowlist-proxy');

const OFF = { runnerImages: [], allowedContainers: [] };
const ON = { runnerImages: ['swift:6', 'node:22'], allowedContainers: [] };

// --- original service shapes (regression: unchanged) -----------------------

test('the six original service shapes stay allowed', () => {
  for (const [method, url] of [
    ['GET', '/_ping'],
    ['GET', '/containers/atrium-backend/json'],
    ['GET', '/containers/atrium-backend/logs?stdout=1'],
    ['POST', '/containers/atrium-backend/start'],
    ['POST', '/containers/atrium-backend/stop'],
    ['POST', '/v1.43/containers/atrium-backend/restart'],
  ]) {
    assert.strictEqual(decide(method, url, OFF).allowed, true, `${method} ${url}`);
  }
});

test('exec, image pull, build, and info stay denied in every mode', () => {
  for (const cfg of [OFF, ON]) {
    assert.strictEqual(decide('POST', '/containers/x/exec', cfg).allowed, false);
    assert.strictEqual(decide('POST', '/images/create?fromImage=evil', cfg).allowed, false);
    assert.strictEqual(decide('POST', '/build', cfg).allowed, false);
    assert.strictEqual(decide('GET', '/info', cfg).allowed, false);
    assert.strictEqual(decide('DELETE', '/containers/atrium-backend', cfg).allowed, false, 'remove outside job namespace');
  }
});

test('path traversal and unparseable urls are denied', () => {
  assert.strictEqual(decide('GET', '/containers/../secrets/json', ON).allowed, false);
  assert.strictEqual(decide('GET', 'http://[bad', ON).allowed, false);
});

// --- job capability gating -------------------------------------------------

test('job shapes are OFF when ATRIUM_RUNNER_IMAGES is empty — not "any image"', () => {
  assert.strictEqual(decide('POST', '/containers/create?name=atrium-job-x', OFF).allowed, false);
  assert.strictEqual(decide('POST', '/containers/atrium-job-x/wait', OFF).allowed, false);
  assert.strictEqual(decide('DELETE', '/containers/atrium-job-x', OFF).allowed, false);
});

test('create requires a name in the atrium-job-* namespace', () => {
  const ok = decide('POST', '/containers/create?name=atrium-job-swift-1', ON);
  assert.strictEqual(ok.allowed, true);
  assert.strictEqual(ok.kind, 'create-job');
  assert.strictEqual(ok.jobName, 'atrium-job-swift-1');

  assert.strictEqual(decide('POST', '/containers/create', ON).allowed, false, 'unnamed create');
  assert.strictEqual(decide('POST', '/containers/create?name=innocent', ON).allowed, false, 'outside namespace');
  assert.strictEqual(decide('POST', '/containers/create?name=atrium-job-', ON).allowed, false, 'empty suffix');
});

test('job verbs allow only the atrium-job-* namespace (with version prefix too)', () => {
  assert.strictEqual(decide('POST', '/containers/atrium-job-x/wait', ON).allowed, true);
  assert.strictEqual(decide('DELETE', '/v1.43/containers/atrium-job-x', ON).allowed, true);
  assert.strictEqual(decide('GET', '/containers/atrium-job-x/logs?follow=0', ON).allowed, true);
  assert.strictEqual(decide('POST', '/containers/other/wait', ON).allowed, false);
  assert.strictEqual(decide('DELETE', '/containers/other', ON).allowed, false);
});

test('ALLOWED_CONTAINERS still fences service verbs, but not the job namespace while jobs are on', () => {
  const fenced = { runnerImages: ['swift:6'], allowedContainers: ['artifex'] };
  assert.strictEqual(decide('POST', '/containers/artifex/stop', fenced).allowed, true);
  assert.strictEqual(decide('POST', '/containers/other/stop', fenced).allowed, false);
  // Job containers get their verbs despite not being listed…
  assert.strictEqual(decide('POST', '/containers/atrium-job-x/start', fenced).allowed, true);
  assert.strictEqual(decide('GET', '/containers/atrium-job-x/json', fenced).allowed, true);
  // …but ONLY while the capability is on.
  const fencedOff = { runnerImages: [], allowedContainers: ['artifex'] };
  assert.strictEqual(decide('POST', '/containers/atrium-job-x/start', fencedOff).allowed, false);
});

// --- create body policy ----------------------------------------------------

const IMAGES = { images: ['swift:6'], workspace: '/workspace' };

test('image must be on the allow-list (exact match)', () => {
  assert.strictEqual(validateCreateBody({ Image: 'swift:6' }, IMAGES).ok, true);
  assert.match(validateCreateBody({ Image: 'swift:latest' }, IMAGES).reason, /not in ATRIUM_RUNNER_IMAGES/);
  assert.match(validateCreateBody({ Image: 'evil/root' }, IMAGES).reason, /not in ATRIUM_RUNNER_IMAGES/);
  assert.match(validateCreateBody({}, IMAGES).reason, /not in ATRIUM_RUNNER_IMAGES/);
  assert.strictEqual(validateCreateBody(null, IMAGES).ok, false);
});

test('privilege escalation vectors are refused', () => {
  const base = { Image: 'swift:6' };
  assert.match(validateCreateBody({ ...base, HostConfig: { Privileged: true } }, IMAGES).reason, /privileged/);
  assert.match(validateCreateBody({ ...base, HostConfig: { CapAdd: ['SYS_ADMIN'] } }, IMAGES).reason, /CapAdd/);
  assert.match(validateCreateBody({ ...base, HostConfig: { Devices: [{ PathOnHost: '/dev/sda' }] } }, IMAGES).reason, /Devices/);
  assert.match(validateCreateBody({ ...base, HostConfig: { SecurityOpt: ['seccomp=unconfined'] } }, IMAGES).reason, /SecurityOpt/);
  assert.match(validateCreateBody({ ...base, HostConfig: { PidMode: 'host' } }, IMAGES).reason, /PidMode/);
  assert.match(validateCreateBody({ ...base, HostConfig: { UsernsMode: 'host' } }, IMAGES).reason, /UsernsMode/);
  assert.match(validateCreateBody({ ...base, HostConfig: { NetworkMode: 'host' } }, IMAGES).reason, /NetworkMode/);
  assert.match(validateCreateBody({ ...base, HostConfig: { PortBindings: { '80/tcp': [{}] } } }, IMAGES).reason, /PortBindings/);
});

test('benign host config passes', () => {
  const body = {
    Image: 'swift:6',
    Cmd: ['swift', 'test'],
    WorkingDir: '/src',
    HostConfig: { NetworkMode: 'bridge', AutoRemove: false, Memory: 2147483648 },
  };
  assert.strictEqual(validateCreateBody(body, IMAGES).ok, true);
});

test('binds: read-only under the workspace only', () => {
  const base = { Image: 'swift:6' };
  const bind = (b) => validateCreateBody({ ...base, HostConfig: { Binds: [b] } }, IMAGES);
  assert.strictEqual(bind('/workspace/proj:/src:ro').ok, true);
  assert.strictEqual(bind('/workspace:/src:ro').ok, true, 'workspace root itself');
  assert.match(bind('/workspace/proj:/src:rw').reason, /read-only/);
  assert.match(bind('/workspace/proj:/src').reason, /read-only/, 'no mode defaults to rw');
  assert.match(bind('/etc:/src:ro').reason, /outside ATRIUM_RUNNER_WORKSPACE/);
  assert.match(bind('/workspace2/proj:/src:ro').reason, /outside/, 'sibling prefix must not pass');
  assert.match(bind('/workspace/../etc:/src:ro').reason, /outside/);
  assert.match(bind('somevolume:/src:ro').reason, /outside/, 'named volumes via Binds');
});

test('windows-style host paths in binds parse mode and drive correctly', () => {
  const cfg = { images: ['swift:6'], workspace: 'C:/work' };
  const bind = (b) => validateCreateBody({ Image: 'swift:6', HostConfig: { Binds: [b] } }, cfg);
  assert.strictEqual(bind('C:/work/proj:/src:ro').ok, true);
  assert.strictEqual(bind('C:\\work\\proj:/src:ro').ok, true);
  assert.match(bind('D:/other:/src:ro').reason, /outside/);
});

test('binds are refused entirely when no workspace is declared', () => {
  const cfg = { images: ['swift:6'], workspace: '' };
  const r = validateCreateBody({ Image: 'swift:6', HostConfig: { Binds: ['/anything:/src:ro'] } }, cfg);
  assert.match(r.reason, /ATRIUM_RUNNER_WORKSPACE is not set/);
});

test('mounts API: bind + ReadOnly + workspace only', () => {
  const base = { Image: 'swift:6' };
  const mount = (m) => validateCreateBody({ ...base, HostConfig: { Mounts: [m] } }, IMAGES);
  assert.strictEqual(mount({ Type: 'bind', Source: '/workspace/p', Target: '/src', ReadOnly: true }).ok, true);
  assert.match(mount({ Type: 'volume', Source: 'v', Target: '/src', ReadOnly: true }).reason, /bind only/);
  assert.match(mount({ Type: 'bind', Source: '/workspace/p', Target: '/src' }).reason, /ReadOnly/);
  assert.match(mount({ Type: 'bind', Source: '/etc', Target: '/src', ReadOnly: true }).reason, /outside/);
});

// --- isPathUnder -----------------------------------------------------------

test('isPathUnder: containment, not prefix-string matching', () => {
  assert.strictEqual(isPathUnder('/w/proj', '/w/proj'), true);
  assert.strictEqual(isPathUnder('/w/proj', '/w/proj/sub/x'), true);
  assert.strictEqual(isPathUnder('/w/proj', '/w/proj2'), false);
  assert.strictEqual(isPathUnder('/w/proj', '/w'), false);
  assert.strictEqual(isPathUnder('/w/proj', '/w/proj/../other'), false);
  assert.strictEqual(isPathUnder('', '/w'), false);
  assert.strictEqual(isPathUnder('/w', ''), false);
});

test('isPathUnder: separators and case normalize (Docker Desktop host paths)', () => {
  assert.strictEqual(isPathUnder('C:/Work', 'c:/work/proj'), true);
  assert.strictEqual(isPathUnder('C:\\Work', 'C:\\Work\\proj'), true);
  assert.strictEqual(isPathUnder('C:/Work/', 'C:/Work/proj'), true, 'trailing slash on root');
});
