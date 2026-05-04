import { useState, useCallback } from 'react'
import { ExternalLink, FlaskConical, Clock } from 'lucide-react'
import { E2E_STATUS_COLOR } from '../constants'

// Single demo card. Shipped as part of v2 (feat-demos-services-grouping-001),
// extracted from the v1 in-line DemoCard in DemosView. New affordance: a
// "Show task history" toggle that reveals older runs (latest is always
// visible as the headline chip).

function fmtRelative(iso) {
  if (!iso) return ''
  const dt = Date.now() - new Date(iso).getTime()
  if (dt < 60_000) return 'just now'
  if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m ago`
  if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h ago`
  return `${Math.round(dt / 86_400_000)}d ago`
}

function TaskChip({ taskId, tasks, onSelectTask, label, muted }) {
  const handleClick = useCallback(() => {
    if (!taskId) return
    const task = tasks.find((t) => t.id === taskId)
    if (task && onSelectTask) onSelectTask(task)
  }, [taskId, tasks, onSelectTask])
  return (
    <button
      data-testid={muted ? 'demo-task-chip-history' : 'demo-task-chip'}
      onClick={handleClick}
      className="inline-flex items-center gap-1 apple-press"
      style={{
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        border: 'none',
        background: muted ? 'transparent' : 'var(--fill-secondary)',
        color: muted ? 'var(--text-tertiary)' : 'var(--text-app)',
        fontSize: 'var(--text-caption2)',
        fontWeight: muted ? 'var(--font-medium)' : 'var(--font-medium)',
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
      }}
      title={label || `Open task ${taskId}`}
    >
      {label || taskId}
    </button>
  )
}

export default function DemoCard({ demo, onSelectTask, tasks = [] }) {
  const [showHistory, setShowHistory] = useState(false)
  const tested = !!demo.spec_file
  const latest = demo.latest_run
  const history = Array.isArray(demo.task_history) ? demo.task_history : []
  const olderHistory = history.slice(1) // task_history[0] is the latest, also shown as the headline
  const taskId = latest?.task_id

  return (
    <div
      data-testid="demo-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4) var(--space-5)',
        background: 'var(--bg-card)',
        border: '0.5px solid var(--separator)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
            {demo.title}
          </div>
          <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginTop: 'var(--space-1)' }}>
            /{demo.slug}/
          </div>
        </div>
        <a
          data-testid="demo-open-link"
          href={demo.path}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 apple-press"
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent-app)',
            color: 'white',
            fontSize: 'var(--text-caption1)',
            fontWeight: 'var(--font-semibold)',
            whiteSpace: 'nowrap',
          }}
        >
          <ExternalLink className="w-3 h-3" /> Open
        </a>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1"
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-caption2)',
            fontWeight: 'var(--font-semibold)',
            color: tested ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped,
            background: `color-mix(in srgb, ${tested ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.skipped} 12%, transparent)`,
          }}
        >
          <FlaskConical className="w-3 h-3" />
          {tested ? `tested · ${demo.spec_file}` : 'untested'}
        </span>
        {taskId && <TaskChip taskId={taskId} tasks={tasks} onSelectTask={onSelectTask} />}
        {latest?.started_at && (
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
            last run {fmtRelative(latest.started_at)}{latest.status ? ` · ${latest.status}` : ''}
          </span>
        )}
      </div>

      {olderHistory.length > 0 && (
        <div className="flex flex-col gap-1">
          {!showHistory && (
            <button
              data-testid="demo-task-history-toggle"
              onClick={() => setShowHistory(true)}
              className="inline-flex items-center gap-1 self-start apple-press"
              style={{
                padding: '2px 0',
                background: 'transparent',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-caption2)',
                fontWeight: 'var(--font-medium)',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              <Clock className="w-3 h-3" /> Show task history ({olderHistory.length} more)
            </button>
          )}
          {showHistory && (
            <div className="flex items-center gap-2 flex-wrap" style={{ paddingTop: '2px' }}>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>history:</span>
              {olderHistory.map((entry) => (
                <TaskChip
                  key={entry.run_id || entry.task_id}
                  taskId={entry.task_id}
                  tasks={tasks}
                  onSelectTask={onSelectTask}
                  muted
                  label={`${entry.task_id}${entry.started_at ? ` · ${fmtRelative(entry.started_at)}` : ''}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
