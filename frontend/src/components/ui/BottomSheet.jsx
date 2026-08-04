import { useEffect } from 'react'

// iOS-style bottom sheet (mobile-ui-rework-impl-001): dimmed backdrop +
// slide-up panel with the .sheet-handle grabber and home-indicator padding.
// Shared by the mobile filter sheet and the view picker — one sheet
// vocabulary across the mobile shell. Closes on backdrop tap or Escape.
export default function BottomSheet({ open, onClose, title, children, testid }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Sheet'}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end animate-fade-in"
      style={{ background: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        data-testid={testid}
        onClick={(e) => e.stopPropagation()}
        className="w-full animate-slide-up"
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0',
          paddingBottom: 'max(var(--space-3), var(--safe-bottom))',
          maxHeight: '70dvh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="sheet-handle" />
        {title && (
          <div style={{ textAlign: 'center', fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', padding: '2px 0 8px' }}>
            {title}
          </div>
        )}
        <div className="overflow-y-auto custom-scrollbar" style={{ padding: '0 var(--space-3) var(--space-2)' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
