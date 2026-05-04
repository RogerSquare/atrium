import { useState } from 'react'
import { ChevronDown, ChevronRight, Server } from 'lucide-react'
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
      }}
    />
  )
}

export default function ServiceGroup({ group, services = [], demos = [], tasks = [], onSelectTask, defaultCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const isUnassigned = group === 'Unassigned'
  const runningCount = services.filter((s) => s.status === 'running').length

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
      <button
        data-testid="service-group-header"
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-3 apple-press"
        style={{
          padding: 'var(--space-3) var(--space-5)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {collapsed ? <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
        {!isUnassigned && <Server className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />}
        <span style={{ fontSize: 'var(--text-body)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          {group}
        </span>
        {!isUnassigned && services.length > 0 && (
          <span className="flex items-center gap-1" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
            {services.map((s) => <StatusDot key={s.id} status={s.status} />)}
            <span style={{ marginLeft: 'var(--space-1)' }}>
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
      </button>
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
