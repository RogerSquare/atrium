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
    '--json', 'number,title,headRefName,url,state,updatedAt'
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

async function buildLinks(repoPath, taskIds) {
  const [remote, branches, prs] = await Promise.all([
    getRemote(repoPath),
    getBranches(repoPath),
    getPullRequests(repoPath),
  ]);

  const prByBranch = new Map();
  for (const pr of prs) prByBranch.set(pr.headRefName, pr);

  const byTaskId = {};
  const detached = [];

  for (const br of branches) {
    const taskId = matchBranchToTaskId(br.name, taskIds);
    const pr = prByBranch.get(br.name);
    const branchUrl = remote ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(br.name)}` : null;
    const entry = {
      branch: br.name,
      branch_url: branchUrl,
      branch_date: br.date,
      branch_sha: br.sha,
      branch_subject: br.subject,
      pr_number: pr ? pr.number : null,
      pr_url: pr ? pr.url : null,
      pr_state: pr ? pr.state : null,
      pr_title: pr ? pr.title : null,
    };
    if (taskId) {
      byTaskId[taskId] = entry;
    } else {
      detached.push(entry);
    }
  }

  // Surface PRs whose branch was deleted locally but still exist on GitHub
  for (const pr of prs) {
    if (prByBranch.has(pr.headRefName) && byTaskId[matchBranchToTaskId(pr.headRefName, taskIds)]) continue;
    const taskId = matchBranchToTaskId(pr.headRefName, taskIds);
    if (taskId && !byTaskId[taskId]) {
      byTaskId[taskId] = {
        branch: pr.headRefName,
        branch_url: remote ? `https://github.com/${remote.owner}/${remote.repo}/tree/${encodeURIComponent(pr.headRefName)}` : null,
        branch_date: pr.updatedAt,
        branch_sha: null,
        branch_subject: pr.title,
        pr_number: pr.number,
        pr_url: pr.url,
        pr_state: pr.state,
        pr_title: pr.title,
      };
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

async function getLinks(projectIdOrName, taskIds, { refresh = false } = {}) {
  const repoPath = resolveProjectRepoPath(projectIdOrName);
  if (!repoPath) {
    return { repo: null, repo_url: null, by_task_id: {}, detached: [], fetched_at: new Date().toISOString(), reason: 'no_git_repo' };
  }

  const cacheKey = repoPath;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await buildLinks(repoPath, taskIds);
  cache.set(cacheKey, { fetchedAt: Date.now(), data });
  return data;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  getLinks,
  clearCache,
  parseGithubRemote,
  matchBranchToTaskId,
  resolveProjectRepoPath,
};
