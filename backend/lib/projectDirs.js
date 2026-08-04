// Project → source-directory resolution + filesystem jail for the Files API
// (feat-project-hub-impl-001).
//
// Nothing in the registry linked a board project to a folder on disk before
// this. Measured on the real 14-project registry (2026-08-03): exact
// case-insensitive name matching finds 8, normalized matching (lowercase,
// spaces/hyphens/underscores stripped: 'Atrium 2' → atrium2,
// 'GitHub Collab Manager' → gh-collab-manager) finds 10, and 4 projects
// have no folder at all. So resolution is:
//
//   1. An explicit `directory` field on the projects.json entry — absolute,
//      or relative to the workspace root. Always wins.
//   2. Normalized-name match against the workspace root's directories.
//   3. Nothing — the project is honestly "not linked", never guessed twice.
//
// Everything is injectable (fs, listing) so the logic is unit-tested without
// touching the real workspace.

const fs = require('fs');
const path = require('path');

/** lowercase + strip spaces/hyphens/underscores — 'Atrium 2' === 'atrium2' */
function normalizeSlug(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_]/g, '');
}

/** Directory names directly under the workspace root. */
function listWorkspaceDirs(workingDirectory, fsMod = fs) {
  try {
    return fsMod.readdirSync(workingDirectory, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Resolve one registry entry to a source directory.
 * @returns {{ root: string|null, source: 'directory-field'|'name-match'|null }}
 */
function resolveProjectDir(entry, workingDirectory, dirs, fsMod = fs) {
  if (!entry || !workingDirectory) return { root: null, source: null };

  if (entry.directory) {
    const root = path.isAbsolute(entry.directory)
      ? entry.directory
      : path.join(workingDirectory, entry.directory);
    try {
      if (fsMod.statSync(root).isDirectory()) return { root, source: 'directory-field' };
    } catch { /* fall through — a bad field must not shadow the heuristic */ }
    return { root: null, source: null };
  }

  const candidates = dirs || listWorkspaceDirs(workingDirectory, fsMod);
  const wantedExact = String(entry.folder || entry.name || '').toLowerCase();
  const wantedSlug = normalizeSlug(entry.folder || entry.name);
  if (!wantedSlug) return { root: null, source: null };

  const hit = candidates.find((d) => d.toLowerCase() === wantedExact)
    || candidates.find((d) => normalizeSlug(d) === wantedSlug);
  if (hit) return { root: path.join(workingDirectory, hit), source: 'name-match' };
  return { root: null, source: null };
}

// Names never listed, previewed, or zipped unless explicitly requested
// (?all=1 re-lists; zips NEVER include them — a source-only atrium zip was
// 259MB before test-results joined this list, and the 2026-08-03 disk audit
// found 12GB target/ and 6GB node_modules inside these very folders).
const IGNORED_NAMES = new Set([
  '.git', 'node_modules', 'target', 'dist', 'build', 'coverage',
  'test-results', 'playwright-report', '__pycache__', '.venv', 'venv',
]);

/**
 * The jail: resolve `rel` under `root` and confirm the REAL path (symlinks
 * followed) still lives inside the REAL root. safePath alone stops `..`
 * traversal; the realpath check stops a symlink inside the workspace from
 * walking out of it.
 * @returns absolute real path, or null when it escapes / does not exist.
 */
function containedRealPath(root, rel, fsMod = fs) {
  const resolved = path.resolve(root, rel || '.');
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) return null;
  try {
    const realRoot = fsMod.realpathSync(normalizedRoot);
    const real = fsMod.realpathSync(resolved);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
    return real;
  } catch {
    return null; // nonexistent or unreadable — the caller 404s
  }
}

module.exports = { normalizeSlug, listWorkspaceDirs, resolveProjectDir, containedRealPath, IGNORED_NAMES };
