// First-run setup status (feat-first-run-setup-001).
//
// A freshly built container drops the user on an empty board that silently
// depends on three things: a working directory, a GitHub token, and a Claude
// Code login. Each fails quietly — no working directory means the Changes view
// returns nothing, no token means PR badges just don't appear, no login means
// every terminal re-prompts. None of them announce themselves.
//
// The guiding rule here: a step is only reported complete when it has been
// *verified*. An unreadable file or a failed check yields "unknown", never
// "done" — reporting a green tick for something that isn't set up is worse
// than showing nothing, because it sends the user looking elsewhere.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SETTINGS_KEY_COMPLETED = 'setup_completed_at';

/**
 * Where Claude Code keeps account state. NOT inside ~/.claude — the account
 * lives in a sibling file, which is exactly the detail that made login appear
 * not to persist in the container until ~/.claude.json got its own mount.
 */
function claudeConfigPath(env = process.env, homedir = os.homedir()) {
  if (env && env.CLAUDE_CONFIG_PATH) return env.CLAUDE_CONFIG_PATH;
  return path.join(homedir, '.claude.json');
}

/**
 * Read the signed-in Claude Code account, if any.
 * Returns { logged_in, email, display_name } — never throws.
 */
function readClaudeAccount(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    // Missing file is a legitimate "not logged in", not an error state.
    return { logged_in: false, email: null, display_name: null };
  }
  try {
    const parsed = JSON.parse(raw);
    const account = parsed && parsed.oauthAccount;
    if (!account || !account.emailAddress) {
      return { logged_in: false, email: null, display_name: null };
    }
    return {
      logged_in: true,
      email: account.emailAddress,
      display_name: account.displayName || null,
    };
  } catch {
    // A corrupt or partially-written config is unknown, not signed out — but
    // for the purposes of the wizard both mean "this step isn't done yet".
    return { logged_in: false, email: null, display_name: null };
  }
}

function directoryExists(dir) {
  if (!dir) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Derive the setup steps.
 *
 * Pure: every input is passed in, so the whole matrix is testable without a
 * container, a token, or a real home directory.
 *
 * @param {object}  o.settings        parsed settings.json
 * @param {object}  o.claudeAccount   result of readClaudeAccount
 * @param {boolean} o.githubConnected from lib/github authStatus()
 * @param {string}  o.githubLogin     the authenticated account, if any
 * @param {Function} o.dirExists      injectable for tests
 */
function buildSetupSteps({
  settings = {},
  claudeAccount = { logged_in: false },
  githubConnected = false,
  githubLogin = null,
  dirExists = directoryExists,
} = {}) {
  const workingDirectory = settings.workingDirectory || '';
  // Set-but-missing is its own failure and deserves to be said out loud —
  // a typo'd path looks identical to an unset one from the board.
  const wdExists = dirExists(workingDirectory);

  return [
    {
      id: 'workspace',
      title: 'Choose your projects folder',
      description: 'Where Atrium looks for your repositories. In the container this is the /workspace mount.',
      complete: !!workingDirectory && wdExists,
      detail: !workingDirectory
        ? null
        : wdExists
          ? workingDirectory
          : `${workingDirectory} — not found`,
      problem: workingDirectory && !wdExists
        ? 'That path is set but does not exist inside the container.'
        : null,
    },
    {
      id: 'github',
      title: 'Connect GitHub',
      description: 'Needed for pull-request badges in the Changes view. Branch history works without it.',
      complete: !!githubConnected,
      detail: githubConnected && githubLogin ? `Connected as ${githubLogin}` : null,
      problem: null,
      optional: true,
    },
    {
      id: 'terminal',
      title: 'Sign in to Claude Code',
      description: 'Run `claude` in the terminal and complete the login once. Without it every terminal re-prompts.',
      complete: !!claudeAccount.logged_in,
      detail: claudeAccount.logged_in
        ? `Signed in as ${claudeAccount.email}`
        : null,
      problem: null,
    },
  ];
}

/**
 * Whether the wizard should appear.
 *
 * Dismissal is remembered so it never nags, and the optional GitHub step does
 * not hold it open. It is deliberately a prompt rather than a gate: a user who
 * only wants to read the board should not have to configure anything first.
 */
function isSetupComplete(steps, settings = {}) {
  if (settings[SETTINGS_KEY_COMPLETED]) return true;
  return steps.filter((s) => !s.optional).every((s) => s.complete);
}

module.exports = {
  SETTINGS_KEY_COMPLETED,
  claudeConfigPath,
  readClaudeAccount,
  directoryExists,
  buildSetupSteps,
  isSetupComplete,
};
