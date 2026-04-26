import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Copy, Check, X, HelpCircle } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import { HELP_CONTENT, VERSION_STAMP, SOURCE_URL } from './HelpModal.content'

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

function CodeBlockWithCopy({ children, ...props }) {
  const [copied, setCopied] = useState(false)
  const code = extractText(children).trim()

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

export default function HelpModal({ onClose }) {
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: '20px 24px' }}>
          <div className="prose prose-sm max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-p:text-app-text/90 prose-li:text-app-text/90 prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-hr:border-app-border">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{ pre: CodeBlockWithCopy }}
            >
              {HELP_CONTENT}
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
