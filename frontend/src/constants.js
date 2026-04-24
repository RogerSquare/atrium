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

// Minimalist lane: decorative multi-hue collapsed to monochrome.
// `fullstack` keeps the accent blue (it's already the functional "interactive" color).
// Other types drop to neutral — type info is carried by the text label, not by color.
export const TYPE_STYLE = {
  frontend: { color: 'var(--text-muted)', bg: 'transparent' },
  backend: { color: 'var(--text-muted)', bg: 'transparent' },
  fullstack: { color: 'var(--accent-app)', bg: 'transparent' },
  devops: { color: 'var(--text-muted)', bg: 'transparent' },
}

export const VIEWER_COLORS = ['#06b6d4', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#fbbf24', '#60a5fa']

// GitHub PR merge-status — shared across TaskCard, ListView, TaskModal, ChangesView
export const MERGE_STATUS = {
  OPEN:   { color: 'var(--apple-green)',  label: 'Open',   dotColor: 'var(--apple-green)'  },
  MERGED: { color: 'var(--apple-purple)', label: 'Merged', dotColor: 'var(--apple-purple)' },
  CLOSED: { color: 'var(--apple-red)',    label: 'Closed', dotColor: 'var(--apple-red)'    },
}
