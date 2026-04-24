// Facelift detail — Changes tab.
//
// Fetches commits + files + diff stats for the task's linked PR via
// /api/github/changes. Shows a summary header, file list (with +/-),
// and commit log. Empty state when the task has no PR yet.

import { useEffect, useState } from 'react'
import { GitCommit, FileText, ExternalLink, RefreshCw, Plus, Minus } from 'lucide-react'
import { API_BASE, apiFetch } from '../../config'

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function DetailChanges({ task }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const projectParam = task.project || 'Root'

  const fetchChanges = async (refresh = false) => {
    setLoading(true)
    setError(null)
    try {
      const url = `${API_BASE}/api/github/changes?project=${encodeURIComponent(projectParam)}&task=${encodeURIComponent(task.id)}${refresh ? '&refresh=1' : ''}`
      const res = await apiFetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchChanges(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id])

  if (loading && !data) {
    return (
      <p style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: 'var(--text-footnote)' }}>
        Loading changes…
      </p>
    )
  }

  if (error) {
    return (
      <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--apple-red)' }}>
        Couldn't load changes: {error}
      </p>
    )
  }

  if (!data || !data.pr_number) {
    return (
      <p style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: 'var(--text-footnote)' }}>
        No pull request linked to this task yet. Push a branch named after the task id
        and the commits will show up here.
      </p>
    )
  }

  const commits = data.commits || []
  const files = data.files || []

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {/* Summary header */}
      <div className="flex items-center flex-wrap" style={{ gap: 'var(--space-2)' }}>
        {data.pr_url && (
          <a
            href={data.pr_url}
            target="_blank"
            rel="noreferrer"
            className="apple-press flex items-center gap-1.5"
            style={{
              padding: '0 10px',
              height: 28,
              borderRadius: 'var(--radius-md)',
              background: 'var(--fill-secondary)',
              border: '1px solid var(--separator)',
              fontSize: 'var(--text-caption2)',
              color: 'var(--text-tertiary)',
              textDecoration: 'none',
            }}
            title={`Open PR #${data.pr_number} on GitHub`}
          >
            #{data.pr_number} {data.head_branch && `· ${data.head_branch}`}
            <ExternalLink className="w-2.5 h-2.5 opacity-60" />
          </a>
        )}
        <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          {data.changed_files} {data.changed_files === 1 ? 'file' : 'files'}
        </span>
        <span className="flex items-center gap-0.5" style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-green)' }}>
          <Plus className="w-3 h-3" />{data.additions}
        </span>
        <span className="flex items-center gap-0.5" style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-red)' }}>
          <Minus className="w-3 h-3" />{data.deletions}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => fetchChanges(true)}
          disabled={loading}
          className="apple-press flex items-center gap-1"
          style={{
            padding: '0 10px',
            height: 28,
            borderRadius: 'var(--radius-md)',
            background: 'var(--fill-secondary)',
            border: '1px solid var(--separator)',
            fontSize: 'var(--text-caption2)',
            color: 'var(--text-tertiary)',
            opacity: loading ? 0.6 : 1,
          }}
          title="Refresh from GitHub"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Files changed */}
      {files.length > 0 && (
        <section className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
          <h3 style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Files changed ({files.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {files.map((f) => (
              <li
                key={f.path}
                className="flex items-center gap-2"
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--fill-secondary)',
                  fontSize: 'var(--text-caption2)',
                }}
              >
                <FileText className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                <span className="truncate flex-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-app)' }} title={f.path}>
                  {f.path}
                </span>
                <span style={{ color: 'var(--apple-green)' }}>+{f.additions}</span>
                <span style={{ color: 'var(--apple-red)' }}>-{f.deletions}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Commits */}
      {commits.length > 0 && (
        <section className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
          <h3 style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)' }}>
            Commits ({commits.length})
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {commits.map((c) => (
              <li
                key={c.oid}
                className="flex items-start gap-2"
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--fill-secondary)',
                }}
              >
                <GitCommit className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--text-tertiary)' }} />
                <div className="flex-1 min-w-0 flex flex-col" style={{ gap: '2px' }}>
                  <span
                    className="truncate"
                    style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-app)' }}
                    title={c.message_headline}
                  >
                    {c.message_headline}
                  </span>
                  <span className="flex items-center gap-2" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>{c.abbreviated_oid}</span>
                    {c.author?.login && <span>{c.author.login}</span>}
                    {c.authored_date && <span>{relativeTime(c.authored_date)}</span>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
