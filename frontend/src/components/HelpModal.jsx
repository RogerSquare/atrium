import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, X, HelpCircle } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import {
  HELP_CONTENT_WEB_UI,
  HELP_CONTENT_TERMINAL,
  HELP_TABS,
  VERSION_STAMP,
  SOURCE_URL,
} from './HelpModal.content'

// Recursively extract plain text from a ReactMarkdown code-block's children.
// ReactMarkdown v10 passes a <code> React element as children of <pre>;
// we unwrap it so the Copy button has raw text to put on the clipboard.
function extractText(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node?.props?.children !== undefined) return extractText(node.props.children)
  return ''
}

// Slugify heading text for in-modal anchor ids. Used by h2/h3 renderers below.
function slugify(node) {
  return extractText(node)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Conservative kbd-chip allowlist. An inline `<code>` token renders as a
// `<kbd className="kbd-chip">` when it contains `+` (any modifier chord) OR
// is exactly one of these standalone keys. Anything else falls through to
// regular inline code styling — avoids mis-chipping short identifiers like
// `id`, `key`, `task`, or task IDs like `feat-auth-001`.
const KBD_KEYS = new Set([
  '?', '/', 'Esc', 'Tab', 'Enter', 'Space',
  'Shift', 'Ctrl', 'Cmd', 'Opt', 'Alt',
  '↑', '↓', '←', '→',
])
function isKbd(text) {
  if (!text || text.length > 16) return false
  if (text.includes('+')) return true
  return KBD_KEYS.has(text)
}

function CodeBlockWithCopy({ children, ...props }) {
  const [copied, setCopied] = useState(false)
  const code = extractText(children).trim()

  // Pull the fenced language off the inner <code>'s className, e.g.
  // "language-bash" -> "bash". null when the fence has no language.
  const inner = Array.isArray(children) ? children.find((c) => c?.props) : children
  const lang = inner?.props?.className?.match(/language-(\w+)/)?.[1] ?? null

  const onCopy = async () => {
    try {
      // navigator.clipboard needs a secure context. Atrium runs on localhost so this works;
      // LAN http access would not. That's a known trade-off, not a bug.
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Silent fail — user can still select + copy manually.
    }
  }

  return (
    <div className="relative group">
      {lang && <span className="code-lang-tag">{lang}</span>}
      <pre {...props}>{children}</pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        className="absolute top-2 right-2 opacity-50 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity apple-press"
        style={{
          padding: '6px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--fill-secondary)',
          color: copied ? 'var(--accent-app)' : 'var(--text-muted)',
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  )
}

// ReactMarkdown component overrides — extends inline `<code>` to chip-render
// keyboard shortcuts, gives h2/h3 stable anchor ids for deep-linking, and
// keeps the existing pre+Copy treatment.
const MARKDOWN_COMPONENTS = {
  pre: CodeBlockWithCopy,
  code: ({ className, children, ...props }) => {
    const text = typeof children === 'string' ? children : extractText(children)
    if (!className && isKbd(text.trim())) {
      return <kbd className="kbd-chip">{text.trim()}</kbd>
    }
    return <code className={className} {...props}>{children}</code>
  },
  h2: ({ children, ...props }) => <h2 id={slugify(children)} {...props}>{children}</h2>,
  h3: ({ children, ...props }) => <h3 id={slugify(children)} {...props}>{children}</h3>,
}

const CONTENT_BY_TAB = {
  'web-ui': HELP_CONTENT_WEB_UI,
  terminal: HELP_CONTENT_TERMINAL,
}

export default function HelpModal({ onClose }) {
  const [activeTab, setActiveTab] = useState(HELP_TABS[0].id)
  const bodyRef = useRef(null)

  // Reset scroll on tab change so users always start at the top of the new tab.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [activeTab])

  const onTablistKeyDown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const idx = HELP_TABS.findIndex((t) => t.id === activeTab)
    const next = e.key === 'ArrowRight'
      ? (idx + 1) % HELP_TABS.length
      : (idx - 1 + HELP_TABS.length) % HELP_TABS.length
    setActiveTab(HELP_TABS[next].id)
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="font-help relative w-full sm:w-auto sm:max-w-3xl h-full sm:h-auto sm:max-h-[85vh] flex flex-col"
        style={{
          background: 'var(--bg-app)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-popover)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between shrink-0"
          style={{ padding: '16px 24px', borderBottom: '0.5px solid var(--separator)' }}
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5" style={{ color: 'var(--accent-app)' }} />
            <h2
              id="help-modal-title"
              style={{
                fontSize: 'var(--text-h2-modal)',
                fontWeight: 'var(--weight-h2-modal)',
                lineHeight: 'var(--leading-h2-modal)',
                color: 'var(--text-app)',
                margin: 0,
              }}
            >
              Help &amp; Usage
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="apple-press"
            style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab strip */}
        <div
          role="tablist"
          aria-label="Help sections"
          onKeyDown={onTablistKeyDown}
          className="shrink-0 flex"
          style={{
            padding: '0 24px',
            borderBottom: '0.5px solid var(--separator)',
            gap: '4px',
          }}
        >
          {HELP_TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`help-tab-${tab.id}`}
                aria-selected={active}
                aria-controls="help-tabpanel"
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className="apple-press"
                style={{
                  padding: '10px 12px',
                  fontSize: 'var(--text-footnote)',
                  fontWeight: active ? 'var(--font-semibold)' : 'var(--font-medium)',
                  color: active ? 'var(--text-app)' : 'var(--text-muted)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: active ? '2px solid var(--accent-app)' : '2px solid transparent',
                  marginBottom: '-0.5px',
                  cursor: 'pointer',
                  transition: 'color var(--duration-fast) var(--ease-default)',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Body */}
        <div
          ref={bodyRef}
          id="help-tabpanel"
          role="tabpanel"
          aria-labelledby={`help-tab-${activeTab}`}
          className="flex-1 overflow-y-auto custom-scrollbar"
          style={{ padding: '20px 24px' }}
        >
          <div className="prose prose-sm max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-p:text-app-text/90 prose-li:text-app-text/90 prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-hr:border-app-border">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MARKDOWN_COMPONENTS}
            >
              {CONTENT_BY_TAB[activeTab]}
            </ReactMarkdown>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between shrink-0 gap-3"
          style={{
            padding: '12px 24px',
            borderTop: '0.5px solid var(--separator)',
            fontSize: 'var(--text-caption1)',
          }}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>{VERSION_STAMP}</span>
          <a
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-app)', whiteSpace: 'nowrap' }}
          >
            View source &#8599;
          </a>
        </div>
      </div>
    </ModalOverlay>
  )
}
