// depends_on editor (ui-create-dejargon-001, usability P1-11).
//
// depends_on was a write-only field: agents set it, the Graph view renders
// it, and no UI could edit it. This gives the DetailPane a chip list +
// typeahead over the known tasks. Every mutation goes through the normal
// onUpdateTask(taskId, { depends_on }) pipeline.

import { useMemo, useRef, useState } from 'react'
import { Link2, X } from 'lucide-react'

const MAX_RESULTS = 8

export default function DependsOnEditor({ task, tasks = [], onUpdateTask }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  const deps = useMemo(
    () => (Array.isArray(task.depends_on) ? task.depends_on : []),
    [task.depends_on]
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return tasks
      .filter((t) => t.id !== task.id && !deps.includes(t.id))
      .filter((t) => t.id.toLowerCase().includes(q) || (t.title || '').toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
  }, [query, tasks, task.id, deps])

  const commit = (nextDeps) => onUpdateTask?.(task.id, { depends_on: nextDeps })
  const add = (id) => {
    commit([...deps, id])
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }
  const remove = (id) => commit(deps.filter((d) => d !== id))

  return (
    <div data-testid="depends-on-editor" style={{ marginBottom: 'var(--space-4)' }}>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 'var(--space-2)' }}>
        <Link2 className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
          Depends on
        </span>
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          — blocked-by links; dashed edges in the Graph view
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {deps.map((id) => {
          const dep = tasks.find((t) => t.id === id)
          return (
            <span
              key={id}
              data-testid="depends-on-chip"
              className="inline-flex items-center gap-1"
              title={dep ? dep.title : 'Not in the current task list'}
              style={{
                fontSize: 'var(--text-caption2)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                background: 'var(--fill-secondary)',
                padding: '2px 4px 2px 8px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {id}
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`Remove dependency ${id}`}
                className="apple-press inline-flex items-center justify-center"
                style={{
                  width: 16,
                  height: 16,
                  padding: 0,
                  borderRadius: 'var(--radius-full)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-tertiary)',
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          )
        })}

        <div className="relative" style={{ minWidth: '160px', flex: 1 }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={deps.length ? 'Add another…' : 'Search tasks to add a dependency…'}
            data-testid="depends-on-input"
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setQuery(''); setOpen(false) }
              if (e.key === 'Enter' && results.length > 0) { e.preventDefault(); add(results[0].id) }
            }}
            style={{
              width: '100%',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              border: 'var(--border-hairline)',
              background: 'var(--bg-card)',
              color: 'var(--text-app)',
              fontSize: 'var(--text-caption1)',
            }}
          />
          {open && results.length > 0 && (
            <div
              className="absolute z-50"
              data-testid="depends-on-results"
              style={{
                top: 'calc(100% + 2px)',
                left: 0,
                right: 0,
                maxHeight: '220px',
                overflowY: 'auto',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-card)',
                border: 'var(--border-hairline)',
                boxShadow: 'var(--shadow-popover)',
              }}
            >
              {results.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-testid="depends-on-result"
                  // onMouseDown so the click lands before the input's onBlur
                  // closes the list.
                  onMouseDown={(e) => { e.preventDefault(); add(t.id) }}
                  className="apple-press w-full text-left"
                  style={{
                    display: 'block',
                    padding: 'var(--space-2)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <span className="block truncate" style={{ fontSize: 'var(--text-caption2)', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                    {t.id}
                  </span>
                  <span className="block truncate" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>
                    {t.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
