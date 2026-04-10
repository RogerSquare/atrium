import { useEffect, useRef } from 'react'
import { MessageCircle, X } from 'lucide-react'

function Toast({ message, onDismiss, onOpenChat }) {
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timerRef.current)
  }, [onDismiss])

  return (
    <div
      className="flex items-start gap-3 cursor-pointer apple-press animate-slide-in"
      onClick={() => { onOpenChat(); onDismiss() }}
      style={{
        width: '320px',
        padding: '12px 16px',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        boxShadow: 'var(--shadow-lg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        transition: `all var(--duration-fast) var(--ease-default)`,
      }}
    >
      <div className="shrink-0 mt-0.5 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--accent-app) 12%, transparent)' }}>
        <MessageCircle className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="truncate" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)' }}>{message.username}</p>
        <p className="line-clamp-2 break-words" style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', marginTop: '2px' }}>{message.content}</p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss() }}
        className="shrink-0 apple-press"
        style={{ padding: '4px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

export default function ChatNotification({ toasts, onDismiss, onOpenChat }) {
  const visible = toasts.slice(-3)
  if (visible.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2">
      {visible.map((msg) => (
        <Toast key={msg.id} message={msg} onDismiss={() => onDismiss(msg.id)} onOpenChat={onOpenChat} />
      ))}
    </div>
  )
}
