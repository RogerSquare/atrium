// Unit tests for the atrium.tests.json loader/validator (feat-runners-core-001).

const test = require('node:test');
const assert = require('node:assert');
const { parseTarget, parseTestsConfig, resolveProjectDir } = require('./testsConfig');

// --- parseTarget ----------------------------------------------------------

test('target defaults to local (absent, empty, explicit)', () => {
  assert.deepStrictEqual(parseTarget(undefined), { kind: 'local' });
  assert.deepStrictEqual(parseTarget(''), { kind: 'local' });
  assert.deepStrictEqual(parseTarget('local'), { kind: 'local' });
});

test('container and ssh targets parse their ref', () => {
  assert.deepStrictEqual(parseTarget('container:swift:6'), { kind: 'container', ref: 'swift:6' });
  assert.deepStrictEqual(parseTarget('ssh:mac-mini.local'), { kind: 'ssh', ref: 'mac-mini.local' });
});

test('malformed targets are rejected', () => {
  assert.strictEqual(parseTarget('docker:swift'), null);
  assert.strictEqual(parseTarget('container:'), null);
  assert.strictEqual(parseTarget(42), null);
});

// --- parseTestsConfig -----------------------------------------------------

const VALID = {
  suites: [
    { id: 'unit', runner: 'command', command: 'swift test', report: 'junit-xml', reportPath: 'junit.xml' },
    { id: 'e2e', runner: 'playwright', cwd: 'frontend' },
  ],
};

test('valid config parses with defaults applied', () => {
  const { suites } = parseTestsConfig(JSON.stringify(VALID));
  assert.strictEqual(suites.length, 2);
  assert.strictEqual(suites[0].label, 'unit');
  assert.strictEqual(suites[0].cwd, '.');
  assert.deepStrictEqual(suites[0].target, { kind: 'local' });
  // playwright runner implies playwright-json report
  assert.strictEqual(suites[1].report, 'playwright-json');
  assert.strictEqual(suites[1].cwd, 'frontend');
});

test('command runner without report defaults to exit-code', () => {
  const { suites } = parseTestsConfig({ suites: [{ id: 'build', runner: 'command', command: 'make' }] });
  assert.strictEqual(suites[0].report, 'exit-code');
});

test('report playwright-json without runner defaults to playwright', () => {
  const { suites } = parseTestsConfig({ suites: [{ id: 'pw', report: 'playwright-json' }] });
  assert.strictEqual(suites[0].runner, 'playwright');
});

test('invalid JSON text throws with a JSON message', () => {
  assert.throws(() => parseTestsConfig('{nope'), /not valid JSON/);
});

test('missing suites array throws', () => {
  assert.throws(() => parseTestsConfig({}), /"suites" array/);
  assert.throws(() => parseTestsConfig({ suites: 'x' }), /"suites" array/);
});

test('empty suites array throws', () => {
  assert.throws(() => parseTestsConfig({ suites: [] }), /empty/);
});

test('every problem is reported in one pass', () => {
  const bad = {
    suites: [
      { runner: 'command' },                                  // no id, no command
      { id: 'x', runner: 'gradle' },                          // bad runner
      { id: 'y', runner: 'command', command: 'c', report: 'junit-xml' }, // junit without reportPath
      { id: 'y', runner: 'command', command: 'c' },           // duplicate id
      { id: 'z', runner: 'playwright', report: 'exit-code' }, // contradictory pairing
      { id: 'w', runner: 'command', command: 'c', target: 'warp:9' },   // bad target
    ],
  };
  try {
    parseTestsConfig(bad);
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /"id" is required/);
    assert.match(e.message, /"command" is required/);
    assert.match(e.message, /"runner" must be one of/);
    assert.match(e.message, /"reportPath" .* is required/);
    assert.match(e.message, /duplicate id "y"/);
    assert.match(e.message, /implies report "playwright-json"/);
    assert.match(e.message, /"target" must be/);
  }
});

test('suite ids are constrained to letters/digits/hyphens', () => {
  assert.throws(() => parseTestsConfig({ suites: [{ id: 'has space', runner: 'command', command: 'c' }] }), /letters, digits and hyphens/);
});

// --- resolveProjectDir ----------------------------------------------------

const fakeFs = (existing, listing) => ({
  existsSync: (p) => existing.includes(p),
  readdirSync: () => listing,
});

test('exact folder name wins', () => {
  const fs = fakeFs(['C:/work/Lumeo'], ['Lumeo', 'cairn']);
  assert.strictEqual(resolveProjectDir('C:/work', 'Lumeo', fs), 'C:/work/Lumeo');
});

test('case- and separator-insensitive fallback matches', () => {
  const fs = fakeFs([], ['cairn', 'sdh-game-theme-music']);
  assert.strictEqual(resolveProjectDir('C:/work', 'Cairn', fs), 'C:/work/cairn');
  assert.strictEqual(resolveProjectDir('C:/work', 'SDH GameThemeMusic', fs), 'C:/work/sdh-game-theme-music');
});

test('no match / missing inputs → null', () => {
  const fs = fakeFs([], ['other']);
  assert.strictEqual(resolveProjectDir('C:/work', 'Ghost', fs), null);
  assert.strictEqual(resolveProjectDir(null, 'Ghost', fs), null);
  assert.strictEqual(resolveProjectDir('C:/work', '', fs), null);
});

test('backslash working directories join with backslash', () => {
  const fs = fakeFs(['C:\\work\\Lumeo'], []);
  assert.strictEqual(resolveProjectDir('C:\\work', 'Lumeo', fs), 'C:\\work\\Lumeo');
});
