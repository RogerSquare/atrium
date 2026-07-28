// Unit tests for backend/lib/shellDefaults.js (devops-docker-shell-portable-001).
//
// Platform is injected rather than read from process.platform, so the Linux
// behaviour is actually exercised while running on Windows. That is the whole
// value of these tests: the container is the target and we cannot boot it here.

const test = require('node:test');
const assert = require('node:assert');

const {
  resolveDefaultShell,
  buildShellCommandArgs,
  resolveShellCwd,
} = require('./shellDefaults');

// --- resolveDefaultShell -------------------------------------------------

test('Windows keeps cmd.exe — the native run must not change', () => {
  assert.strictEqual(resolveDefaultShell({ env: {}, platform: 'win32' }), 'cmd.exe');
});

test('Linux gets bash instead of a Windows binary that does not exist', () => {
  assert.strictEqual(resolveDefaultShell({ env: {}, platform: 'linux' }), '/bin/bash');
  assert.strictEqual(resolveDefaultShell({ env: {}, platform: 'darwin' }), '/bin/bash');
});

test('ATRIUM_SHELL overrides on either platform', () => {
  assert.strictEqual(resolveDefaultShell({ env: { ATRIUM_SHELL: '/usr/bin/zsh' }, platform: 'linux' }), '/usr/bin/zsh');
  assert.strictEqual(resolveDefaultShell({ env: { ATRIUM_SHELL: 'pwsh.exe' }, platform: 'win32' }), 'pwsh.exe');
});

test('the pre-existing WEB_SHELL_DEFAULT_SHELL still works', () => {
  assert.strictEqual(
    resolveDefaultShell({ env: { WEB_SHELL_DEFAULT_SHELL: 'powershell.exe' }, platform: 'win32' }),
    'powershell.exe',
  );
});

test('ATRIUM_SHELL wins over the older variable when both are set', () => {
  const env = { ATRIUM_SHELL: '/bin/zsh', WEB_SHELL_DEFAULT_SHELL: 'cmd.exe' };
  assert.strictEqual(resolveDefaultShell({ env, platform: 'linux' }), '/bin/zsh');
});

test('a blank override does not win', () => {
  assert.strictEqual(resolveDefaultShell({ env: { ATRIUM_SHELL: '   ' }, platform: 'linux' }), '/bin/bash');
});

// --- buildShellCommandArgs -----------------------------------------------

test('an arbitrary command string runs through the platform shell', () => {
  const win = buildShellCommandArgs('npm run dev', { platform: 'win32' });
  assert.deepStrictEqual(win, { cmd: 'cmd.exe', args: ['/c', 'npm run dev'] });

  const nix = buildShellCommandArgs('npm run dev', { platform: 'linux' });
  assert.deepStrictEqual(nix, { cmd: '/bin/sh', args: ['-c', 'npm run dev'] });
});

test('the command stays a single trailing argument, so quoting is not mangled', () => {
  const cmd = 'git commit -m "a message with spaces"';
  for (const platform of ['win32', 'linux']) {
    const r = buildShellCommandArgs(cmd, { platform });
    assert.strictEqual(r.args[r.args.length - 1], cmd, `${platform} must not split the command`);
    assert.strictEqual(r.args.length, 2);
  }
});

// --- resolveShellCwd -----------------------------------------------------

test('an explicit cwd from the client wins', () => {
  assert.strictEqual(resolveShellCwd('/workspace/atrium', { homedir: '/home/node' }), '/workspace/atrium');
});

test('falls back to the home directory, not a Windows path', () => {
  assert.strictEqual(resolveShellCwd(undefined, { homedir: '/home/node' }), '/home/node');
  assert.strictEqual(resolveShellCwd(null, { homedir: '/home/node' }), '/home/node');
  assert.strictEqual(resolveShellCwd('', { homedir: '/home/node' }), '/home/node');
  assert.strictEqual(resolveShellCwd('   ', { homedir: '/home/node' }), '/home/node');
});
