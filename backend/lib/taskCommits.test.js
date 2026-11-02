const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { getTaskCommitChanges, clearTaskCommitsCache, parseShow, aggregate, cleanShas, grepLiteral } = require('./taskCommits');

// A throwaway repo: three commits on one shared branch, two of them for feat-a-001
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-commits-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'shared');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Tester');
  const commit = (file, lines, message) => {
    fs.writeFileSync(path.join(dir, file), lines.join('\n') + '\n');
    git('add', file);
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const a1 = commit('a.txt', ['one', 'two'], 'feat(a): first\n\nTask: feat-a-001');
  const b1 = commit('b.txt', ['x'], 'feat(b): other work\n\nTask: feat-b-001');
  const a2 = commit('a.txt', ['one', 'two', 'three'], 'feat(a): second\n\ntask: FEAT-A-001');
  const plain = commit('c.txt', ['c'], 'chore: no trailer');
  return { dir, a1, a2, b1, plain };
}

test('a task gets the commits with its Task: trailer, and only those', async () => {
  clearTaskCommitsCache();
  const r = makeRepo();
  const data = await getTaskCommitChanges(r.dir, 'feat-a-001', []);
  assert.equal(data.source, 'commits');
  assert.deepEqual(data.commits.map(c => c.oid), [r.a1, r.a2], 'oldest first; case-insensitive trailer');
  assert.deepEqual(data.files.map(f => f.path), ['a.txt']);
  assert.equal(data.additions, 3, '2 lines, then 1 more');
  assert.equal(data.changed_files, 1);
  assert.equal(data.commits[0].message_headline, 'feat(a): first');
});

test('listed shas count too, short or full, and bad ones are ignored', async () => {
  clearTaskCommitsCache();
  const r = makeRepo();
  const data = await getTaskCommitChanges(r.dir, 'chore-x-001', [r.plain.slice(0, 7), 'not-a-sha', '; rm -rf /', 'deadbeef00']);
  assert.deepEqual(data.commits.map(c => c.oid), [r.plain]);
  assert.deepEqual(data.files.map(f => f.path), ['c.txt']);
});

test('a task with no commits of its own gives null (the caller falls back to the PR)', async () => {
  clearTaskCommitsCache();
  const r = makeRepo();
  assert.equal(await getTaskCommitChanges(r.dir, 'feat-none-001', []), null);
  assert.equal(await getTaskCommitChanges(null, 'feat-a-001', []), null);
});

test('a task id is matched literally, not as a pattern', async () => {
  clearTaskCommitsCache();
  const r = makeRepo();
  // "feat-a-00." would match feat-a-001 if the dot were a wildcard
  assert.equal(await getTaskCommitChanges(r.dir, 'feat-a-00.', []), null);
  assert.equal(grepLiteral('a.b*c'), 'a\\.b\\*c');
});

test('numstat parsing and per-file totals', () => {
  const out = '<COMMIT>aaa\x1fone\x1f2026-01-01T00:00:00Z\x1fT\n\n3\t1\tsrc/x.js\n-\t-\timg.png\n'
    + '<COMMIT>bbb\x1ftwo\x1f2026-01-02T00:00:00Z\x1fT\n\n2\t0\tsrc/x.js\n';
  const commits = parseShow(out);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0].files[1], { path: 'img.png', additions: 0, deletions: 0 }, 'binary: no line stats');
  assert.deepEqual(aggregate(commits), [{ path: 'src/x.js', additions: 5, deletions: 1 }, { path: 'img.png', additions: 0, deletions: 0 }]);
  assert.deepEqual(cleanShas(['abc1234', 'ABC1234', 'xyz', 42, null]), ['abc1234', 'ABC1234']);
});

// ---- Commit badges (feat-task-commit-badge-001) ----

const { getTaskCommitSummaries, parseLog } = require('./taskCommits');

test('summaries: each task gets its commit count and newest commit', async () => {
  const r = makeRepo();
  const s = await getTaskCommitSummaries(r.dir, [{ id: 'feat-a-001' }, { id: 'feat-b-001' }, { id: 'feat-none-001' }]);
  assert.equal(s['feat-a-001'].count, 2);
  assert.ok([r.a1, r.a2].includes(s['feat-a-001'].latest_sha));
  assert.equal(s['feat-b-001'].count, 1);
  assert.equal(s['feat-b-001'].latest_sha, r.b1);
  assert.equal(s['feat-b-001'].latest_subject, 'feat(b): other work');
  assert.equal(s['feat-none-001'], undefined, 'no commits, no summary');
});

test('summaries: listed shas count too, short or full; unknown ones are skipped', async () => {
  const r = makeRepo();
  const s = await getTaskCommitSummaries(r.dir, [
    { id: 'feat-b-001', github_commits: [r.plain.slice(0, 7), 'deadbeefdeadbeef', r.b1] },
    { id: 'feat-c-001', github_commits: [r.plain] },
  ]);
  assert.equal(s['feat-b-001'].count, 2, 'trailer commit + listed plain commit, b1 not doubled');
  assert.equal(s['feat-c-001'].count, 1);
  assert.equal(s['feat-c-001'].latest_sha, r.plain);
});

test('summaries: no repo or no tasks gives nothing', async () => {
  assert.deepEqual(await getTaskCommitSummaries(null, [{ id: 'x' }]), {});
  assert.deepEqual(await getTaskCommitSummaries(makeRepo().dir, []), {});
});

test('parseLog reads every Task: trailer line in a body', () => {
  const out = '<COMMIT>abc\x1f2026-11-02T00:00:00Z\x1fsubj\x1fsubj\n\nTask: feat-a-001\nTask: FEAT-B-002\nCo-Authored-By: x\n\x1e\n';
  const [c] = parseLog(out);
  assert.equal(c.oid, 'abc');
  assert.deepEqual(c.taskIds, ['feat-a-001', 'feat-b-002']);
});
