const fs = require('fs');
const path = require('path');
const { TASKS_DIR } = require('./constants');
const { logger } = require('./logger');

/**
 * One-time flat → nested tasks-layout migration
 * (feat-workspace-folders-impl-001).
 *
 * Moves every registered ACTIVE project folder from the legacy flat
 * `tasks/<Project>` location into `tasks/<WorkspaceDir>/<Project>`. Runs at
 * boot (server.js), before the server starts listening.
 *
 * Safety properties:
 *  - Rename-only: same-volume fs.renameSync per folder, atomic, no copies,
 *    nothing deleted. Root .md files and the .archived/ tree are untouched.
 *  - Idempotent: a folder already at its nested home is skipped; re-running
 *    after a crash finishes the remainder.
 *  - Never clobbers: an existing destination logs a warning and skips.
 *  - Marker: writes `tasks/.layout-v2` when done. The dot prefix keeps it
 *    invisible to the task scanner. Its real job is the SHARED-MOUNT hazard:
 *    old-code instances must never run against the nested tree (their
 *    syncWithDisk would register workspace dirs as projects), so the
 *    lockstep upgrade runbook checks for this file.
 *
 * This also doubles as the crash reconciler for setWorkspace (disk moves
 * before the registry saves): the next boot simply finds the folder already
 * at a nested location and leaves it alone; projectTaskDir resolves through
 * the registry either way.
 */

const MARKER = path.join(TASKS_DIR, '.layout-v2');

function migrateTasksLayout() {
  if (fs.existsSync(MARKER)) return { migrated: 0, skipped: 0, alreadyDone: true };

  const projectRegistry = require('./projectRegistry');
  const { projectTaskDir } = require('./taskPaths');

  let migrated = 0;
  let skipped = 0;
  const all = projectRegistry.getAll({ include: 'active' });
  for (const [id, proj] of Object.entries(all)) {
    if (id === 'root') continue;
    const flat = path.join(TASKS_DIR, proj.folder);
    const nested = projectTaskDir(proj.folder);
    if (flat === nested) continue;
    if (!fs.existsSync(flat)) continue; // already moved, or no folder yet
    if (fs.existsSync(nested)) {
      logger.warn({ folder: proj.folder, nested }, 'Layout migration: destination exists, skipping');
      skipped++;
      continue;
    }
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.renameSync(flat, nested);
    migrated++;
  }

  fs.writeFileSync(
    MARKER,
    JSON.stringify({ version: 2, migrated_at: new Date().toISOString() }, null, 2),
    'utf8'
  );
  try { require('./tasks').invalidateCache(); } catch { /* not loaded yet at boot */ }
  logger.info({ migrated, skipped }, 'Tasks layout migrated to tasks/<Workspace>/<Project>');
  return { migrated, skipped, alreadyDone: false };
}

module.exports = { migrateTasksLayout, MARKER };
