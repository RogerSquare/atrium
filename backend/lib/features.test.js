// Unit tests for backend/lib/features.js (devops-docker-flags-001).
//
// The load-bearing property is FAIL-SAFE: anything other than a recognised
// off value must leave the feature ON, so a typo in a compose file never
// silently removes a working feature from a native install.

const test = require('node:test');
const assert = require('node:assert');

const { isEnabled, servicesEnabled, featureSnapshot } = require('./features');

test('features default ON when the variable is unset', () => {
  assert.strictEqual(servicesEnabled({}), true);
  assert.strictEqual(isEnabled('ANYTHING', {}), true);
});

test('recognised off values disable the feature', () => {
  for (const v of ['0', 'false', 'off', 'no', 'disabled']) {
    assert.strictEqual(servicesEnabled({ ATRIUM_FEATURE_SERVICES: v }), false, `"${v}" should disable`);
  }
});

test('off values are case and whitespace insensitive', () => {
  for (const v of ['OFF', 'False', '  off  ', 'No']) {
    assert.strictEqual(servicesEnabled({ ATRIUM_FEATURE_SERVICES: v }), false, `"${v}" should disable`);
  }
});

test('a typo fails SAFE — the feature stays on rather than silently vanishing', () => {
  for (const v of ['offf', 'flase', 'disable', 'nope', 'ff']) {
    assert.strictEqual(servicesEnabled({ ATRIUM_FEATURE_SERVICES: v }), true, `"${v}" must not disable`);
  }
});

test('explicit on values keep it on', () => {
  for (const v of ['1', 'true', 'on', 'yes']) {
    assert.strictEqual(servicesEnabled({ ATRIUM_FEATURE_SERVICES: v }), true);
  }
});

test('an empty string does not disable', () => {
  // An unset-but-declared compose variable arrives as '' — that must not be
  // read as "off", or `ATRIUM_FEATURE_SERVICES=` in an .env kills the feature.
  assert.strictEqual(servicesEnabled({ ATRIUM_FEATURE_SERVICES: '' }), true);
});

test('the snapshot reports each flag', () => {
  // dockerServices is a second, narrower capability: services can be ON while
  // Docker-backed control is unavailable (a native install has no DOCKER_HOST).
  assert.deepStrictEqual(featureSnapshot({}), { services: true, dockerServices: false });
  assert.deepStrictEqual(
    featureSnapshot({ ATRIUM_FEATURE_SERVICES: 'off' }),
    { services: false, dockerServices: false },
  );
  assert.deepStrictEqual(
    featureSnapshot({ DOCKER_HOST: 'http://docker-socket-proxy:2375' }),
    { services: true, dockerServices: true },
  );
});

// --- dockerServicesEnabled (feat-services-containers-001) ----------------

test('docker service control needs BOTH the feature on and a DOCKER_HOST', () => {
  const { dockerServicesEnabled } = require('./features');
  // Container instance wired to the socket proxy — the real enabling case.
  assert.strictEqual(dockerServicesEnabled({ DOCKER_HOST: 'http://docker-socket-proxy:2375' }), true);
  // Native install: feature on, but no Docker API to drive.
  assert.strictEqual(dockerServicesEnabled({}), false);
  // Explicitly disabled beats a configured DOCKER_HOST.
  assert.strictEqual(
    dockerServicesEnabled({ ATRIUM_FEATURE_SERVICES: 'off', DOCKER_HOST: 'http://x:2375' }),
    false,
  );
});
