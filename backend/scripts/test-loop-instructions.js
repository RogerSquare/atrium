#!/usr/bin/env node
/**
 * Tests for loop instruction generation/resolution + the template library
 * (feat-loopsv2-instructions-001). Uses a throwaway templates file.
 * Run: node scripts/test-loop-instructions.js  (or npm run test:loop-instructions)
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), `atrium-loop-templates-test-${process.pid}.json`);
process.env.ATRIUM_LOOP_TEMPLATES_FILE = TMP;

const li = require('../lib/loopInstructions');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }
function throws(fn, msg) { try { fn(); } catch { passed++; return; } console.error(`  FAIL: ${msg} (no throw)`); process.exit(1); }
function cleanup() { try { fs.unlinkSync(TMP); } catch {} try { fs.unlinkSync(TMP + '.tmp'); } catch {} }

cleanup();
try {
  // generate
  const loop = { name: 'X', scope: 'project', project: 'Cairn', watch: ['prs', 'ci', 'issues'], actions: ['update_fields', 'comment', 'ai_summary'], interval_ms: 300000 };
  const gen = li.generate(loop);
  ok(gen.includes('"X"') && gen.includes('Cairn') && gen.includes('project repo'), 'generate names the loop + target');
  ok(gen.includes('pull request') && gen.includes('CI'), 'generate lists watched prs/ci');
  ok(gen.includes('draft') && gen.includes('issue'), 'generate mentions issue->draft task');
  ok(gen.includes('AI summary'), 'generate mentions ai_summary action');
  ok(gen.includes('NEVER move a task to `done`'), 'generate includes the never-done rule');
  ok(li.generate({ name: 'g', scope: 'global', repo: 'o/r', watch: [], actions: [], interval_ms: 60000 }).includes('o/r'), 'generate handles global repo');

  // resolve: override wins when non-empty, else generated
  ok(li.resolve(loop) === gen, 'resolve falls back to generated when no override');
  ok(li.resolve({ ...loop, instructions: '   ' }) === gen, 'resolve ignores blank override');
  ok(li.resolve({ ...loop, instructions: 'do the thing' }) === 'do the thing', 'resolve uses non-empty override');

  // template library CRUD
  ok(li.listTemplates().length === 0, 'no templates initially');
  const t = li.createTemplate({ name: 'My policy', body: 'be careful' });
  ok(t.id.startsWith('tpl-') && t.name === 'My policy' && t.body === 'be careful', 'createTemplate returns shaped template');
  ok(li.listTemplates().length === 1, 'template persisted');
  throws(() => li.createTemplate({ name: '', body: 'x' }), 'createTemplate rejects empty name');
  throws(() => li.createTemplate({ name: 'x', body: '' }), 'createTemplate rejects empty body');
  const t2 = li.createTemplate({ name: 'My policy', body: 'v2' });
  ok(t2.id !== t.id, 'duplicate name -> unique id');
  const u = li.updateTemplate(t.id, { body: 'updated' });
  ok(u.body === 'updated', 'updateTemplate edits body');
  ok(li.updateTemplate('nope', { body: 'x' }) === null, 'updateTemplate missing -> null');
  ok(li.deleteTemplate(t.id) === true, 'deleteTemplate true');
  ok(li.deleteTemplate(t.id) === false, 'deleteTemplate missing -> false');
  ok(li.listTemplates().length === 1, 'one template left after delete');

  console.log(`\nAll ${passed} loop-instructions assertions passed.`);
} finally {
  cleanup();
}
