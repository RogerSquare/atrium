// Pure seams of the per-file PR patch feature (feat-files-pr-diff-001).

const test = require('node:test');
const assert = require('node:assert');

const { findPrFile } = require('./github');

const FILES = [
  { filename: 'backend/server.js', previous_filename: null, status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' },
  { filename: 'frontend/src/App.jsx', previous_filename: 'frontend/src/Old.jsx', status: 'renamed', additions: 0, deletions: 0, patch: null },
  { filename: 'ai-gallery/backend/db.js', previous_filename: null, status: 'modified', additions: 5, deletions: 5, patch: '@@' },
];

test('findPrFile: exact filename wins', () => {
  assert.strictEqual(findPrFile(FILES, 'backend/server.js').status, 'modified');
});

test('findPrFile: renames match by their previous filename too', () => {
  assert.strictEqual(findPrFile(FILES, 'frontend/src/Old.jsx').filename, 'frontend/src/App.jsx');
});

test('findPrFile: suffix match rescues pre-rename layouts', () => {
  // The tree path is 'backend/db.js' but the OLD PR recorded 'ai-gallery/backend/db.js'.
  assert.strictEqual(findPrFile(FILES, 'backend/db.js').filename, 'ai-gallery/backend/db.js');
});

test('findPrFile: misses and bad input return null', () => {
  assert.strictEqual(findPrFile(FILES, 'nope.js'), null);
  assert.strictEqual(findPrFile(FILES, ''), null);
  assert.strictEqual(findPrFile(null, 'backend/server.js'), null);
});

test('paginated gh api output normalizes into one array', () => {
  // The same `][` seam-join getPrFiles applies before JSON.parse.
  const concatenated = '[{"a":1}]\n[{"a":2}]';
  const parsed = JSON.parse(concatenated.trim().replace(/\]\s*\[/g, ','));
  assert.deepStrictEqual(parsed, [{ a: 1 }, { a: 2 }]);
});
