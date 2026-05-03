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

function findLatestRunForSpec(specFile) {
  // Walk all tasks; for each, look at e2e_run.specs[].file. Pick the task
  // whose run is most recent (by started_at). Returns null if none found.
  let latest = null;
  let latestTs = 0;
  let tasks;
  try {
    tasks = getAllTasks();
  } catch {
    return null;
  }
  for (const task of tasks) {
    const run = task.e2e_run;
    if (!run || !Array.isArray(run.specs)) continue;
    if (!run.specs.some((s) => s && s.file === specFile)) continue;
    const ts = run.started_at ? Date.parse(run.started_at) : 0;
    if (ts > latestTs) {
      latestTs = ts;
      latest = {
        task_id: task.id,
        run_id: run.run_id || null,
        status: task.e2e_status || null,
        started_at: run.started_at || null,
      };
    }
  }
  return latest;
}

function listDemos() {
  const slugs = listDemoDirs();
  const specsBySlug = listSpecsBySlug();
  const out = [];
  for (const slug of slugs) {
    const dir = path.join(PUBLIC_DIR, slug);
    const indexPath = path.join(dir, 'index.html');
    let last_modified = null;
    try {
      last_modified = fs.statSync(indexPath).mtime.toISOString();
    } catch { /* ignore */ }
    const spec_file = specsBySlug.get(slug) || null;
    out.push({
      slug,
      title: extractTitle(indexPath) || slug,
      path: `/${slug}/index.html`,
      last_modified,
      has_index: true,
      spec_file,
      latest_run: spec_file ? findLatestRunForSpec(spec_file) : null,
    });
  }
  out.sort((a, b) => a.slug.localeCompare(b.slug));
  return out;
}

module.exports = { listDemos };
