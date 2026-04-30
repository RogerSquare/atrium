// CommandCard — sidebar inside the Shell tab.
//
// Lists copy-paste-ready prompts for the open task. Each row shows a
// short action label, with the full prompt text rendered beneath as a
// muted preview (truncated with ellipsis). Click anywhere on the row
// to copy the full text to the clipboard; a checkmark flashes for
// ~1.5s as confirmation. The header shows the task id (monospace) and
// the task title (truncated). Clicking the id copies just the bare id.
//
// Source of truth for prompts is `./commands.js` — the registry is
// data-only so adding/editing prompts doesn't touch this component.

import { useCallback, useState } from 'react'
import { Check, Copy, Hash } from 'lucide-react'
import { COMMANDS } from './commands'

// Best-effort clipboard write. Modern atrium runs on localhost so
// navigator.clipboard.writeText is allowed; fall back to the legacy
// hidden-textarea + execCommand path only if the modern API rejects
// (e.g. running inside an iframe with no permissions delegation).
async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function CommandCard({ task }) {
  // Tracks which row most recently flashed a confirmation. Only one
  // checkmark is visible at a time — clicking a different row resets.
  const [copiedId, setCopiedId] = useState(null)

  const flash = useCallback((id) => {
    setCopiedId(id)
    // Use a stable id-aware reset so a second copy on the same row
    // resets the timer, while a copy on a different row clears the
    // previous row's check immediately (handled by the setState above
    // overwriting copiedId).
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current))
    }, 1500)
  }, [])

  const handleCopyText = useCallback(async (id, text) => {
    const ok = await copyToClipboard(text)
    if (ok) flash(id)
  }, [flash])

  if (!task) return null

  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-card)',
        border: 'var(--border-hairline)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
      aria-label="Task command card"
    >
      {/* Header — task id (click-to-copy) + truncated title */}
      <header
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderBottom: 'var(--border-hairline)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-1)',
          flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => handleCopyText('__id__', task.id)}
          title={`Copy task id (${task.id})`}
          className="apple-press"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '2px 6px',
            margin: '-2px -6px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-caption2)',
            color: 'var(--text-tertiary)',
            alignSelf: 'flex-start',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <Hash className="w-3 h-3" />
          <span>{task.id}</span>
          {copiedId === '__id__' ? (
            <Check className="w-3 h-3" style={{ color: 'var(--apple-green)' }} />
          ) : null}
        </button>
        <div
          className="truncate"
          style={{
            fontSize: 'var(--text-footnote)',
            fontWeight: 'var(--font-semibold)',
            color: 'var(--text-app)',
          }}
        >
          {task.title}
        </div>
      </header>

      {/* Body — scrollable list of command rows */}
      <ul
        className="custom-scrollbar"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          listStyle: 'none',
          margin: 0,
          padding: 'var(--space-1)',
        }}
      >
        {COMMANDS.map((cmd) => {
          const text = cmd.build(task)
          const copied = copiedId === cmd.id
          return (
            <li key={cmd.id} style={{ marginBottom: 2 }}>
              <button
                type="button"
                onClick={() => handleCopyText(cmd.id, text)}
                title={text}
                aria-label={`Copy: ${cmd.label}`}
                className="apple-press"
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'stretch',
                  gap: 2,
                  padding: 'var(--space-2)',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: copied
                    ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)'
                    : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 120ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!copied) e.currentTarget.style.background = 'var(--fill-secondary)'
                }}
                onMouseLeave={(e) => {
                  if (!copied) e.currentTarget.style.background = 'transparent'
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 'var(--text-caption1)',
                    fontWeight: 'var(--font-semibold)',
                    color: copied ? 'var(--apple-green)' : 'var(--text-app)',
                  }}
                >
                  {cmd.label}
                  {copied ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy
                      className="w-3 h-3"
                      style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}
                    />
                  )}
                </span>
                <span
                  className="truncate"
                  style={{
                    fontSize: 'var(--text-caption2)',
                    color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)',
                    lineHeight: 1.35,
                  }}
                >
                  {text}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
