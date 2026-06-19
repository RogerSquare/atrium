#!/usr/bin/env node
/**
 * Tests for the executor prompt template engine (feat-loopsv2-prompttemplate-001).
 * Run: node scripts/test-loop-prompttemplate.js
 */
const tpl = require('../lib/loopPromptTemplate');

let passed = 0;
function ok(cond, msg) { if (!cond) { console.error(`  FAIL: ${msg}`); process.exit(1); } passed++; }

const vars = { task_id: 'feat-x-001', task_title: 'Do the thing', task_description: 'desc', repo_path: '/repo/x', base_branch: 'main', branch: 'loop/feat-x-001', test_command: 'npm test', instructions: 'be careful', port: 3001, final_status: 'review' };

// render
ok(tpl.render('a {{task_id}} b', { task_id: 'X' }) === 'a X b', 'render substitutes a placeholder');
ok(tpl.render('{{missing}}', {}) === '', 'missing placeholder -> empty');
ok(tpl.render('{{ task_id }}', { task_id: 'X' }) === 'X', 'whitespace inside braces tolerated');
ok(tpl.render('{{a}}-{{b}}', { a: '1', b: '2' }) === '1-2', 'multiple placeholders');

// placeholders list
const ph = tpl.listPlaceholders();
ok(['task_id', 'repo_path', 'base_branch', 'test_command', 'instructions', 'final_status'].every((k) => ph.includes(k)), 'listPlaceholders covers key vars');

// default build
const def = tpl.build(null, vars);
ok(def.includes('feat-x-001') && def.includes('/repo/x') && def.includes('be careful'), 'default build interpolates task/repo/instructions');
ok(def.includes('## Workflow') && def.includes('npm test'), 'default build has the workflow + commands');
ok(/NEVER merge/i.test(def) && def.includes('NEVER push to `main`'), 'default build includes the hard rules');
ok(def.includes('`review`'), 'default build references final_status');
ok(!def.includes('{{'), 'no unresolved placeholders remain');

// custom template — body is custom BUT hard rules still appended
const custom = tpl.build('Just do {{task_id}} and nothing else.', vars);
ok(custom.startsWith('Just do feat-x-001 and nothing else.'), 'custom template body used');
ok(/NEVER merge/i.test(custom) && custom.includes('NEVER push to `main`'), 'HARD RULES appended even with a custom template (non-removable)');
ok(!custom.includes('## Workflow'), 'custom template does not get the default workflow');

// blank/whitespace template falls back to default
ok(tpl.build('   ', vars).includes('## Workflow'), 'whitespace template falls back to default');

// hard rules use the configured base branch
ok(tpl.build('x', { ...vars, base_branch: 'develop' }).includes('NEVER push to `develop`'), 'hard rules use the configured base branch');

// executor still builds via the engine
const { buildExecutionPrompt } = require('../lib/loopExecutor');
const ep = buildExecutionPrompt({ id: 'loop-1', worker: { base_branch: 'main', test_command: 'pnpm test' } }, { id: 'feat-y-002', title: 'Y', content: 'do y' }, 'policy text', '/repo/y');
ok(ep.includes('feat-y-002') && ep.includes('/repo/y') && ep.includes('policy text') && ep.includes('pnpm test') && /NEVER merge/i.test(ep), 'buildExecutionPrompt renders via the template + hard rules + worker command');

console.log(`\nAll ${passed} loop-prompttemplate assertions passed.`);
