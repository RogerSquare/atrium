import { useMemo, useState } from 'react'
import { SmilePlus } from 'lucide-react'

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🔥', '👀', '🚀']

function timeAgo(dateString) {
  const seconds = Math.floor((new Date() - new Date(dateString)) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function ChatMessage({ message, currentUser, onReact }) {
  const isOwn = message.username === currentUser
  const isSystem = message.type === 'system'
  const isGif = message.type === 'gif'
  const [showPicker, setShowPicker] = useState(false)
  const time = useMemo(() => timeAgo(message.timestamp), [message.timestamp])
  const reactions = message.reactions || {}
  const hasReactions = Object.keys(reactions).length > 0

  if (isSystem) {
    return (
      <div className="flex justify-center" style={{ margin: '8px 0' }}>
        <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', fontStyle: 'italic', background: 'var(--fill-secondary)', padding: '4px 14px', borderRadius: 'var(--radius-full)' }}>
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={`flex flex-col group/msg ${isOwn ? 'items-end' : 'items-start'}`} style={{ marginBottom: '10px' }}>
      {!isOwn && (
        <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', marginLeft: '4px', marginBottom: '2px' }}>
          {message.username}
        </span>
      )}

      <div className="relative max-w-[80%]">
        {/* Bubble */}
        <div
          style={{
            borderRadius: isGif ? 'var(--radius-lg)' : '18px',
            ...(isGif ? { padding: '4px' } : isOwn ? {
              background: 'var(--accent-app)',
              color: 'white',
              padding: '8px 14px',
              borderBottomRightRadius: '6px',
            } : {
              background: 'var(--fill-secondary)',
              color: 'var(--text-app)',
              padding: '8px 14px',
              borderBottomLeftRadius: '6px',
            }),
            fontSize: 'var(--text-subhead)',
            lineHeight: 'var(--leading-body)',
            wordBreak: 'break-word',
          }}
        >
          {isGif ? (
            <img src={message.content} alt="GIF" style={{ maxWidth: '220px', borderRadius: 'var(--radius-lg)' }} loading="lazy" />
          ) : (
            message.content
          )}
        </div>

        {/* Reaction picker toggle */}
        {onReact && (
          <button
            onClick={() => setShowPicker(!showPicker)}
            className={`absolute -top-1 apple-press opacity-0 group-hover/msg:opacity-100`}
            style={{
              [isOwn ? 'left' : 'right']: '-28px',
              padding: '4px',
              borderRadius: '50%',
              background: 'var(--bg-card)',
              boxShadow: 'var(--shadow-sm)',
              color: 'var(--text-tertiary)',
              transition: `opacity var(--duration-fast) var(--ease-default)`,
            }}
          >
            <SmilePlus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Emoji picker */}
        {showPicker && (
          <div
            className={`absolute ${isOwn ? 'right-0' : 'left-0'} -top-10 flex gap-0.5 z-10`}
            style={{ background: 'var(--bg-card)', boxShadow: 'var(--shadow-lg)', borderRadius: 'var(--radius-full)', padding: '4px 6px' }}
          >
            {REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                onClick={() => { onReact(message.id, emoji); setShowPicker(false) }}
                className="apple-press flex items-center justify-center"
                style={{ width: '28px', height: '28px', borderRadius: '50%', fontSize: 'var(--text-subhead)', transition: `background var(--duration-fast)` }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--fill-secondary)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Reactions */}
      {hasReactions && (
        <div className={`flex gap-1 mt-1 mx-1 flex-wrap ${isOwn ? 'justify-end' : ''}`}>
          {Object.entries(reactions).map(([emoji, users]) => {
            const iMine = users.includes(currentUser)
            return (
              <button
                key={emoji}
                onClick={() => onReact && onReact(message.id, emoji)}
                title={users.join(', ')}
                className="apple-press flex items-center gap-0.5"
                style={{
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--text-caption1)',
                  background: iMine ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)',
                  color: iMine ? 'var(--accent-app)' : 'var(--text-muted)',
                  transition: `all var(--duration-fast) var(--ease-default)`,
                }}
              >
                <span>{emoji}</span>
                <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-bold)' }}>{users.length}</span>
              </button>
            )
          })}
        </div>
      )}

      <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', margin: '2px 4px 0' }}>{time}</span>
    </div>
  )
}
