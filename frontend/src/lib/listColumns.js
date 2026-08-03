// List view column registry + visibility (ui-list-usability-001; slimmed by
// ui-list-redesign-impl-001).
//
// The default set follows the one-focal-element row: Title carries the id
// chip, PR dot, presence, and tree affordances, so the defaults are only the
// fields someone scans a list FOR — status, priority, owner, recency.
// Everything else stays a picker opt-in.
//
// Removed outright rather than hidden:
//   - `due_date` — populated on ZERO tasks when measured (2026-04, 769
//     tasks); a picker entry for a field nothing writes is dead weight.
//   - `id` as a COLUMN — the id now renders inside the Title cell (still
//     copyable), so a separate 32-wide column of mono noise is gone.
//   - `parent` — superseded by the Thread grouping, which shows lineage
//     structurally instead of as a raw id cell.
//
// Historical note: this file once ruled out a depends_on column because the
// field was "empty on all 769 tasks". Re-measured 2026-08: 24% non-empty and
// climbing (the phase-continuation pipeline writes it). It feeds the Thread
// grouping in lib/taskThreads.js now — still not a column, but no longer
// dead data.

export const COLUMN_STORAGE_KEY = 'taskBoardListColumns'

// `sortable: false` for columns with no meaningful total order (a PR badge,
// a tag set). Clicking them would appear to do nothing, which is worse than
// not being clickable.
export const ALL_COLUMNS = [
  { key: 'title', label: 'Title', width: 'flex-1 min-w-[240px]', sortable: true, locked: true },
  { key: 'status', label: 'Status', width: 'w-28', sortable: true },
  { key: 'priority', label: 'Priority', width: 'w-24', sortable: true },
  { key: 'assignee', label: 'Assignee', width: 'w-28', sortable: true },
  { key: 'updated', label: 'Updated', width: 'w-24', sortable: true },
  { key: 'phase', label: 'Phase', width: 'w-28', sortable: true },
  { key: 'pr', label: 'PR', width: 'w-20', sortable: false },
  { key: 'type', label: 'Type', width: 'w-24', sortable: true },
  { key: 'project', label: 'Project', width: 'w-28', sortable: true },
  { key: 'component', label: 'Component', width: 'w-32', sortable: true },
  { key: 'tags', label: 'Tags', width: 'w-40', sortable: false },
]

export const DEFAULT_VISIBLE = [
  'title', 'status', 'priority', 'assignee', 'updated',
]

// Title is locked on: a row without it is unidentifiable, and letting
// someone hide it produces a table they cannot recover from without
// clearing localStorage. (The id lives inside the Title cell, so it no
// longer needs its own lock.) Stored sets that still contain removed keys
// ('id', 'parent') are cleaned by loadVisibleColumns below — no migration.
export const LOCKED = ALL_COLUMNS.filter(c => c.locked).map(c => c.key)

/**
 * Read the persisted set, tolerating anything.
 *
 * Stored values are validated against the current registry, so a renamed or
 * removed column (`due_date`, say) cannot strand the view on a column that no
 * longer renders. Locked columns are always forced back in.
 */
export function loadVisibleColumns(storage = globalThis.localStorage) {
  let stored = null
  try {
    stored = JSON.parse(storage?.getItem(COLUMN_STORAGE_KEY) || 'null')
  } catch {
    stored = null
  }
  if (!Array.isArray(stored)) return [...DEFAULT_VISIBLE]

  const known = new Set(ALL_COLUMNS.map(c => c.key))
  const cleaned = stored.filter(k => known.has(k))
  // An empty or fully-invalid stored value means something went wrong; fall
  // back rather than rendering a table with two locked columns and nothing else.
  if (cleaned.length === 0) return [...DEFAULT_VISIBLE]

  for (const key of LOCKED) if (!cleaned.includes(key)) cleaned.unshift(key)
  return cleaned
}

export function saveVisibleColumns(keys, storage = globalThis.localStorage) {
  try {
    storage?.setItem(COLUMN_STORAGE_KEY, JSON.stringify(keys))
  } catch { /* storage disabled — visibility just won't persist */ }
}

/** Toggle one column, refusing to drop a locked one. Returns registry order. */
export function toggleColumn(visible, key) {
  if (LOCKED.includes(key)) return visible
  const next = visible.includes(key)
    ? visible.filter(k => k !== key)
    : [...visible, key]
  // Re-project through the registry so column order is stable no matter what
  // order the user clicked things in.
  return ALL_COLUMNS.map(c => c.key).filter(k => next.includes(k))
}

/** The visible columns as full definitions, in registry order. */
export function resolveColumns(visible) {
  return ALL_COLUMNS.filter(c => visible.includes(c.key))
}

/** `phase-research` -> `research`; null when the task has no phase tag. */
export function phaseOf(task) {
  const tag = (task?.tags || []).find(x => typeof x === 'string' && x.startsWith('phase-'))
  return tag ? tag.slice('phase-'.length) : null
}
