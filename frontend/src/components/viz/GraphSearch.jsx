// Cmd+K / Ctrl+K modal — type to find a task, Enter to focus on it.
// Phase 6 of ui-graph-redesign-013.
//
// Match scoring (highest first):
//   - id starts with query        → 100
//   - id contains query           →  50
//   - title contains query        →  25
//   - any tag contains query      →  10
// Each is additive, so a query that matches both id and title ranks above
// one that matches only id. Top 50 matches are rendered (the list is also
// scrollable up to 360px tall).

import { useState, useEffect, useRef, useMemo } from 'react'
import { Search } from 'lucide-react'

export default function GraphSearch({ open, tasks, onClose, onSelect }) {
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlightIdx(0)
    // Defer focus so the input is mounted by the time we grab it.
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open])

  const matches = useMemo(() => {
    if (!query.trim() || !tasks) return []
    const q = query.toLowerCase()
    const results = []
    for (const t of tasks) {
      const idLower = t.id.toLowerCase()
      const titleLower = (t.title || '').toLowerCase()
      const tagsLower = (t.tags || []).join(' ').toLowerCase()
      let score = 0
      if (idLower.startsWith(q)) score += 100
      else if (idLower.includes(q)) score += 50
      if (titleLower.includes(q)) score += 25
      if (tagsLower.includes(q)) score += 10
      if (score > 0) results.push({ task: t, score })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, 50)
  }, [query, tasks])

  // Keep the highlighted index in bounds as the match list shrinks.
  useEffect(() => {
    if (matches.length === 0) {
      if (highlightIdx !== 0) setHighlightIdx(0)
      return
    }
    if (highlightIdx >= matches.length) setHighlightIdx(matches.length - 1)
  }, [matches, highlightIdx])

  const handleKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIdx((i) => Math.min(matches.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (matches[highlightIdx]) {
        onSelect(matches[highlightIdx].task)
        onClose()
      }
    }
  }

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.3)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          width: 480,
          maxWidth: '90%',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 14px',
            borderBottom:
              query.trim() && matches.length > 0
                ? 'var(--border-hairline)'
                : 'none',
          }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Find task by id, title, or tag…"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-app)',
              fontSize: 14,
              fontFamily: 'var(--font-sans)',
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              flexShrink: 0,
            }}
          >
            ESC
          </span>
        </div>

        {matches.length > 0 && (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {matches.map((m, i) => (
              <button
                key={m.task.id}
                onClick={() => {
                  onSelect(m.task)
                  onClose()
                }}
                onMouseEnter={() => setHighlightIdx(i)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 14px',
                  background:
                    i === highlightIdx ? 'var(--bg-hover)' : 'transparent',
                  border: 'none',
                  borderBottom:
                    i === matches.length - 1 ? 'none' : 'var(--border-hairline)',
                  cursor: 'pointer',
                  gap: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'var(--text-muted)',
                  }}
                >
                  {m.task.id}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: 'var(--text-app)',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                >
                  {m.task.title || 'Untitled'}
                </span>
              </button>
            ))}
          </div>
        )}

        {query.trim() && matches.length === 0 && (
          <div
            style={{
              padding: '24px 14px',
              color: 'var(--text-tertiary)',
              fontSize: 13,
              textAlign: 'center',
            }}
          >
            No matches.
          </div>
        )}
      </div>
    </div>
  )
}
