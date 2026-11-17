// Task cache behaviour (opt-task-scan-nonblocking-001). node --test runs each
// file in its own process, so pointing ATRIUM_DATA_DIR at a temp dir before
// the first require gives this file a private tasks tree and a cold cache.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-taskcache-'));
process.env.ATRIUM_DATA_DIR = DATA_DIR;
process.env.ATRIUM_TASK_CACHE_TTL_MS = '50';

const test = require('node:test');
const assert = require('node:assert');
const { TASKS_DIR } = require('./constants');
const tasks = require('./tasks');

const PROJ = path.join(TASKS_DIR, 'Proj');
const fileFor = (id, dir = PROJ) => path.join(dir, `${id}.md`);
const doc = (id, title) => `---\nid: ${id}\ntitle: ${title}\nstatus: todo\n---\n\nbody\n`;
const titleOf = (id) => (tasks.getAllTasks().find((t) => t.id === id) || {}).title;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.mkdirSync(PROJ, { recursive: true });
fs.mkdirSync(path.join(TASKS_DIR, '.archived', 'Old'), { recursive: true });
fs.writeFileSync(fileFor('t-a'), doc('t-a', 'A'));
fs.writeFileSync(fileFor('t-b'), doc('t-b', 'B'));
fs.writeFileSync(path.join(PROJ, 'README.md'), '# not a task\n');
fs.writeFileSync(fileFor('t-old', path.join(TASKS_DIR, '.archived', 'Old')), doc('t-old', 'Old'));

test.after(() => fs.rmSync(DATA_DIR, { recursive: true, force: true }));

test('cold scan finds tasks, skips dot dirs and README', () => {
  const ids = tasks.getAllTasks().map((t) => t.id).sort();
  assert.deepStrictEqual(ids, ['t-a', 't-b']);
});

test('a write in this process is visible on the very next read', () => {
  tasks.getAllTasks();
  tasks.atomicWriteFileSync(fileFor('t-a'), doc('t-a', 'A2'));
  assert.strictEqual(titleOf('t-a'), 'A2');
});

test('a new task written in this process appears immediately', () => {
  tasks.getAllTasks();
  tasks.atomicWriteFileSync(fileFor('t-c'), doc('t-c', 'C'));
  tasks.indexSet('t-c', fileFor('t-c'));
  assert.strictEqual(titleOf('t-c'), 'C');
});

test('a delete followed by indexDelete drops the task', () => {
  tasks.getAllTasks();
  fs.unlinkSync(fileFor('t-c'));
  tasks.indexDelete('t-c');
  assert.strictEqual(titleOf('t-c'), undefined);
});

test('an outside edit is served stale, then picked up by the background refresh', async () => {
  tasks.getAllTasks();
  fs.writeFileSync(fileFor('t-b'), doc('t-b', 'B-outside')); // not via atomicWriteFileSync
  assert.strictEqual(titleOf('t-b'), 'B', 'within TTL the cached value is served');
  await sleep(80); // past the 50 ms test TTL
  assert.strictEqual(titleOf('t-b'), 'B', 'a stale read returns at once, without waiting for disk');
  await tasks.refreshTasksAsync();
  assert.strictEqual(titleOf('t-b'), 'B-outside');
});

test('an outside create is picked up by the background refresh', async () => {
  tasks.getAllTasks();
  fs.writeFileSync(fileFor('t-d'), doc('t-d', 'D'));
  await tasks.refreshTasksAsync();
  assert.strictEqual(titleOf('t-d'), 'D');
});

test('a write during a background refresh is not overwritten by it', async () => {
  tasks.getAllTasks();
  const refresh = tasks.refreshTasksAsync();
  tasks.atomicWriteFileSync(fileFor('t-a'), doc('t-a', 'A3'));
  await refresh;
  assert.strictEqual(titleOf('t-a'), 'A3');
});

test('buildIndex makes findTaskFilePath resolve every task', () => {
  tasks.buildIndex();
  assert.strictEqual(tasks.findTaskFilePath('t-b'), fileFor('t-b'));
  assert.strictEqual(tasks.findTaskFilePath('nope'), null);
});

test('a bad YAML file fails getAllTasks (as before) but not buildIndex', async () => {
  const bad = fileFor('t-bad');
  fs.writeFileSync(bad, '---\nid: t-bad\ntitle: [unclosed\n---\n');
  tasks.invalidateCache();
  assert.throws(() => tasks.getAllTasks());
  assert.doesNotThrow(() => tasks.buildIndex());
  assert.strictEqual(tasks.findTaskFilePath('t-a'), fileFor('t-a'));
  fs.unlinkSync(bad);
  tasks.invalidateCache();
  assert.ok(tasks.getAllTasks().length >= 3);
});
