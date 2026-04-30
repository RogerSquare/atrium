// CommandCard — floating task-context command picker for the Shell tab.
//
// Default state: a small pill-shaped button at the bottom-right of the
// Shell-tab area, layered over the terminal without taking layout
// space. Clicking the button expands the full command list as a
// popover anchored to the same corner. Copying any command (or the
// task id) flashes a green checkmark for 800ms, then auto-collapses
// the popover back to the button. Pressing Esc or clicking outside
// the popover dismisses it without copying.
//
// Source of truth for prompts is `./commands.js`.

import { useCallback, useEffect, useState } from 'react'
import { Check, Command, Copy, Hash, X } from 'lucide-react'
import { COMMANDS } from './commands'

// Best-effort clipboard write. Atrium runs on localhost where the
// modern API is allowed; legacy execCommand path is the fallback for
// the rare case where clipboard permissions are denied.
async function copyToClipboard(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
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

const AUTO_COLLAPSE_MS = 800

export default function CommandCard({ task }) {
  const [isOpen, setIsOpen] = useState(false)
  const [copiedId, setCopiedId] = useState(null)

  // State reset on task change is handled by the parent (DetailPane)
  // passing a fresh `key={task.id}` prop, which remounts this
  // component. That's idiomatic React 19 and avoids a setState-in-
  // effect lint warning that the alternative would trigger.

  // Esc collapses the popover without copying.
  useEffect(() => {
    if (!isOpen) return undefined
    const handler = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  const handleCopyText = useCallback(async (id, text) => {
    const ok = await copyToClipboard(text)
    if (!ok) return
    setCopiedId(id)
    // Auto-collapse after the checkmark flash. Keep both timers in
    // sync so the user sees the green checkmark briefly, then the
    // card collapses back to the button.
    setTimeout(() => {
      setCopiedId(null)
      setIsOpen(false)
    }, AUTO_COLLAPSE_MS)
  }, [])

  if (!task) return null

  return (
    <>
      {/* Backdrop — captures outside clicks while expanded. Visually
          transparent but blocks pointer events so the terminal doesn't
          receive a stray click that races with the dismiss. */}
      {isOpen && (
        <div
          onMouseDown={(e) => {
            // Only dismiss when the click landed on the backdrop
            // itself, not on a card child that bubbled up.
            if (e.target === e.currentTarget) setIsOpen(false)
          }}
          style={{
            position: 'absolute',
            inset: 0,
            background: 'transparent',
            zIndex: 5,
          }}
          aria-hidden="true"
        />
      )}

      {/* Floating button — anchored bottom-right of the Shell-tab
          content area. Absolute positioning is relative to the
          shell-tab wrapper in DetailPane (which is `position: absolute;
          inset: var(--space-4)` and acts as the positioning context). */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Open task commands"
          title="Task commands"
          className="apple-press"
          style={{
            position: 'absolute',
            bottom: 'var(--space-3)',
            left: 'var(--space-3)',
            zIndex: 10,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            border: 'var(--border-hairline)',
            background: 'var(--bg-card)',
            color: 'var(--text-app)',
            fontSize: 'var(--text-caption2)',
            fontFamily: 'var(--font-mono)',
            cursor: 'pointer',
            boxShadow: 'var(--shadow-popover)',
            maxWidth: 'calc(100% - var(--space-6))',
            overflow: 'hidden',
          }}
        >
          <Command className="w-3.5 h-3.5" style={{ flexShrink: 0, color: 'var(--accent-app)' }} />
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}
          >
            {task.id}
          </span>
        </button>
      )}

      {/* Expanded popover — anchored to the same corner as the button.
          Grows up + right from bottom-left. Max-height bounded so it
          doesn't escape the Shell-tab area; internal scroll handles
          long command lists. */}
      {isOpen && (
        <aside
          style={{
            position: 'absolute',
            bottom: 'var(--space-3)',
            left: 'var(--space-3)',
            zIndex: 10,
            width: 320,
            maxWidth: 'calc(100% - var(--space-6))',
            maxHeight: 'calc(100% - var(--space-6))',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-popover)',
            overflow: 'hidden',
          }}
          aria-label="Task command list"
        >
          {/* Header — task id (click-to-copy) + close button */}
          <header
            style={{
              padding: 'var(--space-2) var(--space-3)',
              borderBottom: 'var(--border-hairline)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 'var(--space-2)',
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
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
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              title="Close (Esc)"
              className="apple-press"
              style={{
                width: 24,
                height: 24,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 0,
                border: 'none',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                cursor: 'pointer',
                borderRadius: 'var(--radius-sm)',
                flexShrink: 0,
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
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
      )}
    </>
  )
}
