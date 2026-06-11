// Unit tests for backend/lib/claudeBin.js (opt-webshell-claude-path-001).
// Pure tests — all I/O (env, settings, filesystem, PATH lookup) is injected,
// so nothing here touches the real machine or spawns a process.

const test = require('node:test');
const assert = require('node:assert');

function requireFresh() {
  const p = require.resolve('./claudeBin');
  delete require.cache[p];
  return require('./claudeBin');
}

const HOME = '/home/u';
const KNOWN = require('path').join(HOME, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');

// --- resolveClaudeBin precedence ----------------------------------------

test('env override wins over everything and is honored verbatim', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: { WEB_SHELL_CLAUDE_BIN: '/opt/custom/claude' },
    settings: { claudeBin: '/from/settings/claude' },
    homedir: HOME,
    fileExists: () => true,
    pathLookup: () => '/from/path/claude',
  });
  assert.strictEqual(r.bin, '/opt/custom/claude');
  assert.strictEqual(r.source, 'env');
});

test('env override is used even when the file is missing (existence reported, not gated)', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: { WEB_SHELL_CLAUDE_BIN: '/typo/claude' },
    fileExists: () => false,
    pathLookup: () => '/from/path/claude',
  });
  assert.strictEqual(r.bin, '/typo/claude');
  assert.strictEqual(r.source, 'env');
  assert.strictEqual(r.exists, false);
});

test('settings.claudeBin used when no env override', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: {},
    settings: { claudeBin: '/from/settings/claude' },
    homedir: HOME,
    fileExists: () => true,
    pathLookup: () => '/from/path/claude',
  });
  assert.strictEqual(r.bin, '/from/settings/claude');
  assert.strictEqual(r.source, 'settings');
});

test('known native-install location used when it exists and no overrides', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: {},
    settings: {},
    homedir: HOME,
    fileExists: (p) => p === KNOWN,
    pathLookup: () => '/from/path/claude',
  });
  assert.strictEqual(r.bin, KNOWN);
  assert.strictEqual(r.source, 'known-location');
  assert.strictEqual(r.exists, true);
});

test('falls back to PATH lookup when known location is absent', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: {},
    settings: {},
    homedir: HOME,
    fileExists: () => false,
    pathLookup: () => '/usr/local/bin/claude',
  });
  assert.strictEqual(r.bin, '/usr/local/bin/claude');
  assert.strictEqual(r.source, 'path');
});

test('bare-fallback when nothing resolves', () => {
  const { resolveClaudeBin } = requireFresh();
  const r = resolveClaudeBin({
    env: {},
    settings: {},
    homedir: HOME,
    fileExists: () => false,
    pathLookup: () => null,
  });
  assert.strictEqual(r.bin, 'claude');
  assert.strictEqual(r.source, 'bare-fallback');
});

test('platform selects claude.exe vs claude for the known location', () => {
  const { resolveClaudeBin } = requireFresh();
  const path = require('path');
  const win = resolveClaudeBin({ env: {}, settings: {}, platform: 'win32', homedir: HOME, fileExists: () => true, pathLookup: () => null });
  const nix = resolveClaudeBin({ env: {}, settings: {}, platform: 'linux', homedir: HOME, fileExists: () => true, pathLookup: () => null });
  assert.strictEqual(win.bin, path.join(HOME, '.local', 'bin', 'claude.exe'));
  assert.strictEqual(nix.bin, path.join(HOME, '.local', 'bin', 'claude'));
});

// --- buildClaudeArgs decision -------------------------------------------

test('no sessionId -> bare args', () => {
  const { buildClaudeArgs } = requireFresh();
  const r = buildClaudeArgs('C:\\cwd', null, true, { fileExists: () => true });
  assert.deepStrictEqual(r.args, []);
  assert.strictEqual(r.decision, 'bare');
});

test('tryResume + session file exists -> --resume', () => {
  const { buildClaudeArgs } = requireFresh();
  const r = buildClaudeArgs('C:\\cwd', 'uuid-1', true, { fileExists: () => true, homedir: HOME });
  assert.deepStrictEqual(r.args, ['--resume', 'uuid-1']);
  assert.strictEqual(r.decision, '--resume');
  assert.strictEqual(r.sessionFileExists, true);
});

test('tryResume but session file missing -> --session-id (no "No conversation found")', () => {
  const { buildClaudeArgs } = requireFresh();
  const r = buildClaudeArgs('C:\\cwd', 'uuid-2', true, { fileExists: () => false, homedir: HOME });
  assert.deepStrictEqual(r.args, ['--session-id', 'uuid-2']);
  assert.strictEqual(r.decision, '--session-id');
});

test('no tryResume -> --session-id even if file exists', () => {
  const { buildClaudeArgs } = requireFresh();
  const r = buildClaudeArgs('C:\\cwd', 'uuid-3', false, { fileExists: () => true, homedir: HOME });
  assert.deepStrictEqual(r.args, ['--session-id', 'uuid-3']);
});

test('args are clean tokens (no embedded spaces/quotes) so direct spawn needs no cmd.exe quoting', () => {
  const { buildClaudeArgs } = requireFresh();
  const r = buildClaudeArgs('C:\\Users\\Roger Square\\cwd', 'uuid-4', true, { fileExists: () => true, homedir: HOME });
  for (const a of r.args) {
    assert.ok(!/[\s"]/.test(a), `arg "${a}" must not contain whitespace or quotes`);
  }
});

// --- slug helper --------------------------------------------------------

test('claudeSlugForCwd replaces separators and colon with dashes', () => {
  const { claudeSlugForCwd } = requireFresh();
  assert.strictEqual(
    claudeSlugForCwd('C:\\Users\\RogerSquare\\Documents\\opencode'),
    'C--Users-RogerSquare-Documents-opencode'
  );
});
