// Status color map — used by the work-overlay toggle in GraphView.
// Phase 5 of ui-graph-redesign-013.
//
// Picked CSS-variable colors that read well as a thin OUTER ring around an
// already-category-colored circle: muted gray for drafts (signals "not yet
// shipped"), cool teal for todo (sitting in queue), active blue for
// in_progress, warm orange for review, finished green for done. Yellow for
// waiting_input flags "stuck on a decision."

export const STATUS_COLOR = {
  draft:         'var(--gray-1)',
  todo:          'var(--apple-teal)',
  in_progress:   'var(--apple-blue)',
  waiting_input: 'var(--apple-yellow)',
  review:        'var(--apple-orange)',
  done:          'var(--apple-green)',
}

export function statusColor(status) {
  return STATUS_COLOR[status] || 'var(--gray-1)'
}
