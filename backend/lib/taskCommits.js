// A task's own commits, for the Changes view (feat-task-commits-001).
//
// The Changes view is PR-based, which reads badly when many tasks share one long-lived branch: every
// task resolves to the same PR and shows the same whole-branch diff. A task's own commits fix that:
//   - the shas listed in the task's `github_commits` frontmatter, and
//   - any commit whose message has a `Task: <task-id>` trailer (the CLAUDE.md commit convention).
// Their files and +/- come from the local git repo, in the same shape getPrChanges returns, so the
// frontend renders them with the same component.

const { execFile } = require('child_process');
const { promisify } = require('util');
const { logger } = require('./logger');

const execFileP = promisify(execFile);

const SHA = /^[0-9a-f]{7,40}$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function git(repoPath, args) {
  try {
    const { stdout } = await execFileP('git', args, { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    logger.warn({ err: err.message, args: args.slice(0, 3) }, 'task commits: git failed');
    return null;
  }
}

/** The listed shas that look like shas (anything else is ignored, never passed to git) */
function cleanShas(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(s => String(s || '').trim()).filter(s => SHA.test(s)))];
}

/** Escapes a task id for git's --grep (a basic regex) */
function grepLiteral(text) {
  return String(text).replace(/[.[\]*^$\\]/g, '\\$&');
}

/**
 * Parses `git show --numstat --format=<COMMIT>%H%x1f%s%x1f%aI%x1f%an` output for one or more commits.
 * Returns [{ oid, subject, date, author, files: [{path, additions, deletions}] }].
 */
function parseShow(out) {
  const commits = [];
  let current = null;
  for (const line of (out || '').split('\n')) {
    if (line.startsWith('<COMMIT>')) {
      const [oid, subject, date, author] = line.slice('<COMMIT>'.length).split('\x1f');
      current = { oid, subject: subject || '', date: date || null, author: author || null, files: [] };
      commits.push(current);
      continue;
    }
    if (!current || !line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    // Binary files report "-": count them as changed with no line stats
    current.files.push({ path: m[3], additions: m[1] === '-' ? 0 : Number(m[1]), deletions: m[2] === '-' ? 0 : Number(m[2]) });
  }
  return commits;
}

/** Totals per file across commits, in first-seen order */
function aggregate(commits) {
  const byPath = new Map();
  for (const c of commits) {
    for (const f of c.files) {
      const prev = byPath.get(f.path) || { path: f.path, additions: 0, deletions: 0 };
      prev.additions += f.additions;
      prev.deletions += f.deletions;
      byPath.set(f.path, prev);
    }
  }
  return [...byPath.values()];
}

/**
 * The task's own commits and their changes, or null when it has none (the caller falls back to the PR).
 * Commits are oldest first, like a PR's.
 */
async function getTaskCommitChanges(repoPath, taskId, listedShas, { refresh = false } = {}) {
  if (!repoPath || !taskId) return null;
  const listed = cleanShas(listedShas);
  const key = `${repoPath}#${taskId}#${listed.join(',')}`;
  const cached = cache.get(key);
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  // Commits carrying the task's trailer, on any branch
  const trailer = await git(repoPath, ['log', '--all', '--format=%H', '-E', '-i',
    `--grep=^Task:[[:space:]]*${grepLiteral(taskId)}[[:space:]]*$`]);
  const found = (trailer || '').split('\n').map(s => s.trim()).filter(Boolean);

  // Listed shas resolved to full ones (an unknown sha is dropped, not an error)
  const resolved = [];
  for (const sha of listed) {
    const full = await git(repoPath, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]);
    if (full && full.trim()) resolved.push(full.trim());
  }
  const shas = [...new Set([...resolved, ...found])];
  if (shas.length === 0) {
    cache.set(key, { at: Date.now(), data: null });
    return null;
  }

  const out = await git(repoPath, ['show', '--numstat', '--no-renames', '--format=<COMMIT>%H%x1f%s%x1f%aI%x1f%an', ...shas]);
  // Oldest first; commits from the same second keep git's own order (git log lists newest first)
  const order = new Map([...found].reverse().map((sha, i) => [sha, i]));
  const commits = parseShow(out).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || (order.get(a.oid) ?? -1) - (order.get(b.oid) ?? -1));
  const files = aggregate(commits);
  const data = {
    source: 'commits',
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    changed_files: files.length,
    commits: commits.map(c => ({
      oid: c.oid,
      abbreviated_oid: c.oid.slice(0, 7),
      message_headline: c.subject.trim(),
      authored_date: c.date,
      author: c.author ? { login: null, name: c.author } : null,
      files: c.files.length,
    })),
    files,
    fetched_at: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

function clearTaskCommitsCache() {
  cache.clear();
}

module.exports = { getTaskCommitChanges, clearTaskCommitsCache, parseShow, aggregate, cleanShas, grepLiteral };
