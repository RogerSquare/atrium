import { useEffect } from 'react'
import { AlertTriangle, X } from 'lucide-react'

export default function ErrorToast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(onDismiss, 5000)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="fixed bottom-20 sm:bottom-16 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div
        className="flex items-center gap-2 vibrancy-regular"
        style={{
          padding: '10px 16px',
          borderRadius: 'var(--radius-full)',
          background: 'color-mix(in srgb, var(--apple-red) 15%, var(--bg-card) 85%)',
          boxShadow: 'var(--shadow-lg)',
          border: '1px solid color-mix(in srgb, var(--apple-red) 30%, transparent)',
        }}
      >
        <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: 'var(--apple-red)' }} />
        <span className="truncate max-w-[300px]" style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)' }}>{message}</span>
        <button onClick={onDismiss} className="apple-press shrink-0" style={{ padding: '4px', borderRadius: '50%', color: 'var(--text-tertiary)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
