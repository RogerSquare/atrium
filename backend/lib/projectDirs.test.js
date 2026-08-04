// Unit tests for lib/projectDirs.js (feat-project-hub-impl-001).
//
// Two halves: the project→directory resolution rules, and the filesystem
// jail (traversal + symlink escape). The jail tests use real temp dirs —
// junction links on Windows need no elevation, so the symlink-escape case
// runs everywhere.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeSlug, resolveProjectDir, containedRealPath, IGNORED_NAMES } = require('./projectDirs');

const WD = 'C:\\ws';
const DIRS = ['atrium', 'gh-collab-manager', 'atrium2', 'SDH-GameThemeMusic'];
const fakeFs = (existingDirs = []) => ({
  statSync: (p) => {
    if (existingDirs.includes(p)) return { isDirectory: () => true };
    throw new Error('ENOENT');
  },
});

test('normalizeSlug strips spaces, hyphens, underscores and lowers', () => {
  assert.strictEqual(normalizeSlug('Atrium 2'), 'atrium2');
  assert.strictEqual(normalizeSlug('GitHub Collab Manager'), 'githubcollabmanager');
  assert.strictEqual(normalizeSlug('SDH-GameThemeMusic'), 'sdhgamethememusic');
});

test('an explicit directory field always wins, relative or absolute', () => {
  const rel = resolveProjectDir({ name: 'X', directory: 'atrium' }, WD, DIRS, fakeFs([path.join(WD, 'atrium')]));
  assert.deepStrictEqual(rel, { root: path.join(WD, 'atrium'), source: 'directory-field' });

  // Platform-native absolute path — a hardcoded D:\ literal is not absolute
  // under Linux's path.isAbsolute and fails in CI.
  const ABS = path.resolve(path.sep, 'elsewhere', 'proj');
  const abs = resolveProjectDir({ name: 'X', directory: ABS }, WD, DIRS, fakeFs([ABS]));
  assert.deepStrictEqual(abs, { root: ABS, source: 'directory-field' });
});

test('a directory field pointing nowhere resolves to unlinked, not a guess', () => {
  const out = resolveProjectDir({ name: 'Atrium', directory: 'gone' }, WD, DIRS, fakeFs([]));
  assert.deepStrictEqual(out, { root: null, source: null });
});

test('exact case-insensitive folder match', () => {
  const out = resolveProjectDir({ name: 'Atrium', folder: 'Atrium' }, WD, DIRS)
  assert.deepStrictEqual(out, { root: path.join(WD, 'atrium'), source: 'name-match' });
});

test('normalized matches: the real-world misses become hits', () => {
  assert.strictEqual(resolveProjectDir({ folder: 'Atrium 2' }, WD, DIRS).root, path.join(WD, 'atrium2'));
  // 'GitHub Collab Manager' → githubcollabmanager vs gh-collab-manager → ghcollabmanager: NOT equal.
  // The field exists for exactly this case — assert the heuristic honestly misses.
  assert.strictEqual(resolveProjectDir({ folder: 'GitHub Collab Manager' }, WD, DIRS).root, null);
});

test('no match resolves to unlinked', () => {
  assert.deepStrictEqual(resolveProjectDir({ folder: 'RemotePilot' }, WD, DIRS), { root: null, source: null });
});

test('IGNORED_NAMES covers the heavyweights', () => {
  for (const n of ['.git', 'node_modules', 'target', 'dist']) assert.ok(IGNORED_NAMES.has(n));
});

// --- the jail --------------------------------------------------------------

test('containedRealPath allows inside, refuses traversal out', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jail-'));
  fs.writeFileSync(path.join(root, 'ok.txt'), 'hi');

  assert.ok(containedRealPath(root, 'ok.txt').endsWith('ok.txt'));
  assert.strictEqual(containedRealPath(root, '..'), null);
  assert.strictEqual(containedRealPath(root, '../../etc/passwd'), null);
  assert.strictEqual(containedRealPath(root, 'nope.txt'), null); // nonexistent → null → 404
});

test('a link inside the jail pointing outside is refused', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'leak');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jail-'));
  // Junction: directory link that needs no elevation on Windows.
  fs.symlinkSync(outside, path.join(root, 'escape'), 'junction');

  assert.strictEqual(containedRealPath(root, 'escape'), null);
  assert.strictEqual(containedRealPath(root, path.join('escape', 'secret.txt')), null);
});
