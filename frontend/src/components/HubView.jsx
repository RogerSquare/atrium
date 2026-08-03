// Hub — the merged home of Loops and Demos (feat-project-hub-impl-001), now
// led by an automation Overview (feat-hub-rethink-impl-001).
//
// Overview is the landing tab: per-loop health cards + a merged activity
// feed. Loops/Demos keep ALL of their affordances (FR-065..084) — this
// component only owns the shared title, the sub-tab switch, and which one
// renders. The last-used sub-tab persists; AppShell migrates users whose
// stored view was 'loops' or 'demos' straight to the right tab. A card click
// on the Overview opens that loop's cockpit via the Loops tab (openLoopId).

import { useState, useCallback } from 'react'
import { Repeat, LayoutTemplate, Boxes, Gauge } from 'lucide-react'
import LoopsView from './LoopsView'
import DemosView from './DemosView'
import HubOverview from './HubOverview'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'loops', label: 'Loops', icon: Repeat },
  { id: 'demos', label: 'Demos', icon: LayoutTemplate },
]

export default function HubView({ projects = [], activeProject, socketRef, tasks = [], onSelectTask }) {
  const [tab, setTab] = useState(() => {
    const stored = localStorage.getItem('taskBoardHubTab')
    return TABS.some((t) => t.id === stored) ? stored : 'overview'
  })
  const [openLoopId, setOpenLoopId] = useState(null)
  const switchTab = useCallback((id) => {
    setOpenLoopId(null) // a plain tab click never re-opens a cockpit
    setTab(id)
    localStorage.setItem('taskBoardHubTab', id)
  }, [])
  // Overview card → the existing cockpit: land on Loops with the loop open.
  const openLoop = useCallback((loopId) => {
    setOpenLoopId(loopId)
    setTab('loops')
    localStorage.setItem('taskBoardHubTab', 'loops')
  }, [])

  const scoped = !!activeProject && activeProject !== 'All'

  return (
    <div data-testid="hub-view" className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 'var(--space-4)', padding: '0 var(--space-1)' }}>
        <h1 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <Boxes className="w-5 h-5" style={{ color: 'var(--accent-app)' }} />
          Hub{scoped ? ` · ${activeProject === 'Root' ? 'No project' : activeProject}` : ''}
        </h1>
        <div className="flex items-center gap-1" role="tablist" aria-label="Hub sections" style={{ background: 'var(--fill-secondary)', padding: '2px', borderRadius: 'var(--radius-full)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              data-testid={`hub-tab-${t.id}`}
              onClick={() => switchTab(t.id)}
              className="apple-press flex items-center gap-1.5"
              style={{
                padding: 'var(--space-1) var(--space-3)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-caption1)',
                fontWeight: 'var(--font-medium)',
                border: 'none',
                cursor: 'pointer',
                background: tab === t.id ? 'var(--bg-card)' : 'transparent',
                color: tab === t.id ? 'var(--text-app)' : 'var(--text-muted)',
                boxShadow: tab === t.id ? 'var(--shadow-card, 0 1px 2px rgba(0,0,0,0.2))' : 'none',
                transition: `all var(--duration-fast) var(--ease-default)`,
              }}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {tab === 'overview' ? (
          <HubOverview socketRef={socketRef} activeProject={activeProject} onOpenLoop={openLoop} onGoToLoops={() => switchTab('loops')} />
        ) : tab === 'loops' ? (
          <LoopsView projects={projects} activeProject={activeProject} socketRef={socketRef} openLoopId={openLoopId} embedded />
        ) : (
          <DemosView tasks={tasks} onSelectTask={onSelectTask} embedded />
        )}
      </div>
    </div>
  )
}
