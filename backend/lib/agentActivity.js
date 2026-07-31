// Agent-connected signal for the first-run wizard (feat-setup-wizard-v2-001).
//
// The "Connect an agent" setup step must go green on VERIFIED activity — an
// agent that actually authenticated — not on a token that was merely minted.
// authMiddleware calls recordAgentSeen() on every successful agent auth; the
// wizard reads agentHasConnected().
//
// "Has an agent ever authenticated" is monotonic for setup purposes, so this is
// write-once: the marker is touched the first time only (one existsSync per
// agent request, one write ever) and is best-effort — it must never throw into
// the auth path.

const fs = require('fs');
const path = require('path');
const { AGENT_TOKENS_DIR } = require('./constants');

const MARKER = path.join(AGENT_TOKENS_DIR, '.agent-seen');

function recordAgentSeen(markerPath = MARKER, deps = {}) {
  const {
    existsSync = fs.existsSync,
    writeFileSync = fs.writeFileSync,
    mkdirSync = fs.mkdirSync,
    now = () => new Date().toISOString(),
  } = deps;
  try {
    if (existsSync(markerPath)) return false;
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, now());
    return true;
  } catch {
    return false; // best-effort — never break authentication over a marker
  }
}

function agentHasConnected(markerPath = MARKER, deps = {}) {
  const { existsSync = fs.existsSync } = deps;
  try {
    return existsSync(markerPath);
  } catch {
    return false;
  }
}

module.exports = { recordAgentSeen, agentHasConnected, MARKER };
