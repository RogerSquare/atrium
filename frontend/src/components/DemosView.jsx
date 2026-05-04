import { useEffect, useState, useCallback, useMemo } from 'react'
import { RefreshCw, Eye, EyeOff } from 'lucide-react'
import { apiFetch } from '../config'
import { useTaskData } from '../contexts/TaskContext'
import { E2E_STATUS_COLOR } from '../constants'
import ServiceGroup from './ServiceGroup'

// Top-level "Demos" view (v2) — lists service groups, demos nested inside.
// Auto-follows the global activeProject filter. When activeProject is
// 'All' (no filter), every group renders. Service groups with no demos
// hide by default; "Show all services" toggle reveals them.
//
// See feat-demos-services-grouping-001-implement plan.

export default function DemosView({ tasks = [], onSelectTask }) {
  const { activeProject } = useTaskData()
  const [groups, setGroups] = useState([])
  const [state, setState] = useState('loading') // 'loading' | 'ok' | 'error'
  const [error, setError] = useState(null)
  const [showAllServices, setShowAllServices] = useState(false)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    try {
      const res = await apiFetch('/api/demos/grouped')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setGroups(Array.isArray(body) ? body : [])
      setState('ok')
    } catch (e) {
      setError(e.message)
      setState('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Apply the active-project filter and the empty-group toggle.
  const visibleGroups = useMemo(() => {
    if (state !== 'ok') return []
    const filterByProject = activeProject && activeProject !== 'All'
    return groups
      .filter((g) => {
        if (filterByProject) {
          // Show this group only if its name matches the active project,
          // OR it's the Unassigned bucket containing demos in this project
          // (rare: a demo whose task lives under activeProject but has no
          // matching service.group — surfaces via Unassigned).
          if (g.group === 'Unassigned') return g.demos.length > 0
          return g.group === activeProject
        }
        return true
      })
      .filter((g) => showAllServices || g.demos.length > 0 || g.group === 'Unassigned')
  }, [groups, activeProject, showAllServices, state])

  const totalDemos = useMemo(
    () => visibleGroups.reduce((sum, g) => sum + g.demos.length, 0),
    [visibleGroups]
  )

  return (
    <div
      data-testid="demos-view"
      className="flex-1 flex flex-col min-h-0 overflow-y-auto custom-scrollbar"
      style={{ padding: 'var(--space-5) var(--space-6)' }}
    >
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 'var(--space-4)' }}>
        <h1 style={{ fontSize: 'var(--text-title2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
          Demos
        </h1>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--fill-secondary)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-caption1)',
            fontWeight: 'var(--font-semibold)',
          }}
        >
          {totalDemos}
        </span>
        {activeProject && activeProject !== 'All' && (
          <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>
            filtered to <strong style={{ color: 'var(--text-app)' }}>{activeProject === 'Root' ? 'Unassigned' : activeProject}</strong>
          </span>
        )}
        <button
          data-testid="demos-show-all-services-toggle"
          onClick={() => setShowAllServices((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 apple-press"
          style={{
            padding: 'var(--space-1) var(--space-3)',
            borderRadius: 'var(--radius-sm)',
            background: showAllServices ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)',
            color: showAllServices ? 'var(--accent-app)' : 'var(--text-app)',
            fontSize: 'var(--text-caption1)',
            fontWeight: 'var(--font-medium)',
            border: 'none',
            cursor: 'pointer',
          }}
          title={showAllServices ? 'Hide services with no demos' : 'Show services with no demos'}
        >
          {showAllServices ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {showAllServices ? 'All services' : 'Demos only'}
        </button>
      </div>

      {state === 'loading' && (
        <div className="text-center py-12 italic animate-pulse" style={{ color: 'var(--text-muted)' }}>
          Loading demos…
        </div>
      )}

      {state === 'error' && (
        <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-body)', color: E2E_STATUS_COLOR.failing }}>
            Could not load demos: {error}
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1 apple-press"
            style={{
              padding: 'var(--space-1) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--fill-secondary)',
              color: 'var(--text-app)',
              fontSize: 'var(--text-caption1)',
              fontWeight: 'var(--font-medium)',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
      )}

      {state === 'ok' && visibleGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center" style={{ padding: 'var(--space-8) var(--space-6)', gap: 'var(--space-3)' }}>
          <div style={{ fontSize: 'var(--text-body)', color: 'var(--text-muted)' }}>
            {activeProject && activeProject !== 'All'
              ? `No demos in ${activeProject === 'Root' ? 'Unassigned' : activeProject}.`
              : 'No demos found.'}
          </div>
          <div style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', maxWidth: '480px', textAlign: 'center' }}>
            Add a directory under <code>frontend/public/&lt;slug&gt;/</code> with an <code>index.html</code> to make it appear here.
            Pair it with a Playwright spec at <code>frontend/tests/e2e/&lt;slug&gt;.spec.js</code> for cross-linked test runs.
          </div>
        </div>
      )}

      {state === 'ok' && visibleGroups.length > 0 && (
        <div className="flex flex-col gap-4" style={{ maxWidth: '760px' }}>
          {visibleGroups.map((g) => (
            <ServiceGroup
              key={g.group}
              group={g.group}
              services={g.services}
              demos={g.demos}
              tasks={tasks}
              onSelectTask={onSelectTask}
              defaultCollapsed={g.demos.length === 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
