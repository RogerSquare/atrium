import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// memo matters here: during a streamed response the panel re-renders on every
// chunk, and this keeps the finished messages (stable object identities in
// the messages array) from re-running ReactMarkdown each time
// (feat-ai-chat-stream-001).
function AIChatMessage({ message, currentUser }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`} style={{ marginBottom: '10px' }}>
      {!isUser && (
        <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', marginLeft: '4px', marginBottom: '2px' }}>AI</span>
      )}
      <div
        style={{
          maxWidth: '85%',
          borderRadius: '18px',
          ...(isUser ? {
            background: 'var(--accent-app)',
            color: 'white',
            padding: '10px 14px',
            borderBottomRightRadius: '6px',
          } : {
            background: 'var(--fill-secondary)',
            color: 'var(--text-app)',
            padding: '10px 14px',
            borderBottomLeftRadius: '6px',
          }),
          fontSize: 'var(--text-subhead)',
          lineHeight: 'var(--leading-body)',
          wordBreak: 'break-word',
        }}
      >
        {isUser ? (
          <span>{message.content}</span>
        ) : (
          <div className="prose prose-sm prose-app max-w-none prose-p:my-1 prose-p:text-app-text prose-li:my-0.5 prose-li:text-app-text prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-code:text-app-accent prose-code:bg-app-bg/50 prose-code:px-1 prose-code:rounded prose-headings:text-app-text prose-headings:my-2 prose-strong:text-app-text prose-a:text-app-accent">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
      {message.cancelled && (
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginLeft: '4px', marginTop: '2px' }}>
          generation stopped
        </span>
      )}
    </div>
  )
}

export default memo(AIChatMessage)
