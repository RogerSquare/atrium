const fs = require('fs');
const { LOOP_TEMPLATES_FILE } = require('./constants');
const { logger } = require('./logger');

/**
 * Loop instructions (feat-loopsv2-instructions-001).
 *
 * `generate(loop)` derives the default agent instructions from the loop's
 * toggles (scope/watch/actions/mode). A loop may carry an `instructions`
 * override (edited in the UI); `resolve(loop)` returns the effective text
 * (override if non-empty, else generated). The effective text is fed to the
 * agent prompt so editing instructions actually changes behavior, and is the
 * policy the future executor will run under.
 *
 * Edited instructions can be saved to a reusable template library (CRUD here).
 */

const WATCH_DESC = {
  prs: 'pull request open / merge / close + review decision changes',
  ci: 'CI / check-run status (failure, recovery)',
  commits: 'new commits on task-linked branches',
  issues: 'new GitHub issues',
};
const ACTION_DESC = {
  update_fields: 'set `github_branch` / `github_pr_url` on the matching task',
  comment: 'post a structured comment on the task describing the change',
  ai_summary: 'run an AI summary on high-signal events (PR opened/merged, CI failure)',
};

// Pure: default instructions text from the loop config. Exported for tests.
function generate(loop = {}) {
  const target = loop.scope === 'project' ? `the "${loop.project}" project repo` : `the repo ${loop.repo || '(unset)'}`;
  const everyMin = Math.round((loop.interval_ms || 0) / 60000) || 5;
  const watch = (loop.watch || []).map((w) => `- ${WATCH_DESC[w] || w}`);
  const acts = (loop.actions || []).map((a) => `- ${ACTION_DESC[a] || a}`);
  if ((loop.watch || []).includes('issues')) acts.push('- create a `draft` Atrium task for each new issue');

  if (loop.mode === 'worker') {
    return [
      `You are the autonomous worker behind the loop "${loop.name || '(unnamed)'}" for ${target}.`,
      '',
      `Every ${everyMin} minutes, claim the next eligible \`todo\` task in the project and take it from start to a pull request:`,
      '- Branch from the latest main (branch name contains the task id), implement the change, run tests/lint/build.',
      '- Open a PR and move the task to `review`.',
      '',
      'Rules: NEVER merge and NEVER push to main — a human reviews and merges. Stop at `review`. If blocked, return the task to `todo` with a comment. Keep changes scoped to the task.',
      '',
      '(This text is editable — it becomes the agent policy embedded in each execution run.)',
    ].join('\n');
  }
  const lines = [
    `You are the agent behind the loop "${loop.name || '(unnamed)'}".`,
    '',
    `Every ${everyMin} minutes, watch ${target} for:`,
    ...(watch.length ? watch : ['- (nothing selected)']),
    '',
    'When a change is detected, you may:',
    ...(acts.length ? acts : ['- (no actions selected)']),
    '',
    'Rules:',
    '- A merged PR moves a mid-flight (todo/in_progress) task to `review`. NEVER move a task to `done` — humans merge and close.',
    '- Be concise and specific; never invent details beyond the data provided.',
    '- Keep changes scoped to what the event warrants.',
  ];
  return lines.join('\n');
}

// Effective instructions: a non-empty override wins, else the generated default.
function resolve(loop = {}) {
  const override = typeof loop.instructions === 'string' ? loop.instructions.trim() : '';
  return override || generate(loop);
}

// --- Template library ----------------------------------------------------

function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}

function loadTemplates() {
  if (!fs.existsSync(LOOP_TEMPLATES_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOOP_TEMPLATES_FILE, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logger.warn({ err }, 'Failed to parse loop-templates.json; treating as empty');
    return [];
  }
}

function saveTemplates(list) {
  atomicWrite(LOOP_TEMPLATES_FILE, JSON.stringify(list, null, 2));
}

function listTemplates() {
  return loadTemplates().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

function templateError(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function createTemplate({ name, body } = {}, { now = new Date().toISOString() } = {}) {
  if (typeof name !== 'string' || !name.trim()) throw templateError('name is required');
  if (typeof body !== 'string' || !body.trim()) throw templateError('body is required');
  const list = loadTemplates();
  const base = `tpl-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'instructions'}`;
  let id = base; let n = 2;
  const ids = new Set(list.map((t) => t.id));
  while (ids.has(id)) { id = `${base}-${n}`; n++; }
  const tpl = { id, name: name.trim(), body, created_at: now, updated_at: now };
  list.push(tpl);
  saveTemplates(list);
  return tpl;
}

function updateTemplate(id, fields = {}, { now = new Date().toISOString() } = {}) {
  const list = loadTemplates();
  const idx = list.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  if (fields.name !== undefined) {
    if (typeof fields.name !== 'string' || !fields.name.trim()) throw templateError('name must be a non-empty string');
    list[idx].name = fields.name.trim();
  }
  if (fields.body !== undefined) {
    if (typeof fields.body !== 'string' || !fields.body.trim()) throw templateError('body must be a non-empty string');
    list[idx].body = fields.body;
  }
  list[idx].updated_at = now;
  saveTemplates(list);
  return list[idx];
}

function deleteTemplate(id) {
  const list = loadTemplates();
  const next = list.filter((t) => t.id !== id);
  if (next.length === list.length) return false;
  saveTemplates(next);
  return true;
}

module.exports = {
  generate, resolve,
  listTemplates, createTemplate, updateTemplate, deleteTemplate, loadTemplates, saveTemplates,
};
