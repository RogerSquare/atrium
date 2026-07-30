// First-run setup status (feat-first-run-setup-001).
//
// Mounted behind requireAuth in server.js — there is nothing to set up before
// an account exists, and the admin account creation is what precedes this.

const express = require('express');
const fs = require('fs');
const { SETTINGS_FILE } = require('../lib/constants');
const { authStatus, loadSettings } = require('../lib/github');
const {
  SETTINGS_KEY_COMPLETED,
  claudeConfigPath,
  readClaudeAccount,
  buildSetupSteps,
  isSetupComplete,
} = require('../lib/setupStatus');
const { agentHasConnected } = require('../lib/agentActivity');
const { logger } = require('../lib/logger');

const router = express.Router();

/**
 * @swagger
 * /api/setup/status:
 *   get:
 *     summary: First-run setup progress
 *     tags: [Setup]
 *     responses:
 *       200:
 *         description: "{ complete, dismissed, steps: [{ id, title, complete, detail }] }"
 */
router.get('/status', async (req, res) => {
  try {
    const settings = loadSettings();
    const claudeAccount = readClaudeAccount(claudeConfigPath());

    // The GitHub check makes a network call, so a slow or offline GitHub must
    // not stall the whole wizard — degrade to "not connected" instead.
    let github = { connected: false, login: null };
    try {
      github = await authStatus();
    } catch (err) {
      logger.warn({ err: err.message }, 'setup: github status check failed');
    }

    const steps = buildSetupSteps({
      settings,
      claudeAccount,
      githubConnected: github.connected,
      githubLogin: github.login,
      agentConnected: agentHasConnected(),
    });

    res.json({
      complete: isSetupComplete(steps, settings),
      dismissed: !!settings[SETTINGS_KEY_COMPLETED],
      steps,
    });
  } catch (error) {
    logger.error({ err: error }, 'setup status failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/setup/complete:
 *   post:
 *     summary: Record that first-run setup was dismissed
 *     description: The wizard is a prompt, not a gate — this can be called with steps outstanding.
 *     tags: [Setup]
 */
router.post('/complete', (req, res) => {
  try {
    const settings = loadSettings();
    settings[SETTINGS_KEY_COMPLETED] = new Date().toISOString();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ success: true, dismissed_at: settings[SETTINGS_KEY_COMPLETED] });
  } catch (error) {
    logger.error({ err: error }, 'setup complete failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /api/setup/reopen:
 *   post:
 *     summary: Clear the dismissal so the wizard can be reopened from Settings
 *     tags: [Setup]
 */
router.post('/reopen', (req, res) => {
  try {
    const settings = loadSettings();
    delete settings[SETTINGS_KEY_COMPLETED];
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    res.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'setup reopen failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
