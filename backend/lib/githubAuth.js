// GitHub credential resolution for the `gh` CLI (feat-github-auth-settings-001).
//
// Why this exists: containerized Atrium has no interactive terminal to run
// `gh auth login` in, and the container is rebuilt often enough that anything
// written into ~/.config/gh would be discarded. So the token lives in
// settings.json — which sits in the ATRIUM_DATA_DIR volume and therefore
// survives rebuilds — and is injected into `gh`'s environment per invocation.
//
// The functions here are pure and take their inputs explicitly so they can be
// tested without a settings file, a container, or a real token.

const SETTINGS_KEY = 'github_token';

// `gh` reads GH_TOKEN first, then GITHUB_TOKEN. We accept both on the way in so
// an operator who already exports one in .env doesn't have to re-enter it in
// the UI, but settings wins — it's the surface the user can actually see.
const ENV_KEYS = ['GH_TOKEN', 'GITHUB_TOKEN'];

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function tokenFromEnv(env) {
  if (!env) return '';
  return firstNonEmpty(...ENV_KEYS.map((key) => env[key]));
}

/**
 * Resolve the token `gh` should use. Settings takes precedence over env.
 * Returns '' when nothing is configured — callers treat that as "signed out".
 */
function resolveGithubToken({ settings = {}, env = process.env } = {}) {
  const fromSettings = settings ? settings[SETTINGS_KEY] : '';
  return firstNonEmpty(fromSettings, tokenFromEnv(env));
}

/**
 * Where the active token came from: 'settings' | 'env' | null.
 * Surfaced in the UI so "why am I still signed in after clicking Disconnect?"
 * has a visible answer (the answer being: GH_TOKEN is still set in .env).
 */
function tokenSource({ settings = {}, env = process.env } = {}) {
  if (firstNonEmpty(settings ? settings[SETTINGS_KEY] : '')) return 'settings';
  if (tokenFromEnv(env)) return 'env';
  return null;
}

/**
 * Build the environment for a `gh` child process.
 *
 * GH_PROMPT_DISABLED and GH_PAGER matter as much as the token: without them a
 * `gh` invocation in a non-TTY container can block on an interactive prompt or
 * a pager that never gets read, which would hang the request rather than fail
 * it. NO_COLOR keeps ANSI escapes out of the JSON we parse.
 */
function buildGhEnv({ settings = {}, env = process.env } = {}) {
  const base = {
    ...env,
    GH_PROMPT_DISABLED: '1',
    GH_PAGER: 'cat',
    NO_COLOR: '1',
  };
  const token = resolveGithubToken({ settings, env });
  if (token) {
    base.GH_TOKEN = token;
    base.GITHUB_TOKEN = token;
  } else {
    // Explicitly clear rather than inherit an empty-string GH_TOKEN, which gh
    // treats as "a token was provided" and then fails with a confusing 401.
    delete base.GH_TOKEN;
    delete base.GITHUB_TOKEN;
  }
  return base;
}

/**
 * Cheap shape check before we bother the network. Deliberately permissive:
 * GitHub has shipped several token formats (ghp_, gho_, ghu_, ghs_, ghr_,
 * github_pat_, and the old 40-char hex PATs), and rejecting an unfamiliar but
 * valid format is worse than letting the verification call reject it.
 */
function looksLikeToken(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 20 || trimmed.length > 512) return false;
  return !/\s/.test(trimmed);
}

/**
 * Strip the token out of a settings object before it crosses the wire.
 *
 * GET /api/settings returns the whole settings object to the browser, so
 * without this the token would be readable in devtools by anyone with a
 * session — including from the shared-tasks setup where the same settings.json
 * is visible to the native install. Returns a copy; never mutates the input.
 */
function redactSettings(settings = {}, env = process.env) {
  const copy = { ...settings };
  delete copy[SETTINGS_KEY];
  copy.github_token_set = !!resolveGithubToken({ settings, env });
  copy.github_token_source = tokenSource({ settings, env });
  return copy;
}

/** Last 4 characters, for confirming *which* token is stored without exposing it. */
function tokenHint(token) {
  if (typeof token !== 'string' || token.trim().length < 4) return '';
  const trimmed = token.trim();
  return `…${trimmed.slice(-4)}`;
}

module.exports = {
  SETTINGS_KEY,
  resolveGithubToken,
  tokenSource,
  buildGhEnv,
  looksLikeToken,
  redactSettings,
  tokenHint,
};
