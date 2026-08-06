#!/usr/bin/env node
// Audit every task markdown file under backend/tasks/ for schema correctness
// and indexability. Exits non-zero if any issues are found so CI can gate on it.
//
// Usage: npm run audit:tasks      (from the backend/ directory)
//    or: node scripts/audit-tasks.js

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

// Sourced from constants so the audit follows ATRIUM_DATA_DIR instead of
// auditing an empty backend/tasks/ when state lives on a mounted volume.
const { TASKS_DIR } = require('../lib/constants');

const VALID_STATUS = new Set(['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done']);
const VALID_PRIORITY = new Set(['low', 'medium', 'high']);
const VALID_TYPE = new Set(['frontend', 'backend', 'fullstack', 'devops']);
// `id` and `project` are derived from the filename and directory respectively by
// scanAllTasks, so they're not actually required in frontmatter. Mismatches are
// still flagged below under filename_id_mismatch / project_directory_mismatch.
const REQUIRED_FIELDS = ['title', 'status', 'priority', 'type'];

// {category}-{descriptor}-{number}: lowercase category, one or more descriptor
// segments, numeric suffix, plus an optional phased-task suffix (-research,
// -plan, -plan-implement). Examples: feat-auth-001, opt-task-audit-001,
// feat-terminal-claude-cli-001-plan-implement.
const ID_FORMAT_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)+-\d+(-(research|plan|plan-implement|implement))?$/;
// Auto-generated fallback from the backend when no id is supplied on create.
const AUTO_ID_RE = /^task-\d{10,}$/;

const findings = {
  parse_error: [],
  missing_field: [],
  invalid_status: [],
  invalid_priority: [],
  invalid_type: [],
  filename_id_mismatch: [],
  project_directory_mismatch: [],
  id_format_violation: [],
  auto_generated_id: [],
  empty_content: [],
  duplicate_id: [],
  orphaned_reference: []
};

const record = (bucket, filePath, detail) => {
  findings[bucket].push({ filePath: path.relative(TASKS_DIR, filePath), detail });
};

// Recursively collect every .md task file, skipping .history/.trash/other hidden dirs
// and the top-level readme.md.
const collectTaskFiles = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      collectTaskFiles(full, acc);
    } else if (entry.endsWith('.md') && entry.toLowerCase() !== 'readme.md') {
      acc.push(full);
    }
  }
  return acc;
};

const files = collectTaskFiles(TASKS_DIR);

// First pass: parse + per-file checks. Collect every successfully-parsed id so the
// orphan-reference pass in the second loop can resolve them.
const parsed = [];
const idToFiles = new Map();

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const rel = path.relative(TASKS_DIR, filePath);
  const filenameId = path.basename(filePath, '.md');

  let data, content;
  try {
    const result = matter(raw);
    data = result.data || {};
    content = result.content || '';
  } catch (err) {
    record('parse_error', filePath, err.message.split('\n')[0]);
    continue;
  }

  parsed.push({ filePath, rel, data, content, filenameId });

  const id = data.id || filenameId;
  if (!idToFiles.has(id)) idToFiles.set(id, []);
  idToFiles.get(id).push(filePath);

  for (const field of REQUIRED_FIELDS) {
    const value = data[field];
    const missing = value === undefined || value === null || value === '';
    if (missing) record('missing_field', filePath, field);
  }

  if (data.status !== undefined && !VALID_STATUS.has(data.status)) {
    record('invalid_status', filePath, `status=${JSON.stringify(data.status)}`);
  }
  if (data.priority !== undefined && !VALID_PRIORITY.has(data.priority)) {
    record('invalid_priority', filePath, `priority=${JSON.stringify(data.priority)}`);
  }
  if (data.type !== undefined && !VALID_TYPE.has(data.type)) {
    record('invalid_type', filePath, `type=${JSON.stringify(data.type)}`);
  }

  if (data.id !== undefined && data.id !== filenameId) {
    record('filename_id_mismatch', filePath, `frontmatter id=${JSON.stringify(data.id)} vs filename=${JSON.stringify(filenameId)}`);
  }

  // Only flag when frontmatter explicitly declares a project that disagrees with
  // the directory. A missing `project` field is fine — scanAllTasks derives it
  // from the directory path at runtime.
  if (data.project !== undefined && data.project !== null && data.project !== '') {
    const expectedProject = require('../lib/taskPaths').deriveProject(filePath);
    if (data.project !== expectedProject) {
      record('project_directory_mismatch', filePath, `declared=${JSON.stringify(data.project)} directory implies=${JSON.stringify(expectedProject)}`);
    }
  }

  if (AUTO_ID_RE.test(id)) {
    record('auto_generated_id', filePath, id);
  } else if (!ID_FORMAT_RE.test(id)) {
    record('id_format_violation', filePath, id);
  }

  if (!content || !content.trim()) {
    record('empty_content', filePath, 'body is empty');
  }
}

// Duplicate-id detection
for (const [id, paths] of idToFiles.entries()) {
  if (paths.length > 1) {
    record('duplicate_id', paths[0], `id=${JSON.stringify(id)} appears in ${paths.length} files: ${paths.map(p => path.relative(TASKS_DIR, p)).join(', ')}`);
  }
}

// Orphan reference detection — parent_task / depends_on must point at known ids.
const knownIds = new Set(parsed.map(p => p.data.id || p.filenameId));
for (const { filePath, data } of parsed) {
  if (data.parent_task && !knownIds.has(data.parent_task)) {
    record('orphaned_reference', filePath, `parent_task=${JSON.stringify(data.parent_task)} does not exist`);
  }
  if (Array.isArray(data.depends_on)) {
    for (const dep of data.depends_on) {
      if (dep && !knownIds.has(dep)) {
        record('orphaned_reference', filePath, `depends_on entry=${JSON.stringify(dep)} does not exist`);
      }
    }
  }
}

// Report
const totalFiles = files.length;
const totalIssues = Object.values(findings).reduce((n, arr) => n + arr.length, 0);

const label = {
  parse_error: 'Un-parseable frontmatter',
  missing_field: 'Missing required field',
  invalid_status: 'Invalid status',
  invalid_priority: 'Invalid priority',
  invalid_type: 'Invalid type',
  filename_id_mismatch: 'Filename / id mismatch',
  project_directory_mismatch: 'Project / directory mismatch',
  id_format_violation: 'ID format violation',
  auto_generated_id: 'Auto-generated id (task-<timestamp>)',
  empty_content: 'Empty content body',
  duplicate_id: 'Duplicate id across files',
  orphaned_reference: 'Orphaned parent_task / depends_on reference'
};

console.log(`Scanned ${totalFiles} task files under ${path.relative(process.cwd(), TASKS_DIR) || TASKS_DIR}`);
console.log(`Total issues: ${totalIssues}\n`);

for (const key of Object.keys(label)) {
  const items = findings[key];
  if (items.length === 0) continue;
  console.log(`## ${label[key]} (${items.length})`);
  for (const { filePath, detail } of items) {
    console.log(`  - ${filePath}: ${detail}`);
  }
  console.log('');
}

if (totalIssues === 0) {
  console.log('No issues found.');
  process.exit(0);
} else {
  process.exit(1);
}
