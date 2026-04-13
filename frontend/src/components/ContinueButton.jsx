import { useState, useMemo } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { apiFetch } from '../config'

// Shown on phase-research / phase-plan tasks once they reach review or done.
// Clicking creates a downstream task with depends_on set + parent content injected.
export default function ContinueButton({ task, onSelectTask }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const tags = Array.isArray(task?.tags) ? task.tags : []
  const status = task?.status

  const { show, label, nextShort } = useMemo(() => {
    const canContinue = status === 'review' || status === 'done'
    if (!canContinue) return { show: false }
    if (tags.includes('phase-research')) return { show: true, label: 'Create plan from findings', nextShort: 'plan' }
    if (tags.includes('phase-plan')) return { show: true, label: 'Implement this plan', nextShort: 'implement' }
    return { show: false }
  }, [tags.join(','), status])

  if (!show) return null

  const onClick = async () => {
    if (!confirm(`Create a new ${nextShort} task continuing from "${task.title}"?`)) return
    setBusy(true)
    setError(null)
    try {
      const r = await apiFetch(`/api/tasks/${encodeURIComponent(task.id)}/continue`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(d.error || 'Failed to continue')
        setBusy(false)
        return
      }
      if (d.task && onSelectTask) {
        onSelectTask(d.task)
      }
    } catch (e) {
      setError('Network error')
    }
    setBusy(false)
  }

  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="apple-press flex items-center gap-2"
        style={{
          padding: '10px 16px',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-subhead)',
          fontWeight: 'var(--font-medium)',
          background: 'color-mix(in srgb, var(--accent-app) 14%, transparent)',
          color: 'var(--accent-app)',
          border: '0.5px solid color-mix(in srgb, var(--accent-app) 30%, transparent)',
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
        {label}
      </button>
      {error && <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-caption1)', color: 'var(--apple-red)' }}>{error}</div>}
    </div>
  )
}
