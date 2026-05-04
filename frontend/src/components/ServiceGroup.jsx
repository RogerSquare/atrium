import { useState, useCallback } from 'react'
import { ChevronDown, ChevronRight, Server, Play, Square, Loader2 } from 'lucide-react'
import { E2E_STATUS_COLOR } from '../constants'
import DemoCard from './DemoCard'

// One collapsible card per service group (or the trailing "Unassigned"
// bucket). Header shows the group name, status dots for each underlying
// service, and a count of demos. Body lists demo cards.
//
// Mirrors the SidebarSection pattern (Sidebar.jsx:9-35) but tuned for the
// main-content surface — bigger padding, card chrome, status pills instead
// of an uppercase label.

function StatusDot({ status }) {
  const running = status === 'running'
  return (
    <span
      title={status}
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: running ? E2E_STATUS_COLOR.passing : E2E_STATUS_COLOR.failing,
        boxShadow: running ? `0 0 6px ${E2E_STATUS_COLOR.passing}` : 'none',
        flexShrink: 0,
      }}
    />
  )
}

function ServicePill({ service, inFlight, onAction }) {
  const running = service.status === 'running'
  const isRunningAction = running ? 'stop' : 'start'
  const label = running ? `Stop ${service.name}` : `Start ${service.name}`
  const handleClick = (e) => {
    e.stopPropagation()
    onAction(service, isRunningAction)
  }
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        padding: '2px 4px 2px 8px',
        borderRadius: 'var(--radius-full)',
        background: 'var(--fill-secondary)',
      }}
    >
      <StatusDot status={service.status} />
      <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }} title={service.name}>
        :{service.port}
      </span>
      <button
        data-testid={running ? 'service-stop-btn' : 'service-start-btn'}
        data-service-id={service.id}
        onClick={handleClick}
        disabled={inFlight}
        title={label}
        aria-label={label}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          padding: 0,
          borderRadius: 'var(--radius-full)',
          background: 'transparent',
          color: inFlight ? 'var(--text-tertiary)' : (running ? E2E_STATUS_COLOR.failing : E2E_STATUS_COLOR.passing),
          border: 'none',
          cursor: inFlight ? 'wait' : 'pointer',
          opacity: inFlight ? 0.5 : 1,
        }}
      >
        {inFlight
          ? <Loader2 className="w-3 h-3 animate-spin" />
          : running
            ? <Square className="w-3 h-3" fill="currentColor" />
            : <Play className="w-3 h-3" fill="currentColor" />}
      </button>
    </span>
  )
}

export default function ServiceGroup({ group, services = [], demos = [], tasks = [], onSelectTask, onServiceAction, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [inFlight, setInFlight] = useState(() => new Set())
  const [errors, setErrors] = useState({}) // serviceId -> message
  const isUnassigned = group === 'Unassigned'
  const runningCount = services.filter((s) => s.status === 'running').length

  const handleAction = useCallback(async (svc, action) => {
    if (!onServiceAction) return
    if (action === 'stop' && !window.confirm(`Stop ${svc.name}?`)) return
    setInFlight((prev) => { const next = new Set(prev); next.add(svc.id); return next })
    setErrors((prev) => { const next = { ...prev }; delete next[svc.id]; return next })
    try {
      await onServiceAction(svc.id, action)
    } catch (e) {
      const msg = e?.message || String(e)
      setErrors((prev) => ({ ...prev, [svc.id]: `Failed to ${action}: ${msg}` }))
      setTimeout(() => {
        setErrors((prev) => { const next = { ...prev }; delete next[svc.id]; return next })
      }, 3000)
    } finally {
      setInFlight((prev) => { const next = new Set(prev); next.delete(svc.id); return next })
    }
  }, [onServiceAction])

  return (
    <div
      data-testid="service-group"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--separator)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}
    >
      <div
        data-testid="service-group-header"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed) } }}
        className="w-full flex items-center gap-3 apple-press flex-wrap"
        style={{
          padding: 'var(--space-3) var(--space-5)',
          background: 'transparent',
          cursor: 'pointer',
          textAlign: 'left',
          userSelect: 'none',
        }}
      >
        {collapsed ? <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
        {!isUnassigned && <Server className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />}
        <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          {group}
        </span>
        {!isUnassigned && services.length > 0 && (
          <span className="inline-flex items-center gap-1 flex-wrap">
            {services.map((s) => (
              <ServicePill
                key={s.id}
                service={s}
                inFlight={inFlight.has(s.id)}
                onAction={handleAction}
              />
            ))}
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginLeft: 'var(--space-1)' }}>
              {runningCount}/{services.length} running
            </span>
          </span>
        )}
        <span className="ml-auto" style={{
          padding: '2px 8px',
          borderRadius: 'var(--radius-full)',
          background: 'var(--fill-secondary)',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-caption2)',
          fontWeight: 'var(--font-semibold)',
        }}>
          {demos.length} demo{demos.length === 1 ? '' : 's'}
        </span>
      </div>
      {/* Per-service action errors — auto-dismiss after 3s. Lives just below the
          header so the affected service is visually adjacent. */}
      {Object.keys(errors).length > 0 && (
        <div className="flex flex-col gap-1" style={{ padding: '0 var(--space-5) var(--space-2)' }}>
          {Object.entries(errors).map(([sid, msg]) => (
            <div
              key={sid}
              data-testid="service-action-error"
              data-service-id={sid}
              style={{
                fontSize: 'var(--text-caption2)',
                color: E2E_STATUS_COLOR.failing,
                background: `color-mix(in srgb, ${E2E_STATUS_COLOR.failing} 10%, transparent)`,
                padding: 'var(--space-1) var(--space-2)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {sid}: {msg}
            </div>
          ))}
        </div>
      )}
      {!collapsed && (
        <div className="flex flex-col gap-3" style={{ padding: 'var(--space-3) var(--space-5) var(--space-4)' }}>
          {demos.length === 0 ? (
            <div style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              No demos yet for this {isUnassigned ? 'group' : 'service'}.
            </div>
          ) : (
            demos.map((demo) => (
              <DemoCard key={demo.slug} demo={demo} onSelectTask={onSelectTask} tasks={tasks} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
