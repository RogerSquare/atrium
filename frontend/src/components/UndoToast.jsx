import { Undo2, Redo2, X } from 'lucide-react'

export default function UndoToast({ message, canUndo, canRedo, onUndo, onRedo, onDismiss }) {
  if (!message) return null

  return (
    <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      <div
        className="flex items-center gap-2 vibrancy-regular"
        style={{
          padding: '10px 16px',
          borderRadius: 'var(--radius-full)',
          background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <span className="truncate max-w-[240px]" style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)' }}>{message}</span>
        <div className="flex items-center gap-1 ml-2">
          {canUndo && (
            <button onClick={onUndo} className="apple-press flex items-center gap-1" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)' }} title="Undo (Ctrl+Z)">
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </button>
          )}
          {canRedo && (
            <button onClick={onRedo} className="apple-press flex items-center gap-1" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)' }} title="Redo (Ctrl+Shift+Z)">
              <Redo2 className="w-3.5 h-3.5" /> Redo
            </button>
          )}
          <button onClick={onDismiss} className="apple-press" style={{ padding: '4px', borderRadius: '50%', color: 'var(--text-tertiary)' }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
