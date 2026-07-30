// List view column registry + visibility (ui-list-usability-001).
//
// The default set was chosen from measured fill rates across the real board
// (769 tasks), not from taste:
//
//   id/title/status/priority/type  100%      always useful
//   project                         94%      but constant when scoped to one project
//   assignee                        87%
//   component                       73%
//   due_date                         0%      <- removed entirely, see below
//
// `due_date` was a column on every row for every user and was populated on
// ZERO of 769 tasks. It is not hidden-by-default, it is gone: keeping a
// picker entry for a field nothing writes just moves the dead weight into
// the picker. If due dates ever start being used, adding it back is a
// one-line change.
//
// `depends_on` is likewise empty on all 769 tasks despite the agent
// instructions calling for it, so there is deliberately no "Blocked by"
// column — it would be an empty column dressed up as a feature.

export const COLUMN_STORAGE_KEY = 'taskBoardListColumns'

// `sortable: false` for columns with no meaningful total order (a PR badge,
// a tag set). Clicking them would appear to do nothing, which is worse than
// not being clickable.
export const ALL_COLUMNS = [
  { key: 'id', label: 'ID', width: 'w-32', sortable: true, locked: true },
  { key: 'title', label: 'Title', width: 'flex-1 min-w-[200px]', sortable: true, locked: true },
  { key: 'status', label: 'Status', width: 'w-28', sortable: true },
  { key: 'priority', label: 'Priority', width: 'w-24', sortable: true },
  { key: 'phase', label: 'Phase', width: 'w-28', sortable: true },
  { key: 'pr', label: 'PR', width: 'w-20', sortable: false },
  { key: 'assignee', label: 'Assignee', width: 'w-28', sortable: true },
  { key: 'updated', label: 'Updated', width: 'w-24', sortable: true },
  { key: 'type', label: 'Type', width: 'w-24', sortable: true },
  { key: 'project', label: 'Project', width: 'w-28', sortable: true },
  { key: 'component', label: 'Component', width: 'w-32', sortable: true },
  { key: 'parent', label: 'Parent', width: 'w-32', sortable: true },
  { key: 'tags', label: 'Tags', width: 'w-40', sortable: false },
]

export const DEFAULT_VISIBLE = [
  'id', 'title', 'status', 'priority', 'phase', 'pr', 'assignee', 'updated',
]

// ID and Title are locked on: a row with neither is unidentifiable, and
// letting someone hide both produces a table they cannot recover from
// without clearing localStorage.
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
