// Playbook-mode validation + prompt building (feat-hub-rethink-impl-001).
// Pure seams only: loops.validate and loopAgent.buildPlaybook* — no spawns,
// no loops.json writes.

const test = require('node:test');
const assert = require('node:assert');

const { validate, LoopValidationError, MODES } = require('./loops');
const { buildPlaybookPrompt } = require('./loopAgent');

const base = { name: 'Morning digest', scope: 'project', project: 'Atrium', mode: 'playbook', instructions: 'Summarize open work.' };

test('playbook is a valid mode', () => {
  assert.ok(MODES.includes('playbook'));
  assert.doesNotThrow(() => validate(base));
});

test('playbook loops require non-empty instructions', () => {
  for (const instructions of [null, '', '   ']) {
    assert.throws(
      () => validate({ ...base, instructions }),
      (e) => e instanceof LoopValidationError && /instructions/.test(JSON.stringify(e.details)),
    );
  }
});

test('a global playbook needs neither project nor repo', () => {
  assert.doesNotThrow(() => validate({ name: 'Homelab check', scope: 'global', mode: 'playbook', instructions: 'Check things.' }));
});

test('global non-playbook loops still require a repo', () => {
  assert.throws(
    () => validate({ name: 'W', scope: 'global', mode: 'watcher' }),
    (e) => e instanceof LoopValidationError && Boolean(e.details.repo),
  );
});

test('the instructions requirement respects the merged view on partial updates', () => {
  // Flipping an existing watcher (no instructions) to playbook must fail...
  const existing = { name: 'W', scope: 'project', project: 'Atrium', mode: 'watcher', instructions: null };
  assert.throws(
    () => validate({ mode: 'playbook' }, { partial: true, merged: { ...existing, mode: 'playbook' } }),
    (e) => e instanceof LoopValidationError && Boolean(e.details.instructions),
  );
  // ...but succeeds when instructions arrive in the same patch.
  const patch = { mode: 'playbook', instructions: 'Do the thing.' };
  assert.doesNotThrow(() => validate(patch, { partial: true, merged: { ...existing, ...patch } }));
});

test('playbook prompt embeds the instructions and forbids tools', () => {
  const prompt = buildPlaybookPrompt({
    kind: 'playbook',
    loop: { id: 'loop-x', name: 'Morning digest', project: 'Atrium' },
    playbook: 'Summarize open work.',
    board: { project: 'Atrium', total_tasks: 3, task_counts: { todo: 2, review: 1 } },
    generated_at: 'now',
  });
  assert.ok(prompt.includes('Summarize open work.'));
  assert.ok(prompt.includes('no tools'));
  assert.ok(prompt.includes('"task_counts"'));
});
