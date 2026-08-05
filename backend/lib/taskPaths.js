const path = require('path');
const { TASKS_DIR } = require('./constants');
const { sanitizeFilename } = require('./sanitize');

/**
 * Task-tree path rules (feat-workspace-folders-impl-001).
 *
 * The on-disk layout is tasks/<WorkspaceDir>/<ProjectFolder>/<task>.md, with
 * Root task files loose at the top level. This module is the ONLY place that
 * knows those rules — everything else asks it where a project's tasks live
 * (projectTaskDir) or which project a file belongs to (deriveProject).
 *
 * `task.project` stays the BARE project folder name everywhere (wire format,
 * filters, frontend) — the workspace directory is purely organizational.
 * That is the load-bearing decision from feat-workspace-folders-research-001:
 * every consumer compares task.project === projects[].folder, and a
 * path-shaped value would silently break all of them.
 *
 * Registries are required lazily inside each function: projectRegistry
 * top-requires workspaceRegistry, and both will call back into this module,
 * so top-level requires here would cycle.
 */

// Workspace name → directory name. Same sanitization as project-folder
// creation (routes/projects.js): strip exotic characters, collapse spaces to
// hyphens. Falls back to the workspace id when a name sanitizes to nothing
// (e.g. all-emoji). Pure — usable by workspaceRegistry's collision guard.
function sanitizeWorkspaceDirName(name, fallbackId) {
  const cleaned = String(name || '').replace(/[^a-zA-Z0-9-_ ]/g, '-').replace(/\s+/g, '-');
  const safe = sanitizeFilename(cleaned);
  // A name with no alphanumeric content (all emoji, all punctuation)
  // sanitizes to filler like '----' — fall back to the stable id instead.
  return /[a-zA-Z0-9]/.test(safe) ? safe : fallbackId;
}

function workspaceDirName(workspaceId) {
  const workspaceRegistry = require('./workspaceRegistry');
  const ws = workspaceRegistry.getById(workspaceId)
    || workspaceRegistry.getById(workspaceRegistry.DEFAULT_WORKSPACE_ID);
  if (!ws) return 'Personal';
  return sanitizeWorkspaceDirName(ws.name, ws.id);
}

// Where a project's task files live. Root is the TASKS_DIR top level; a
// folder the registry doesn't know resolves under the default workspace —
// the same never-vanish rule the client uses.
function projectTaskDir(folder) {
  if (!folder || folder === 'Root') return TASKS_DIR;
  const projectRegistry = require('./projectRegistry');
  const entry = projectRegistry.getByFolder(folder);
  const wsId = (entry && entry.workspace) || 'personal';
  return path.join(TASKS_DIR, workspaceDirName(wsId), folder);
}

// Which project a task file belongs to, from its location alone:
//   depth 0 (loose in tasks/)            → Root
//   depth 1 (tasks/<dir>/file)           → <dir> if it is a registered project
//                                          folder (legacy flat layout), else
//                                          Root (a stray inside a workspace
//                                          dir makes no project claim)
//   depth 2+ (tasks/<ws>/<project>/file) → leaf directory name
// The depth-1 registry lookup only happens for files that are actually at
// depth 1 — after migration that is rare, so the scan hot path stays cheap.
function deriveProject(filePath) {
  const dir = path.dirname(filePath);
  if (path.resolve(dir) === path.resolve(TASKS_DIR)) return 'Root';
  const leaf = path.basename(dir);
  const parent = path.dirname(dir);
  if (path.resolve(parent) === path.resolve(TASKS_DIR)) {
    const projectRegistry = require('./projectRegistry');
    return projectRegistry.getByFolder(leaf) ? leaf : 'Root';
  }
  return leaf;
}

module.exports = { workspaceDirName, sanitizeWorkspaceDirName, projectTaskDir, deriveProject };
