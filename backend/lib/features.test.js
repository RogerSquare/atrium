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
  assert.deepStrictEqual(featureSnapshot({}), { services: true });
  assert.deepStrictEqual(featureSnapshot({ ATRIUM_FEATURE_SERVICES: 'off' }), { services: false });
});
