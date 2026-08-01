// Unit tests for runner orchestration (feat-runners-core-001): status
// derivation, glob matching, suite selection, artifact collection, config
// resolution, and CLI arg parsing. Disk-touching pieces use a scratch dir
// under the OS tmpdir, cleaned per test.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_SUITE, deriveStatus, globToRegExp, pickSuite, collectArtifacts, resolveSuites, parseArgs,
} = require('./index');

// --- deriveStatus ---------------------------------------------------------

test('deriveStatus: green run → passing, any failure → failing, empty → skipped', () => {
  assert.strictEqual(deriveStatus({ total: 3, failed: 0 }), 'passing');
  assert.strictEqual(deriveStatus({ total: 3, failed: 1 }), 'failing');
  assert.strictEqual(deriveStatus({ total: 0, failed: 0 }), 'skipped');
});

// --- globToRegExp ---------------------------------------------------------

test('glob: * stays within a path segment', () => {
  const re = globToRegExp('reports/*.xml');
  assert.ok(re.test('reports/junit.xml'));
  assert.ok(!re.test('reports/sub/junit.xml'));
});

test('glob: ** crosses directories (including zero)', () => {
  const re = globToRegExp('build/**/*.log');
  assert.ok(re.test('build/a/b/x.log'));
  assert.ok(re.test('build/x.log'));
  assert.ok(!re.test('dist/x.log'));
});

test('glob: literal dots do not become wildcards', () => {
  const re = globToRegExp('junit.xml');
  assert.ok(re.test('junit.xml'));
  assert.ok(!re.test('junitXxml'));
});

// --- pickSuite ------------------------------------------------------------

const SUITES = [{ id: 'one' }, { id: 'two' }];

test('pickSuite defaults to the first suite', () => {
  assert.strictEqual(pickSuite(SUITES).suite.id, 'one');
});

test('pickSuite finds by id and reports unknown ids with the available list', () => {
  assert.strictEqual(pickSuite(SUITES, 'two').suite.id, 'two');
  const { error } = pickSuite(SUITES, 'ghost');
  assert.match(error, /Unknown suite "ghost"/);
  assert.match(error, /one, two/);
});

// --- collectArtifacts (scratch dir) ---------------------------------------

function scratch(structure) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-runners-'));
  for (const [rel, content] of Object.entries(structure)) {
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test('collectArtifacts gathers the report plus glob matches, deduped', (t) => {
  const cwd = scratch({
    'junit.xml': '<x/>',
    'logs/run.log': 'l',
    'logs/deep/more.log': 'm',
    'src/ignore.js': 'i',
  });
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const files = collectArtifacts({ cwd, reportPath: 'junit.xml', globs: ['junit.xml', 'logs/**/*.log'] });
  const rels = files.map((f) => f.rel).sort();
  assert.deepStrictEqual(rels, ['junit.xml', 'logs/deep/more.log', 'logs/run.log']);
});

test('collectArtifacts with no report and no globs returns nothing', (t) => {
  const cwd = scratch({ 'a.txt': 'x' });
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  assert.deepStrictEqual(collectArtifacts({ cwd, reportPath: null, globs: [] }), []);
});

// --- resolveSuites (scratch dir) ------------------------------------------

test('explicit projectDir without a config falls back to the built-in default suite', async (t) => {
  const dir = scratch({});
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { suites, configPath } = await resolveSuites({ api: { token: null }, taskId: 't', projectDir: dir, log: () => {} });
  assert.strictEqual(configPath, null);
  assert.strictEqual(suites.length, 1);
  assert.strictEqual(suites[0].id, DEFAULT_SUITE.id);
  assert.strictEqual(suites[0].report, 'playwright-json');
});

test('atrium.tests.json in projectDir is loaded and suite cwds are absolutized', async (t) => {
  const dir = scratch({
    'atrium.tests.json': JSON.stringify({
      suites: [{ id: 'unit', runner: 'command', command: 'make test', cwd: 'sub', report: 'exit-code' }],
    }),
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { suites, configPath } = await resolveSuites({ api: { token: null }, taskId: 't', projectDir: dir, log: () => {} });
  assert.strictEqual(configPath, path.join(dir, 'atrium.tests.json'));
  assert.strictEqual(suites[0].id, 'unit');
  assert.strictEqual(suites[0].cwd, path.resolve(dir, 'sub'));
});

test('an invalid config throws rather than silently running the default', async (t) => {
  const dir = scratch({ 'atrium.tests.json': '{"suites":[{"runner":"command"}]}' });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await assert.rejects(
    resolveSuites({ api: { token: null }, taskId: 't', projectDir: dir, log: () => {} }),
    /Invalid atrium\.tests\.json/
  );
});

// --- parseArgs ------------------------------------------------------------

test('parseArgs reads all five flags', () => {
  const args = parseArgs(['--task', 'feat-x-001', '--suite', 'unit', '--project', 'Lumeo', '--project-dir', '/p', '--filter', 'login']);
  assert.deepStrictEqual(args, { task: 'feat-x-001', suite: 'unit', project: 'Lumeo', projectDir: '/p', filter: 'login' });
});

test('parseArgs: old two-flag invocation still parses (back-compat)', () => {
  assert.deepStrictEqual(parseArgs(['--task', 't-1', '--filter', 'x']), { task: 't-1', filter: 'x' });
});
