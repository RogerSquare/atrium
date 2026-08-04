// Read-only project file browsing (feat-project-hub-impl-001).
//
// Powers the Files view: list a directory, preview a text file, download a
// file, download a whole project as a zip. Strictly read-only — there is no
// write/rename/delete surface, deliberately.
//
// Security posture (stricter than the preview proxy — this serves source):
//   - requireAuth is applied at the mount in server.js.
//   - Every path goes through containedRealPath (lib/projectDirs.js): resolve
//     under the project root, then confirm the REAL path — symlinks followed
//     — is still inside the REAL root. `..` and junction escapes both die.
//   - Listings never recurse; one directory per request.
//   - IGNORED_NAMES (.git, node_modules, target, dist) are hidden unless
//     ?all=1, and are NEVER included in zips: a "download project" is source
//     code, not 12GB of build cache (measured on this very workspace).

const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { SETTINGS_FILE } = require('../lib/constants');
const registry = require('../lib/projectRegistry');
const { resolveProjectDir, listWorkspaceDirs, containedRealPath, resolveTaskPath, IGNORED_NAMES } = require('../lib/projectDirs');
const { logger } = require('../lib/logger');

const router = express.Router();

const PREVIEW_LIMIT = 256 * 1024; // bytes

function workingDirectory() {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
    return settings.workingDirectory || null;
  } catch {
    return null;
  }
}

// Resolve a project param to its jailed root. Writes the error response
// itself and returns null when the project is unknown or unlinked.
function rootFor(req, res) {
  const wd = workingDirectory();
  if (!wd) {
    res.status(409).json({ error: 'No working directory configured — set it in Settings first' });
    return null;
  }
  const project = registry.resolve(String(req.query.project || ''));
  if (!project) {
    res.status(404).json({ error: 'Unknown project' });
    return null;
  }
  const { root } = resolveProjectDir(project, wd);
  if (!root) {
    res.status(404).json({ error: 'Project has no linked folder', hint: 'Set a "directory" on the project to link one' });
    return null;
  }
  return root;
}

// GET /api/files/projects — which projects have a browsable folder.
// Only jail-relative info leaves the server: linked flag + how it resolved.
router.get('/projects', (req, res) => {
  try {
    const wd = workingDirectory();
    if (!wd) return res.json({ configured: false, projects: [] });
    const dirs = listWorkspaceDirs(wd);
    const projects = Object.entries(registry.getAll({ include: 'active' })).map(([id, entry]) => {
      const { root, source } = resolveProjectDir(entry, wd, dirs);
      return { id, project: entry.name || entry.folder, folder: entry.folder, linked: !!root, source };
    });
    res.json({ configured: true, projects });
  } catch (error) {
    logger.error({ err: error }, 'files/projects failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/list?project=&path=&all=1 — ONE directory, never recursive.
router.get('/list', (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const rel = String(req.query.path || '');
    const abs = containedRealPath(root, rel);
    if (!abs) return res.status(404).json({ error: 'Not found' });
    if (!fs.statSync(abs).isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const showAll = req.query.all === '1';
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      // Symlinks are neither traversable nor listed — the jail refuses to
      // follow them anyway, so showing them would be a dead affordance.
      .filter((d) => !d.isSymbolicLink())
      .filter((d) => showAll || !IGNORED_NAMES.has(d.name))
      .map((d) => {
        const st = fs.statSync(path.join(abs, d.name));
        return {
          name: d.name,
          type: d.isDirectory() ? 'dir' : 'file',
          size: d.isDirectory() ? null : st.size,
          mtime: st.mtimeMs,
          ignored: IGNORED_NAMES.has(d.name),
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

    res.json({ path: rel, entries });
  } catch (error) {
    logger.error({ err: error }, 'files/list failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/content?project=&path= — text preview, capped.
router.get('/content', (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const abs = containedRealPath(root, String(req.query.path || ''));
    if (!abs) return res.status(404).json({ error: 'Not found' });
    const st = fs.statSync(abs);
    if (!st.isFile()) return res.status(400).json({ error: 'Not a file' });
    if (st.size > PREVIEW_LIMIT) {
      return res.status(413).json({ error: `File too large to preview (${st.size} bytes, limit ${PREVIEW_LIMIT})` });
    }
    const buf = fs.readFileSync(abs);
    // Null byte in the first 8KB = binary. Same sniff git uses.
    if (buf.subarray(0, 8192).includes(0)) {
      return res.status(415).json({ error: 'Binary file — download it instead' });
    }
    res.type('text/plain').send(buf.toString('utf-8'));
  } catch (error) {
    logger.error({ err: error }, 'files/content failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/download?project=&path= — one file, streamed attachment.
router.get('/download', (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const abs = containedRealPath(root, String(req.query.path || ''));
    if (!abs) return res.status(404).json({ error: 'Not found' });
    if (!fs.statSync(abs).isFile()) return res.status(400).json({ error: 'Not a file' });
    res.download(abs, path.basename(abs));
  } catch (error) {
    logger.error({ err: error }, 'files/download failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/archive?project= — the whole project as a zip stream.
// Ignored dirs are excluded UNCONDITIONALLY (no ?all here): source, not caches.
router.get('/archive', (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const name = path.basename(root);
    res.attachment(`${name}.zip`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      logger.error({ err }, 'files/archive stream failed');
      if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
      else res.destroy();
    });
    archive.pipe(res);
    archive.directory(root, name, (entry) => {
      const parts = entry.name.split(/[\\/]/);
      return parts.some((p) => IGNORED_NAMES.has(p)) ? false : entry;
    });
    archive.finalize();
  } catch (error) {
    logger.error({ err: error }, 'files/archive failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/files/resolve-paths?project= — batch-resolve task files_affected
// entries against the real tree (feat-files-tasks-impl-001). Read-only
// existence checks through the same jail as everything else; powers the
// Files view's "which tasks touched this file" join, whose normalization
// (stale-prefix rescue) needs filesystem truth the lazy client tree lacks.
const RESOLVE_CAP = 2000;
router.post('/resolve-paths', (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const paths = req.body && req.body.paths;
    if (!Array.isArray(paths)) return res.status(400).json({ error: 'paths must be an array' });
    if (paths.length > RESOLVE_CAP) return res.status(400).json({ error: `Too many paths (max ${RESOLVE_CAP})` });

    const resolutions = {};
    for (const raw of paths) {
      if (typeof raw !== 'string' || raw.includes('\0')) continue;
      if (!(raw in resolutions)) resolutions[raw] = resolveTaskPath(root, raw);
    }
    res.json({ resolutions });
  } catch (error) {
    logger.error({ err: error }, 'files/resolve-paths failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/files/pr-diff?project=&pr=&path= — one file's patch from a PR
// (feat-files-pr-diff-001). Powers the Change History panel's diff view.
// The patch text comes from GitHub's own API, never from local file reads,
// so the jail is only needed to confirm the project resolves at all.
const github = require('../lib/github');
router.get('/pr-diff', async (req, res) => {
  try {
    const root = rootFor(req, res);
    if (!root) return;
    const prNumber = Number.parseInt(String(req.query.pr || ''), 10);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      return res.status(400).json({ error: 'pr must be a positive integer' });
    }
    const relPath = String(req.query.path || '').trim();
    if (!relPath || relPath.includes('\0')) return res.status(400).json({ error: 'path is required' });

    const result = await github.getPrFiles(String(req.query.project || ''), prNumber);
    if (result.error) {
      const msg = { no_git_repo: 'Project has no git repo', no_pr: 'Invalid PR', gh_failed: 'GitHub request failed', parse_failed: 'GitHub response unreadable' }[result.error] || 'GitHub request failed';
      return res.status(result.error === 'no_git_repo' ? 404 : 502).json({ error: msg });
    }
    const file = github.findPrFile(result.files, relPath);
    if (!file) return res.status(404).json({ error: `PR #${prNumber} did not change this file` });

    res.json({
      pr_number: prNumber,
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch: file.patch, // null when GitHub omitted it (huge files) — client links out
    });
  } catch (error) {
    logger.error({ err: error }, 'files/pr-diff failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
