const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { SETTINGS_FILE } = require('./constants');
const { logger } = require('./logger');
const registry = require('./projectRegistry');

const execFileP = promisify(execFile);

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function loadWorkingDirectory() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return settings.workingDirectory || '';
  } catch {
    return '';
  }
}

function resolveProjectRepoPath(projectIdOrName) {
  const proj = registry.resolve(projectIdOrName);
  if (!proj || proj.folder === 'Root') return null;
  const wd = loadWorkingDirectory();
  if (!wd) return null;
  const repoPath = path.join(wd, proj.folder);
  if (!fs.existsSync(path.join(repoPath, '.git'))) return null;
  return repoPath;
}

function parseGithubRemote(url) {
  if (!url) return null;
  const trimmed = url.trim();
  // Match git@github.com:owner/repo.git OR https://github.com/owner/repo(.git)
  const ssh = trimmed.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const https = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

async function gitOutput(repoPath, args, opts = {}) {
  try {
    const { stdout } = await execFileP('git', args, { cwd: repoPath, maxBuffer: 8 * 1024 * 1024, ...opts });
    return stdout;
  } catch (err) {
    logger.warn({ err: err.message, args }, 'git command failed');
    return null;
  }
}

async function ghOutput(repoPath, args) {
  try {
    const { stdout } = await execFileP('gh', args, { cwd: repoPath, maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (err) {
    logger.warn({ err: err.message, args }, 'gh command failed');
    return null;
  }
}

async function getRemote(repoPath) {
  const out = await gitOutput(repoPath, ['remote', 'get-url', 'origin']);
  return parseGithubRemote(out);
}

async function getBranches(repoPath) {
  const fmt = '%(refname:short)|%(committerdate:iso-strict)|%(objectname:short)|%(subject)';
  const out = await gitOutput(repoPath, ['for-each-ref', `--format=${fmt}`, 'refs/heads']);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map(line => {
    const [name, date, sha, ...rest] = line.split('|');
    return { name, date, sha, subject: rest.join('|') };
  });
}

async function getPullRequests(repoPath) {
  const out = await ghOutput(repoPath, [
    'pr', 'list',
    '--state', 'all',
    '--limit', '200',
    '--json', 'number,title,headRefName,url,state,updatedAt,reviewDecision,isDraft,mergeStateStatus,statusCheckRollup'
  ]);
  if (!out) return [];
  try {
    return JSON.parse(out);
  } catch (err) {
    logger.warn({ err: err.message }, 'gh pr list returned non-JSON');
    return [];
  }
}

// Match a branch name to a task id. Convention: branch name contains the task id
// as a substring (case-insensitive). Longer ids are preferred over shorter ones
// to avoid e.g. "feat-x-001" matching "feat-x-001-followup" task ambiguity.
function matchBranchToTaskId(branchName, taskIds) {
  const lower = branchName.toLowerCase();
  let best = null;
  for (const id of taskIds) {
    if (lower.includes(id.toLowerCase())) {
      if (!best || id.length > best.length) best = id;
    }
  }
  return best;
}

// Parse `github_pr_url` (https://github.com/owner/repo/pull/NNN) -> integer, or null
function parsePrNumberFromUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(/\/pull\/(\d+)\b/);
  return m ? Number(m[1]) : null;
}

// Derive a single CI state from gh's `statusCheckRollup` array.
// Each entry has a `conclusion` (SUCCESS/FAILURE/CANCELLED/SKIPPED/NEUTRAL/TIMED_OUT/
// ACTION_REQUIRED) or a `status` (QUEUED/IN_PROGRESS/COMPLETED/PENDING).
// Rules: any failure-like outcome -> FAILURE; any in-flight check -> PENDING;
// every check green (or no blocking checks) -> SUCCESS. Empty / missing -> null.
function deriveCiStatus(checks) {
  if (!Array.isArray(checks) || checks.length === 0) return null;
  let anyPending = false;
  let anyNonSuccessTerminal = false;
  let anyTerminalSuccess = false;
  for (const c of checks) {
    const conclusion = (c.conclusion || '').toUpperCase();
    const state = (c.state || c.status || '').toUpperCase();
    // In-flight work
    if (!conclusion && (state === 'IN_PROGRESS' || state === 'QUEUED' || state === 'PENDING' || state === 'EXPECTED' || state === 'WAITING')) {
      anyPending = true;
      continue;
    }
    // Terminal outcomes
    if (conclusion === 'SUCCESS') { anyTerminalSuccess = true; continue; }
    if (conclusion === 'SKIPPED' || conclusion === 'NEUTRAL') continue; // treat as pass-through
    if (conclusion === 'FAILURE' || conclusion === 'CANCELLED' || conclusion === 'TIMED_OUT' || conclusion === 'ACTION_REQUIRED' || conclusion === 'STARTUP_FAILURE') {
      anyNonSuccessTerminal = true;
      continue;
    }
    // Unknown shape — treat as pending rather than claim green
    if (!conclusion && state !== 'COMPLETED') anyPending = true;
  }
  if (anyNonSuccessTerminal) return 'FAILURE';
  if (anyPending) return 'PENDING';
  if (anyTerminalSuccess) return 'SUCCESS';
  return null;
}

function buildEntryFromBranch(br, pr, remote) {
  return {
    branch: br.name,
    branch_url: remote ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(br.name)}` : null,
    branch_date: br.date,
    branch_sha: br.sha,
    branch_subject: br.subject,
    branch_missing: false,
    pr_number: pr ? pr.number : null,
    pr_url: pr ? pr.url : null,
    pr_state: pr ? pr.state : null,
    pr_title: pr ? pr.title : null,
    // `reviewDecision` is one of 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'
    // or '' (empty) when no reviews yet. Older gh versions may omit the field entirely.
    review_decision: pr && pr.reviewDecision ? pr.reviewDecision : null,
    is_draft: pr ? pr.isDraft === true : false,
    // CLEAN | BEHIND | BLOCKED | DIRTY | DRAFT | UNSTABLE | HAS_HOOKS | UNKNOWN
    merge_state: pr && pr.mergeStateStatus ? pr.mergeStateStatus : null,
    // Derived: SUCCESS | FAILURE | PENDING | null
    ci_status: pr ? deriveCiStatus(pr.statusCheckRollup) : null,
  };
}

function buildEntryFromPrOnly(pr, remote) {
  return {
    branch: pr.headRefName,
    branch_url: remote ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(pr.headRefName)}` : null,
    branch_date: pr.updatedAt,
    branch_sha: null,
    branch_subject: pr.title,
    branch_missing: false,
    pr_number: pr.number,
    pr_url: pr.url,
    pr_state: pr.state,
    pr_title: pr.title,
    review_decision: pr.reviewDecision || null,
    is_draft: pr.isDraft === true,
    merge_state: pr.mergeStateStatus || null,
    ci_status: deriveCiStatus(pr.statusCheckRollup),
  };
}

// Explicit override — task has `github_branch` and/or `github_pr_url` in frontmatter.
// The override always wins. If the named branch doesn't exist locally AND no matching PR
// is found, we still emit an entry with `branch_missing: true` so the UI can render a
// muted "linked but missing" badge instead of silently falling back to substring match.
function buildEntryFromOverride(task, branchesByName, prsByBranch, prsByNumber, remote) {
  const explicitBranch = task.github_branch || null;
  const explicitPrNum = parsePrNumberFromUrl(task.github_pr_url);

  let branchName = explicitBranch;
  let pr = null;

  if (explicitPrNum != null) {
    pr = prsByNumber.get(explicitPrNum) || null;
    if (pr && !branchName) branchName = pr.headRefName;
  }

  if (branchName && !pr) pr = prsByBranch.get(branchName) || null;

  if (!branchName && !pr) return null; // nothing to link

  const br = branchName ? branchesByName.get(branchName) : null;
  if (br) return buildEntryFromBranch(br, pr, remote);
  if (pr) {
    // Branch name isn't local; fall through to PR-only shape which still carries branch info
    const entry = buildEntryFromPrOnly(pr, remote);
    // If the override named a branch different from the PR's headRefName, honor the override
    if (branchName && branchName !== pr.headRefName) {
      entry.branch = branchName;
      entry.branch_url = remote
        ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(branchName)}`
        : null;
    }
    return entry;
  }
  // Neither local branch nor PR exists — emit a "missing" marker so the UI can show
  // a muted badge and the user sees their override is in place but unresolved.
  return {
    branch: branchName,
    branch_url: remote ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(branchName)}` : null,
    branch_date: null,
    branch_sha: null,
    branch_subject: null,
    branch_missing: true,
    pr_number: explicitPrNum || null,
    pr_url: task.github_pr_url || null,
    pr_state: null,
    pr_title: null,
    review_decision: null,
    is_draft: false,
    merge_state: null,
    ci_status: null,
  };
}

async function buildLinks(repoPath, tasks) {
  const [remote, branches, prs] = await Promise.all([
    getRemote(repoPath),
    getBranches(repoPath),
    getPullRequests(repoPath),
  ]);

  const branchesByName = new Map(branches.map(b => [b.name, b]));
  const prsByBranch = new Map();
  const prsByNumber = new Map();
  for (const pr of prs) {
    prsByBranch.set(pr.headRefName, pr);
    prsByNumber.set(pr.number, pr);
  }

  const byTaskId = {};
  const detached = [];

  // Pass 1: explicit overrides from task frontmatter. A claimed task-id is taken out of
  // the substring-match pool so Pass 2 doesn't double-link a branch to two tasks.
  const overriddenIds = new Set();
  const claimedBranches = new Set();
  for (const task of tasks) {
    if (!task.github_branch && !task.github_pr_url) continue;
    const entry = buildEntryFromOverride(task, branchesByName, prsByBranch, prsByNumber, remote);
    if (entry) {
      byTaskId[task.id] = entry;
      overriddenIds.add(task.id);
      if (entry.branch) claimedBranches.add(entry.branch);
    }
  }

  // Pass 2: substring fallback over branches that weren't claimed by an override,
  // against task ids that weren't claimed by an override.
  const fallbackIds = tasks.filter(t => !overriddenIds.has(t.id)).map(t => t.id);
  for (const br of branches) {
    if (claimedBranches.has(br.name)) continue;
    const taskId = matchBranchToTaskId(br.name, fallbackIds);
    const pr = prsByBranch.get(br.name);
    const entry = buildEntryFromBranch(br, pr, remote);
    if (taskId) {
      byTaskId[taskId] = entry;
    } else {
      detached.push(entry);
    }
  }

  // Pass 3: consider PRs by themselves. Two cases:
  //   a. PR's branch was deleted locally — surface it so the row shows something.
  //   b. PR's branch matches a task via substring, but Pass 2 already claimed the
  //      task with a DIFFERENT branch whose PR is MERGED/CLOSED. An OPEN PR for
  //      the same task should win over a stale merged/closed one — otherwise
  //      follow-up work (reverts, v2 branches) never surfaces on the row.
  for (const pr of prs) {
    if (claimedBranches.has(pr.headRefName)) continue;
    const taskId = matchBranchToTaskId(pr.headRefName, fallbackIds);
    if (!taskId) continue;
    const existing = byTaskId[taskId];
    if (!existing) {
      byTaskId[taskId] = buildEntryFromPrOnly(pr, remote);
      continue;
    }
    // Existing entry (from Pass 2) has a non-OPEN PR or no PR at all; promote
    // this OPEN PR to the row. Demote the old entry into `detached` so it isn't lost.
    if (pr.state === 'OPEN' && existing.pr_state !== 'OPEN') {
      detached.push(existing);
      byTaskId[taskId] = buildEntryFromPrOnly(pr, remote);
    }
  }

  return {
    repo: remote,
    repo_url: remote ? `https://github.com/${remote.owner}/${remote.repo}` : null,
    by_task_id: byTaskId,
    detached,
    fetched_at: new Date().toISOString(),
  };
}

// `tasks` is an array of minimal task projections: { id, github_branch?, github_pr_url? }.
// Callers that still have the old (just-ids) shape are auto-wrapped for backward compat.
async function getLinks(projectIdOrName, tasks, { refresh = false } = {}) {
  const repoPath = resolveProjectRepoPath(projectIdOrName);
  if (!repoPath) {
    return { repo: null, repo_url: null, by_task_id: {}, detached: [], fetched_at: new Date().toISOString(), reason: 'no_git_repo' };
  }

  // Backward compat: accept a plain string[] of ids
  const normalizedTasks = Array.isArray(tasks)
    ? tasks.map(t => (typeof t === 'string' ? { id: t } : t)).filter(t => t && t.id)
    : [];

  const cacheKey = repoPath;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await buildLinks(repoPath, normalizedTasks);
  cache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

function clearCache() {
  cache.clear();
}

// ---- Per-PR changes (commits + files + diff stats) --------------------
// Second cache layer keyed by `${repoPath}#${prNumber}` with same 5-min TTL.
// Kept separate from the links cache so clearing one doesn't invalidate the other.
const changesCache = new Map();

async function getPrChanges(projectIdOrName, prNumber, { refresh = false } = {}) {
  const repoPath = resolveProjectRepoPath(projectIdOrName);
  if (!repoPath) {
    return { error: 'no_git_repo' };
  }
  if (!prNumber) {
    return { error: 'no_pr' };
  }

  const cacheKey = `${repoPath}#${prNumber}`;
  const cached = changesCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const out = await ghOutput(repoPath, [
    'pr', 'view', String(prNumber),
    '--json', 'number,title,url,headRefName,baseRefName,commits,files,additions,deletions,changedFiles',
  ]);
  if (!out) {
    return { error: 'gh_failed' };
  }
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (err) {
    logger.warn({ err: err.message }, 'gh pr view returned invalid JSON');
    return { error: 'parse_failed' };
  }

  // Shape the response into a stable contract the frontend can render without
  // having to know about `gh`'s exact field names.
  const data = {
    pr_number: parsed.number,
    pr_title: parsed.title,
    pr_url: parsed.url,
    head_branch: parsed.headRefName,
    base_branch: parsed.baseRefName,
    additions: parsed.additions ?? 0,
    deletions: parsed.deletions ?? 0,
    changed_files: parsed.changedFiles ?? (parsed.files ? parsed.files.length : 0),
    commits: (parsed.commits || []).map(c => ({
      oid: c.oid,
      abbreviated_oid: (c.oid || '').slice(0, 7),
      message_headline: (c.messageHeadline || '').trim(),
      authored_date: c.authoredDate || null,
      author: c.authors && c.authors[0]
        ? { login: c.authors[0].login || null, name: c.authors[0].name || null }
        : null,
    })),
    files: (parsed.files || []).map(f => ({
      path: f.path,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
    })),
    fetched_at: new Date().toISOString(),
  };

  changesCache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

function clearChangesCache() {
  changesCache.clear();
}

// ---- Open issues (feat-loops-watch-types-001) -------------------------
// Reuses the links `cache` map under an `issues#<repo>` key (same 5-min TTL)
// so the loop engine's issue polling is rate-limit friendly. Returns open
// issues only — the engine turns previously-unseen ones into draft tasks.
async function getIssues(projectIdOrName, { refresh = false } = {}) {
  const repoPath = resolveProjectRepoPath(projectIdOrName);
  if (!repoPath) return { issues: [], reason: 'no_git_repo', fetched_at: new Date().toISOString() };

  const cacheKey = `issues#${repoPath}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.data;

  const out = await ghOutput(repoPath, [
    'issue', 'list',
    '--state', 'open',
    '--limit', '200',
    '--json', 'number,title,url,updatedAt,state,labels',
  ]);
  let issues = [];
  if (out) {
    try { issues = JSON.parse(out); } catch (err) { logger.warn({ err: err.message }, 'gh issue list returned non-JSON'); }
  }
  const data = { issues, fetched_at: new Date().toISOString() };
  cache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

module.exports = {
  getLinks,
  clearCache,
  getPrChanges,
  clearChangesCache,
  getIssues,
  parseGithubRemote,
  parsePrNumberFromUrl,
  matchBranchToTaskId,
  resolveProjectRepoPath,
};
