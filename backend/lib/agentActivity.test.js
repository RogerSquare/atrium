// Unit tests for the agent-seen marker (feat-setup-wizard-v2-001).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { recordAgentSeen, agentHasConnected } = require('./agentActivity');

function freshMarker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-agentseen-'));
  return path.join(dir, 'sub', '.agent-seen'); // nested to exercise mkdirSync
}

test('agentHasConnected is false until an agent is recorded', () => {
  const m = freshMarker();
  assert.strictEqual(agentHasConnected(m), false);
  recordAgentSeen(m);
  assert.strictEqual(agentHasConnected(m), true);
});

test('recordAgentSeen is write-once and does not rewrite an existing marker', () => {
  const m = freshMarker();
  assert.strictEqual(recordAgentSeen(m), true);   // first write happens
  const firstBytes = fs.readFileSync(m, 'utf8');
  assert.strictEqual(recordAgentSeen(m), false);  // second is a no-op
  assert.strictEqual(fs.readFileSync(m, 'utf8'), firstBytes);
});

test('recordAgentSeen never throws on a bad path (best-effort)', () => {
  // existsSync that throws simulates an unreadable location; must be swallowed.
  const boom = () => { throw new Error('EACCES'); };
  assert.strictEqual(recordAgentSeen('/nope/.agent-seen', { existsSync: boom }), false);
  assert.strictEqual(agentHasConnected('/nope/.agent-seen', { existsSync: boom }), false);
});
