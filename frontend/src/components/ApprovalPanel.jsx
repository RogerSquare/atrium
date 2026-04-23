import { useState, useEffect, useCallback } from 'react'
import { HelpCircle, CheckCircle2, Clock } from 'lucide-react'
import { apiFetch } from '../config'
import { Button } from './ui'

export default function ApprovalPanel({ task, socket, onTaskChanged }) {
  const [approvals, setApprovals] = useState([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!task?.id) return
    setLoading(true)
    try {
      const r = await apiFetch(`/api/approvals/task/${encodeURIComponent(task.id)}`)
      if (r.ok) {
        const d = await r.json()
        setApprovals(d.approvals || [])
      }
    } catch (e) { /* ignore */ }
    setLoading(false)
  }, [task?.id])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!socket) return
    const onCreated = ({ taskId }) => { if (taskId === task?.id) load() }
    const onAnswered = ({ taskId }) => { if (taskId === task?.id) load() }
    socket.on?.('approvalCreated', onCreated)
    socket.on?.('approvalAnswered', onAnswered)
    return () => {
      socket.off?.('approvalCreated', onCreated)
      socket.off?.('approvalAnswered', onAnswered)
    }
  }, [socket, task?.id, load])

  const respond = async (approvalId, response) => {
    setSubmitting(approvalId)
    setError(null)
    try {
      const r = await apiFetch(`/api/approvals/task/${encodeURIComponent(task.id)}/${encodeURIComponent(approvalId)}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        setError(d.error || 'Failed to respond')
      } else {
        await load()
        onTaskChanged?.()
      }
    } catch (e) {
      setError('Network error')
    }
    setSubmitting(null)
  }

  if (loading && approvals.length === 0) return null
  if (approvals.length === 0) return null

  const pending = approvals.filter(a => !a.response)
  const resolved = approvals.filter(a => a.response)

  return (
    <div style={{ marginBottom: 'var(--space-5)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: pending.length ? 'color-mix(in srgb, var(--apple-yellow) 8%, var(--fill-secondary))' : 'var(--fill-secondary)', border: pending.length ? '1px solid color-mix(in srgb, var(--apple-yellow) 40%, transparent)' : '0.5px solid var(--separator)' }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 'var(--space-3)' }}>
        <HelpCircle className="w-4 h-4" style={{ color: pending.length ? 'var(--apple-yellow)' : 'var(--text-muted)' }} />
        <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          {pending.length > 0 ? `${pending.length} approval${pending.length > 1 ? 's' : ''} needed` : 'Approvals'}
        </span>
      </div>

      {pending.map(a => (
        <div key={a.id} style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--bg-card)', marginBottom: 'var(--space-2)' }}>
          <div style={{ fontSize: 'var(--text-body)', color: 'var(--text-app)', marginBottom: 'var(--space-2)', lineHeight: 'var(--leading-normal)' }}>{a.prompt}</div>
          {a.context?.reasoning && <div style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>{a.context.reasoning}</div>}
          {a.context?.code_snippet && <pre style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', overflow: 'auto', marginBottom: 'var(--space-2)' }}>{a.context.code_snippet}</pre>}
          {Array.isArray(a.context?.files) && a.context.files.length > 0 && (
            <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>{a.context.files.join(' · ')}</div>
          )}
          <div className="flex flex-wrap gap-2" style={{ marginTop: 'var(--space-2)' }}>
            {a.options.map((opt, idx) => {
              const lower = String(opt).toLowerCase()
              const isCancel = lower === 'cancel' || lower === 'abort' || lower === 'reject' || lower === 'deny'
              const variant = isCancel ? 'danger' : idx === 0 ? 'primary' : 'ghost'
              return (
                <Button
                  key={opt}
                  variant={variant}
                  onClick={() => respond(a.id, opt)}
                  disabled={submitting === a.id}
                  loading={submitting === a.id}
                  pill={false}
                >
                  {opt}
                </Button>
              )
            })}
          </div>
          <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)', marginTop: 'var(--space-2)' }}>
            requested by {a.created_by} · {new Date(a.created_at).toLocaleString()}
          </div>
        </div>
      ))}

      {resolved.length > 0 && (
        <details style={{ marginTop: pending.length ? 'var(--space-3)' : 0 }}>
          <summary style={{ cursor: 'pointer', fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>
            {resolved.length} resolved
          </summary>
          <div style={{ marginTop: 'var(--space-2)' }}>
            {resolved.map(a => (
              <div key={a.id} style={{ padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', borderLeft: '2px solid var(--separator)', marginBottom: 'var(--space-1)' }}>
                <CheckCircle2 className="w-3 h-3 inline mr-1" style={{ color: 'var(--apple-green)' }} />
                <span style={{ color: 'var(--text-app)' }}>{a.prompt.slice(0, 80)}{a.prompt.length > 80 ? '…' : ''}</span>
                <span> → <b>{a.response}</b> by {a.responded_by}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <div style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-caption1)', color: 'var(--apple-red)' }}>{error}</div>}
    </div>
  )
}
