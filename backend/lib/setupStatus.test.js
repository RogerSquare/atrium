// Unit tests for backend/lib/setupStatus.js (feat-first-run-setup-001).
//
// The property that matters most: a step is NEVER reported complete on a
// failed or unreadable check. A false green tick is worse than no wizard at
// all, because it sends the user looking for the problem somewhere else.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  claudeConfigPath,
  readClaudeAccount,
  buildSetupSteps,
  isSetupComplete,
} = require('./setupStatus');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-setup-'));
const writeJson = (name, value) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
};

// --- claudeConfigPath ----------------------------------------------------

// Account state lives in ~/.claude.json, NOT inside ~/.claude — the detail
// that made container login appear not to persist until it got its own mount.
test('looks for account state beside the .claude directory, not inside it', () => {
  const p = claudeConfigPath({}, '/home/node');
  assert.strictEqual(p, path.join('/home/node', '.claude.json'));
});

test('honours CLAUDE_CONFIG_PATH when set', () => {
  assert.strictEqual(claudeConfigPath({ CLAUDE_CONFIG_PATH: '/custom/c.json' }, '/home/node'), '/custom/c.json');
});

// --- readClaudeAccount ---------------------------------------------------

test('reads the signed-in account', () => {
  const p = writeJson('logged-in.json', {
    oauthAccount: { emailAddress: 'user@example.com', displayName: 'Test User' },
  });
  assert.deepStrictEqual(readClaudeAccount(p), {
    logged_in: true,
    email: 'user@example.com',
    display_name: 'Test User',
  });
});

test('a missing file is signed out, not an error', () => {
  const result = readClaudeAccount(path.join(tmp, 'does-not-exist.json'));
  assert.strictEqual(result.logged_in, false);
});

// The container wrote a 975-byte stub with no oauthAccount while the host file
// was 52,787 bytes. Present-but-accountless must read as signed out.
test('a config with no oauthAccount is signed out', () => {
  const p = writeJson('stub.json', { numStartups: 1, hasCompletedOnboarding: true });
  assert.strictEqual(readClaudeAccount(p).logged_in, false);
});

test('an oauthAccount with no email is signed out', () => {
  const p = writeJson('no-email.json', { oauthAccount: { displayName: 'Nobody' } });
  assert.strictEqual(readClaudeAccount(p).logged_in, false);
});

test('corrupt JSON never throws and never reports signed in', () => {
  const p = writeJson('corrupt.json', '{ "oauthAccount": { "emailAddr');
  assert.strictEqual(readClaudeAccount(p).logged_in, false);
});

// --- buildSetupSteps -----------------------------------------------------

const byId = (steps, id) => steps.find((s) => s.id === id);

test('all three steps incomplete on a fresh container', () => {
  const steps = buildSetupSteps({ settings: {}, dirExists: () => false });
  assert.strictEqual(steps.length, 3);
  assert.ok(steps.every((s) => !s.complete));
});

test('workspace completes only when the directory actually exists', () => {
  const present = buildSetupSteps({ settings: { workingDirectory: '/workspace' }, dirExists: () => true });
  assert.strictEqual(byId(present, 'workspace').complete, true);
  assert.strictEqual(byId(present, 'workspace').detail, '/workspace');
});

// A typo'd path looks identical to an unset one from the board, so the
// set-but-missing case gets its own message rather than a silent incomplete.
test('a set-but-missing working directory is called out explicitly', () => {
  const steps = buildSetupSteps({ settings: { workingDirectory: '/typo' }, dirExists: () => false });
  const ws = byId(steps, 'workspace');
  assert.strictEqual(ws.complete, false);
  assert.match(ws.detail, /not found/);
  assert.match(ws.problem, /does not exist/);
});

test('an unset working directory reports no spurious problem', () => {
  const ws = byId(buildSetupSteps({ settings: {}, dirExists: () => false }), 'workspace');
  assert.strictEqual(ws.detail, null);
  assert.strictEqual(ws.problem, null);
});

test('github step reflects connection and names the account', () => {
  const steps = buildSetupSteps({ githubConnected: true, githubLogin: 'RogerSquare', dirExists: () => true });
  const gh = byId(steps, 'github');
  assert.strictEqual(gh.complete, true);
  assert.match(gh.detail, /RogerSquare/);
});

test('terminal step reflects the Claude Code login', () => {
  const steps = buildSetupSteps({
    claudeAccount: { logged_in: true, email: 'user@example.com' },
    dirExists: () => true,
  });
  const term = byId(steps, 'terminal');
  assert.strictEqual(term.complete, true);
  assert.match(term.detail, /user@example.com/);
});

// --- isSetupComplete -----------------------------------------------------

test('incomplete while a required step is outstanding', () => {
  const steps = buildSetupSteps({ settings: {}, dirExists: () => false });
  assert.strictEqual(isSetupComplete(steps, {}), false);
});

// GitHub is genuinely optional — branch history works without it, so it must
// not hold the wizard open forever.
test('the optional GitHub step does not block completion', () => {
  const steps = buildSetupSteps({
    settings: { workingDirectory: '/workspace' },
    claudeAccount: { logged_in: true, email: 'u@e.com' },
    githubConnected: false,
    dirExists: () => true,
  });
  assert.strictEqual(byId(steps, 'github').complete, false);
  assert.strictEqual(isSetupComplete(steps, {}), true);
});

test('an explicit dismissal is remembered even with steps outstanding', () => {
  const steps = buildSetupSteps({ settings: {}, dirExists: () => false });
  assert.strictEqual(isSetupComplete(steps, { setup_completed_at: '2026-07-29T00:00:00Z' }), true);
});
