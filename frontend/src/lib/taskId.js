// Task-id generation (ui-create-dejargon-001, accepted default Q10).
//
// The backend enforces `^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$`
// (backend/lib/taskIdValidator.js). Hand-authoring that id was the single
// biggest first-session jargon wall, so the create modal now derives it from
// a category picker + the title, with the regex surviving as a validator for
// the advanced manual-override field.

export const TASK_ID_REGEX = /^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$/

// Plain-language labels for the category prefixes.
export const CATEGORIES = [
  { id: 'feat', label: 'Feature — new functionality' },
  { id: 'bug', label: 'Bug fix — something is broken' },
  { id: 'ui', label: 'UI / UX — visual or interaction work' },
  { id: 'opt', label: 'Optimization — perf, security, reliability' },
  { id: 'comp', label: 'Component — build or refactor a component' },
  { id: 'devops', label: 'DevOps — infra, deployment, tooling' },
  { id: 'mobile', label: 'Mobile — mobile-specific work' },
]

// Title → descriptor slug: lowercase hyphen-separated a-z0-9 segments.
// Capped at 4 segments / 32 chars so ids stay readable; a title with no
// usable characters falls back to "task" (the regex requires ≥1 segment).
export function slugifyTitle(title) {
  const segments = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
  let slug = segments.join('-')
  if (slug.length > 32) slug = slug.slice(0, 32).replace(/-+[^-]*$/, '') || slug.slice(0, 32)
  return slug || 'task'
}

// Next free NNN for `<category>-<slug>-` among the known tasks. Numbering is
// per category+descriptor (house convention: ui-services-006 etc.).
export function nextTaskId(category, title, tasks = []) {
  const slug = slugifyTitle(title)
  const prefix = `${category}-${slug}-`
  let max = 0
  for (const t of tasks) {
    const id = typeof t === 'string' ? t : t?.id
    if (typeof id !== 'string' || !id.startsWith(prefix)) continue
    const n = parseInt(id.slice(prefix.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}
