// Facelift detail — Comments tab.
//
// Renders the "### Comments" section from task.content (markdown) and
// appends new comments via onUpdateTask. Mirrors the pattern already in
// TaskModal but without the editable-whole-content flow.

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Send } from 'lucide-react'
import { Input, IconButton } from '../ui'

function extractCommentsSection(content) {
  if (!content || !content.includes('### Comments')) return ''
  const parts = content.split('### Comments')
  return parts[1] || ''
}

export default function DetailComments({ task, currentUser, onUpdateTask }) {
  const [draft, setDraft] = useState('')
  const commentsMarkdown = extractCommentsSection(task.content).trim()

  const submit = () => {
    const text = draft.trim()
    if (!text) return
    let content = task.content || ''
    if (!content.includes('### Comments')) content += '\n\n### Comments\n'
    content += `\n- **[${currentUser?.username || 'User'}]**: ${text}\n`
    onUpdateTask(task.id, { content })
    setDraft('')
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {commentsMarkdown ? (
          <div className="prose prose-app max-w-none prose-p:text-app-text prose-li:text-app-text prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent hover:prose-a:text-app-accent-hover prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-app-text-muted prose-hr:border-app-border">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{commentsMarkdown}</ReactMarkdown>
          </div>
        ) : (
          <p style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: 'var(--text-footnote)' }}>
            No comments yet.
          </p>
        )}
      </div>

      <div
        className="shrink-0 flex items-center gap-2"
        style={{
          paddingTop: 'var(--space-3)',
          borderTop: 'var(--border-hairline)',
          marginTop: 'var(--space-3)',
        }}
      >
        <Input
          size="md"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="Write a comment…"
          className="flex-1"
        />
        <IconButton
          onClick={submit}
          aria-label="Send comment"
          title="Send"
          disabled={!draft.trim()}
          style={{ color: draft.trim() ? 'var(--accent-app)' : 'var(--text-tertiary)' }}
        >
          <Send className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  )
}
