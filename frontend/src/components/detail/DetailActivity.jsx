// Facelift detail — Activity tab.
//
// Renders task.activity_log as a reverse-chronological timeline.
// This is net-new UI — activity_log existed on the backend but was never
// surfaced anywhere in the modal. Plan decision #7.

import { Clock } from 'lucide-react'

function formatTimestamp(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export default function DetailActivity({ task }) {
  const log = Array.isArray(task.activity_log) ? [...task.activity_log].reverse() : []

  if (log.length === 0) {
    return (
      <p style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: 'var(--text-footnote)' }}>
        No activity recorded yet.
      </p>
    )
  }

  return (
    <ol
      className="flex flex-col"
      style={{ gap: 'var(--space-3)', listStyle: 'none', padding: 0, margin: 0 }}
    >
      {log.map((entry, i) => (
        <li key={i} className="flex gap-3">
          <div
            className="shrink-0 flex items-center justify-center"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--fill-secondary)',
              color: 'var(--text-tertiary)',
            }}
          >
            <Clock className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <div
              className="truncate"
              style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)', fontWeight: 'var(--font-medium)' }}
            >
              {entry.action}
            </div>
            <div
              style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 'var(--space-1)' }}
            >
              {formatTimestamp(entry.timestamp)}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}
