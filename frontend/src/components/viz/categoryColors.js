// Shared category-color map. Used by GraphView's legend, the TaskNode
// component, and the edge factory so a v1 visual grammar tweak only needs
// one edit.

export const CATEGORY_COLOR = {
  feat:   'var(--apple-blue)',
  bug:    'var(--apple-red)',
  ui:     'var(--apple-teal)',
  opt:    'var(--apple-orange)',
  devops: 'var(--apple-purple)',
  comp:   'var(--gray-1)',
  mobile: 'var(--apple-pink)',
}

export const DEFAULT_COLOR = 'var(--gray-1)'

export function categoryColor(taskId) {
  if (!taskId) return DEFAULT_COLOR
  const prefix = taskId.split('-')[0]?.toLowerCase()
  return CATEGORY_COLOR[prefix] || DEFAULT_COLOR
}
