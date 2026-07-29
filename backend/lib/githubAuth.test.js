// Unit tests for backend/lib/githubAuth.js (feat-github-auth-settings-001).
//
// The regression these pin down: in the container `gh` had no credentials, so
// every PR lookup failed. lib/github.js only logs a warning on failure, so the
// Changes view rendered branch badges and simply omitted PR badges — no error,
// no empty state, nothing to indicate the user was signed out.
//
// The redaction tests matter for a different reason: GET /api/settings returns
// the whole settings object to the browser, so a token stored there leaks
// unless it is explicitly stripped on the way out.

const test = require('node:test');
const assert = require('node:assert');

const {
  resolveGithubToken,
  tokenSource,
  buildGhEnv,
  looksLikeToken,
  redactSettings,
  tokenHint,
} = require('./githubAuth');

// --- resolveGithubToken --------------------------------------------------

test('reads the token from settings', () => {
  const token = resolveGithubToken({ settings: { github_token: 'ghp_abc' }, env: {} });
  assert.strictEqual(token, 'ghp_abc');
});

test('falls back to GH_TOKEN, then GITHUB_TOKEN', () => {
  assert.strictEqual(resolveGithubToken({ settings: {}, env: { GH_TOKEN: 'from_gh' } }), 'from_gh');
  assert.strictEqual(
    resolveGithubToken({ settings: {}, env: { GITHUB_TOKEN: 'from_github' } }),
    'from_github'
  );
});

test('settings wins over env — it is the surface the user can see', () => {
  const token = resolveGithubToken({
    settings: { github_token: 'from_settings' },
    env: { GH_TOKEN: 'from_env' },
  });
  assert.strictEqual(token, 'from_settings');
});

test('returns empty string when nothing is configured', () => {
  assert.strictEqual(resolveGithubToken({ settings: {}, env: {} }), '');
  assert.strictEqual(resolveGithubToken({}), '');
});

// An empty GH_TOKEN in .env is the exact state that produced the bug: present
// in the environment, but worthless. It must not count as configured.
test('whitespace-only and empty values do not count as configured', () => {
  assert.strictEqual(resolveGithubToken({ settings: { github_token: '   ' }, env: {} }), '');
  assert.strictEqual(resolveGithubToken({ settings: {}, env: { GH_TOKEN: '' } }), '');
});

test('surrounding whitespace is trimmed — pasted tokens often carry a newline', () => {
  assert.strictEqual(
    resolveGithubToken({ settings: { github_token: '  ghp_abc\n' }, env: {} }),
    'ghp_abc'
  );
});

// --- tokenSource ---------------------------------------------------------

test('reports where the active token came from', () => {
  assert.strictEqual(tokenSource({ settings: { github_token: 'x'.repeat(20) }, env: {} }), 'settings');
  assert.strictEqual(tokenSource({ settings: {}, env: { GH_TOKEN: 'y'.repeat(20) } }), 'env');
  assert.strictEqual(tokenSource({ settings: {}, env: {} }), null);
});

// --- buildGhEnv ----------------------------------------------------------

test('injects the token under both names gh understands', () => {
  const env = buildGhEnv({ settings: { github_token: 'ghp_abc' }, env: { PATH: '/usr/bin' } });
  assert.strictEqual(env.GH_TOKEN, 'ghp_abc');
  assert.strictEqual(env.GITHUB_TOKEN, 'ghp_abc');
  assert.strictEqual(env.PATH, '/usr/bin', 'must preserve the rest of the environment');
});

// Without these, a gh call in a non-TTY container can block on a prompt or a
// pager instead of failing — a hung request is harder to diagnose than an error.
test('disables prompts and the pager so gh cannot hang in a container', () => {
  const env = buildGhEnv({ settings: {}, env: {} });
  assert.strictEqual(env.GH_PROMPT_DISABLED, '1');
  assert.strictEqual(env.GH_PAGER, 'cat');
  assert.strictEqual(env.NO_COLOR, '1');
});

// gh treats an empty-string GH_TOKEN as "a token was supplied" and then fails
// with a 401 rather than the clearer "not logged into any hosts".
test('clears an empty inherited GH_TOKEN rather than passing it through', () => {
  const env = buildGhEnv({ settings: {}, env: { GH_TOKEN: '', GITHUB_TOKEN: '  ' } });
  assert.ok(!('GH_TOKEN' in env), 'empty GH_TOKEN must be removed, not forwarded');
  assert.ok(!('GITHUB_TOKEN' in env));
});

test('does not mutate the environment it was given', () => {
  const source = { PATH: '/usr/bin' };
  buildGhEnv({ settings: { github_token: 'ghp_abc' }, env: source });
  assert.deepStrictEqual(source, { PATH: '/usr/bin' });
});

// --- looksLikeToken ------------------------------------------------------

test('accepts every GitHub token format, old and new', () => {
  assert.ok(looksLikeToken('ghp_' + 'a'.repeat(36)));
  assert.ok(looksLikeToken('gho_' + 'a'.repeat(36)));
  assert.ok(looksLikeToken('ghs_' + 'a'.repeat(36)));
  assert.ok(looksLikeToken('github_pat_' + 'a'.repeat(70)));
  assert.ok(looksLikeToken('a'.repeat(40)), 'legacy 40-char hex PAT');
});

test('rejects obvious non-tokens without a network call', () => {
  assert.ok(!looksLikeToken(''));
  assert.ok(!looksLikeToken('short'));
  assert.ok(!looksLikeToken('has spaces in it and is long enough otherwise'));
  assert.ok(!looksLikeToken(null));
  assert.ok(!looksLikeToken(undefined));
  assert.ok(!looksLikeToken(12345));
});

// --- redactSettings ------------------------------------------------------

test('never returns the token, only whether one is set', () => {
  const out = redactSettings({ workingDirectory: '/w', github_token: 'ghp_secret' }, {});
  assert.ok(!('github_token' in out), 'the token must not cross the wire');
  assert.strictEqual(out.github_token_set, true);
  assert.strictEqual(out.github_token_source, 'settings');
  assert.strictEqual(out.workingDirectory, '/w', 'other settings pass through');
});

test('reports a token supplied only via the environment as set', () => {
  const out = redactSettings({ workingDirectory: '/w' }, { GH_TOKEN: 'z'.repeat(20) });
  assert.strictEqual(out.github_token_set, true);
  assert.strictEqual(out.github_token_source, 'env');
});

test('reports not-set when nothing is configured', () => {
  const out = redactSettings({ workingDirectory: '/w' }, {});
  assert.strictEqual(out.github_token_set, false);
  assert.strictEqual(out.github_token_source, null);
});

test('does not mutate the settings it redacts', () => {
  const settings = { github_token: 'ghp_secret' };
  redactSettings(settings, {});
  assert.strictEqual(settings.github_token, 'ghp_secret', 'redaction must return a copy');
});

// --- tokenHint -----------------------------------------------------------

test('hints at the stored token without revealing it', () => {
  assert.strictEqual(tokenHint('ghp_abcdefgh1234'), '…1234');
  assert.strictEqual(tokenHint('abc'), '');
  assert.strictEqual(tokenHint(null), '');
});
