// Shared UI constants — single source of truth for colors, styles, and options

export const STATUS_OPTIONS = [
  { id: 'draft', label: 'Draft' },
  { id: 'todo', label: 'To Do' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'waiting_input', label: 'Waiting Input' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export const PRIORITY_OPTIONS = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

export const PRIORITY_COLOR = {
  high: 'var(--apple-red)',
  medium: 'var(--apple-orange)',
  low: 'var(--apple-green)',
}

export const STATUS_COLOR = {
  draft: 'var(--text-muted)',
  todo: 'var(--gray-1)',
  in_progress: 'var(--apple-blue)',
  waiting_input: 'var(--apple-yellow)',
  review: 'var(--apple-orange)',
  done: 'var(--apple-green)',
}

export const TYPE_STYLE = {
  frontend: { color: 'var(--apple-teal)', bg: 'color-mix(in srgb, var(--apple-teal) 12%, transparent)' },
  backend: { color: 'var(--apple-purple)', bg: 'color-mix(in srgb, var(--apple-purple) 12%, transparent)' },
  fullstack: { color: 'var(--apple-blue)', bg: 'color-mix(in srgb, var(--apple-blue) 12%, transparent)' },
  devops: { color: 'var(--apple-orange)', bg: 'color-mix(in srgb, var(--apple-orange) 12%, transparent)' },
}

export const VIEWER_COLORS = ['#06b6d4', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#fbbf24', '#60a5fa']
