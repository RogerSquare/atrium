// Pure read-only scanner for demo apps under frontend/public/<slug>/.
// See feat-demo-management-001-implement.
//
// Definition of a demo: any directory under frontend/public/ that contains
// an index.html. Demos with no matching spec are surfaced as "untested"
// rather than hidden — the UI decides whether to dim them.
//
// Cross-references:
//   - <slug>.spec.js under frontend/tests/e2e/  -> spec_file
//   - tasks whose e2e_run.specs[].file matches that spec -> latest_run
//
// No FS mutations. Safe to call on any GET request.

const fs = require('fs');
const path = require('path');
const { getAllTasks } = require('./tasks');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'frontend', 'public');
const SPECS_DIR = path.join(REPO_ROOT, 'frontend', 'tests', 'e2e');

// Cheap <title> extractor — avoid pulling in a full HTML parser. Good enough
// for hand-authored demo pages; falls back to slug if no <title> is found.
function extractTitle(htmlPath) {
  try {
    const head = fs.readFileSync(htmlPath, 'utf-8').slice(0, 2048);
    const m = head.match(/<title[^>]*>([^<]+)<\/title>/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

function listDemoDirs() {
  if (!fs.existsSync(PUBLIC_DIR)) return [];
  return fs.readdirSync(PUBLIC_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(PUBLIC_DIR, slug, 'index.html')));
}

function listSpecsBySlug() {
  if (!fs.existsSync(SPECS_DIR)) return new Map();
  const map = new Map();
  for (const f of fs.readdirSync(SPECS_DIR)) {
    if (!f.endsWith('.spec.js')) continue;
    const slug = f.replace(/\.spec\.js$/, '');
    map.set(slug, f);
  }
  return map;
}

// Returns up to MAX_TASK_HISTORY tasks whose e2e_run included the given
// spec file, newest-first. Each entry: { task_id, run_id, status, started_at }.
// Empty array when no runs exist. The first entry doubles as latest_run.
const MAX_TASK_HISTORY = 5;
function findTaskHistoryForSpec(specFile, tasks) {
  if (!tasks) return [];
  const matches = [];
  for (const task of tasks) {
    const run = task.e2e_run;
    if (!run || !Array.isArray(run.specs)) continue;
    if (!run.specs.some((s) => s && s.file === specFile)) continue;
    matches.push({
      task_id: task.id,
      run_id: run.run_id || null,
      status: task.e2e_status || null,
      started_at: run.started_at || null,
      project: task.project || null,
    });
  }
  matches.sort((a, b) => Date.parse(b.started_at || 0) - Date.parse(a.started_at || 0));
  return matches.slice(0, MAX_TASK_HISTORY);
}

function listDemos() {
  const slugs = listDemoDirs();
  const specsBySlug = listSpecsBySlug();
  let tasks = [];
  try { tasks = getAllTasks(); } catch { /* tasks layer unavailable; return demos with no linkage */ }
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(PUBLIC_DIR, slug);
    const indexPath = path.join(dir, 'index.html');
    let last_modified = null;
    try {
      last_modified = fs.statSync(indexPath).mtime.toISOString();
    } catch { /* ignore */ }
    const spec_file = specsBySlug.get(slug) || null;
    const task_history = spec_file ? findTaskHistoryForSpec(spec_file, tasks) : [];
    const latest_run = task_history[0]
      ? {
          task_id: task_history[0].task_id,
          run_id: task_history[0].run_id,
          status: task_history[0].status,
          started_at: task_history[0].started_at,
        }
      : null;
    out.push({
      slug,
      title: extractTitle(indexPath) || slug,
      path: `/${slug}/index.html`,
      last_modified,
      has_index: true,
      spec_file,
      // Project derives from the latest task that ran the spec. Demos
      // with no run history have project: null and bucket into Unassigned.
      project: task_history[0]?.project || null,
      latest_run,
      task_history,
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

// Group demos by service.group (which equals project name). Each group
// collects ALL services sharing that group (so Atrium's backend + frontend
// + web-shell all live under the "Atrium" card). Demos are filtered in by
// matching demo.project to group. A trailing "Unassigned" group catches
// demos whose project is null or doesn't match any service.group.
// Groups with no demos are still included so the frontend can decide
// whether to render them ("Show all services" toggle).
function groupBySservices(demos, services) {
  const byGroup = new Map(); // group name -> { group, services: [], demos: [] }
  for (const svc of services) {
    if (!byGroup.has(svc.group)) byGroup.set(svc.group, { group: svc.group, services: [], demos: [] });
    byGroup.get(svc.group).services.push(svc);
  }
  const unassigned = { group: 'Unassigned', services: [], demos: [] };
  for (const demo of demos) {
    const project = demo.project;
    if (project && byGroup.has(project)) {
      byGroup.get(project).demos.push(demo);
    } else {
      unassigned.demos.push(demo);
    }
  }
  const out = Array.from(byGroup.values()).sort((a, b) => a.group.localeCompare(b.group));
  if (unassigned.demos.length > 0) out.push(unassigned);
  return out;
}

module.exports = { listDemos, groupBySservices };
