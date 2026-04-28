// GraphView — task knowledge-graph view (vis-network).
//
// Renders all currently-visible tasks as a force-directed graph:
//   - Each task is a dot, colored by its first tag (deterministic hash).
//   - Each project gets a hub node (hexagon) that anchors its tasks.
//   - Edges:
//       hub→task   (gravity, low-opacity, no arrow)   — clusters tasks by project
//       parent→child  (parent_task, solid arrow)       — task hierarchy
//       task→dep   (depends_on, dashed arrow)          — cross-project deps highlighted
//
// Hubs are taken out of vis-network's physics (`physics: false`) so spring
// forces from tasks only pull tasks. A separate rAF loop handles hub-on-hub
// physics: linear attraction + inverse-square repulsion → settles at an
// equilibrium distance, projects can't merge but can drift toward each other
// when displaced.
//
// Filters live in a left panel: tags, status, time scope. Clicking a node
// fires onSelectTask, opening the existing TaskModal/DetailPane.

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Network } from 'vis-network'
import { DataSet } from 'vis-data'
import { Tag, Calendar, Filter, X } from 'lucide-react'

/* ------------------------------------------------------------------ *
 *  Constants
 * ------------------------------------------------------------------ */

const STATUSES = ['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done']

const STATUS_BORDER_COLOR = {
  draft: '#5b6072',
  todo: '#3a78c2',
  in_progress: '#c2932a',
  waiting_input: '#7a44a8',
  review: '#6a4ec2',
  done: '#3a8a55',
}

const TIME_SCOPES = [
  { value: 'all', label: 'All time', days: null },
  { value: '1d',  label: 'Last day', days: 1 },
  { value: '3d',  label: 'Last 3 days', days: 3 },
  { value: '1w',  label: 'Last week', days: 7 },
  { value: '3w',  label: 'Last 3 weeks', days: 21 },
  { value: '1m',  label: 'Last month', days: 30 },
]

// Category-prefix color scheme — matches the Changes view (ChangesView.jsx
// CATEGORY_STYLE) so the same task has the same color across views. Resolved
// from CSS variables at draw time so theme switches stay in sync.
const CATEGORY_COLOR = {
  bug:    'var(--apple-red)',
  feat:   'var(--apple-blue)',
  ui:     'var(--apple-teal)',
  opt:    'var(--apple-orange)',
  devops: 'var(--apple-purple)',
  comp:   'var(--gray-1)',
  mobile: 'var(--apple-pink)',
}
const OTHER_CATEGORY_COLOR = 'var(--gray-1)'
const CATEGORY_LABELS = ['feat', 'bug', 'ui', 'opt', 'devops', 'comp', 'mobile']

function categoryOf(taskId) {
  if (!taskId) return null
  const prefix = taskId.split('-')[0]?.toLowerCase()
  return CATEGORY_COLOR[prefix] ? prefix : null
}
function colorForTask(taskId) {
  const cat = categoryOf(taskId)
  return cat ? CATEGORY_COLOR[cat] : OTHER_CATEGORY_COLOR
}

// FNV-1a 32-bit hash — used for task-id → deterministic position offset.
function fnv1a(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Deterministic task-id → seed offset around its hub. Same task always lands in
// the same orbital slot, so re-rendering after a filter change doesn't reshuffle
// every node. (Pure function, safe inside useMemo.)
function seededOffset(taskId) {
  const h = fnv1a(taskId)
  const angle = ((h & 0xffff) / 0xffff) * Math.PI * 2
  const radius = 60 + (((h >>> 16) & 0xffff) / 0xffff) * 80
  return { angle, radius }
}

/* ------------------------------------------------------------------ *
 *  Utilities
 * ------------------------------------------------------------------ */

// Wrapped so the eslint react-hooks/purity rule doesn't flag Date.now() in useMemo.
// Cutoff intentionally depends on render time — when the user changes time-scope,
// useMemo re-runs and we want a fresh "now".
function nowMs() { return Date.now() }

function lastActivityTimestamp(task) {
  const log = task.activity_log
  if (Array.isArray(log) && log.length > 0) {
    const t = new Date(log[log.length - 1].timestamp).getTime()
    if (Number.isFinite(t)) return t
  }
  if (task.created_at) {
    const t = new Date(task.created_at).getTime()
    if (Number.isFinite(t)) return t
  }
  return 0
}

/* ------------------------------------------------------------------ *
 *  Component
 * ------------------------------------------------------------------ */

export default function GraphView({ tasks, projects, onSelectTask }) {
  // --- Local filter state -------------------------------------------------
  // Default: all statuses except `done` (graph stays focused on active work).
  const [filterStatuses, setFilterStatuses] = useState(() =>
    STATUSES.filter(s => s !== 'done')
  )
  const [filterTags, setFilterTags] = useState([])  // array of tag names; OR semantics
  const [timeScope, setTimeScope] = useState('all')
  const [showHubs, setShowHubs] = useState(true)

  // --- Refs ---------------------------------------------------------------
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  const datasetRef = useRef(null)
  const hubListRef = useRef([])           // [{id, hubX, hubY}]
  const hubVelocitiesRef = useRef({})     // hubId -> {vx, vy}
  const draggedRef = useRef(new Set())

  // --- Tag frequency map (for the legend + filter panel) ------------------
  const tagFrequency = useMemo(() => {
    const counts = new Map()
    for (const t of tasks) {
      const tt = Array.isArray(t.tags) ? t.tags : []
      for (const tag of tt) counts.set(tag, (counts.get(tag) || 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [tasks])

  // --- Filter pipeline ----------------------------------------------------
  const visibleTasks = useMemo(() => {
    const scope = TIME_SCOPES.find(s => s.value === timeScope)
    const cutoff = scope && scope.days != null ? nowMs() - scope.days * 86400000 : null
    const tagSet = filterTags.length > 0 ? new Set(filterTags) : null
    const statusSet = new Set(filterStatuses)

    return tasks.filter(t => {
      if (statusSet.size > 0 && !statusSet.has(t.status)) return false
      if (tagSet) {
        const tt = Array.isArray(t.tags) ? t.tags : []
        if (!tt.some(tg => tagSet.has(tg))) return false
      }
      if (cutoff !== null) {
        if (lastActivityTimestamp(t) < cutoff) return false
      }
      return true
    })
  }, [tasks, filterStatuses, filterTags, timeScope])

  // --- Build vis-network nodes/edges --------------------------------------
  const graphData = useMemo(() => {
    // Group tasks by project (only projects with at least one visible task).
    const byProject = new Map()
    for (const t of visibleTasks) {
      const name = t.project || 'Root'
      if (!byProject.has(name)) byProject.set(name, [])
      byProject.get(name).push(t)
    }

    // Place hubs evenly on a circle. Radius scales with project count so
    // clusters don't overlap when there are many projects.
    // Hub color palette — neutral grays + one accent for visual distinction
    // between projects, but deliberately not category-encoded (categories are
    // for tasks, project hubs just need to be tellable apart).
    const HUB_PALETTE = [
      'var(--apple-blue)', 'var(--apple-purple)', 'var(--apple-teal)',
      'var(--apple-orange)', 'var(--apple-pink)', 'var(--apple-green)',
      'var(--apple-red)', 'var(--gray-1)',
    ]
    const projList = []
    let i = 0
    const N = byProject.size
    const ringR = Math.max(600, N * 90)
    for (const [name, projTasks] of byProject) {
      const angle = N === 0 ? 0 : (i / N) * Math.PI * 2
      const matchedProject = projects.find(p => (p.folder || p.name) === name)
      const hubColor = HUB_PALETTE[fnv1a(name) % HUB_PALETTE.length]
      projList.push({
        name,
        displayName: matchedProject?.name || name,
        color: hubColor,
        hubX: Math.cos(angle) * ringR,
        hubY: Math.sin(angle) * ringR,
        taskCount: projTasks.length,
      })
      i++
    }

    // Build task nodes
    const visibleIds = new Set(visibleTasks.map(t => t.id))
    const projectByName = new Map(projList.map(p => [p.name, p]))
    const taskNodes = visibleTasks.map(t => {
      const proj = projectByName.get(t.project || 'Root')
      const off = seededOffset(t.id || '')
      const offR = off.radius
      const offA = off.angle
      const fill = colorForTask(t.id)
      const border = STATUS_BORDER_COLOR[t.status] || '#3a4150'
      const size = t.priority === 'high' ? 14 : t.priority === 'medium' ? 10 : 7
      return {
        id: t.id,
        label: t.id || '',
        size,
        shape: 'dot',
        x: proj ? proj.hubX + Math.cos(offA) * offR : 0,
        y: proj ? proj.hubY + Math.sin(offA) * offR : 0,
        color: { background: fill, border, highlight: { background: fill, border: '#ffffff' } },
        borderWidth: 2,
        // `vadjust` pushes the label below the dot; combined with `scaling.label.drawThreshold`
        // (set on the network options) labels stay readable when zoomed in but fade out at
        // overview zoom levels so they don't visually clutter the cluster shapes.
        font: {
          color: '#dde1ea',
          size: 11,
          face: 'system-ui, sans-serif',
          strokeColor: '#0e0f12',
          strokeWidth: 2,
          vadjust: 8,
        },
        _task: t,
      }
    })

    // Build hub nodes (one per project with visible tasks)
    const hubNodes = projList.map(proj => ({
      id: `__hub:${proj.name}`,
      label: showHubs ? `${proj.displayName} · ${proj.taskCount}` : '',
      shape: 'hexagon',
      size: showHubs ? 22 : 1,
      x: proj.hubX,
      y: proj.hubY,
      mass: 100,
      physics: false,  // anchor — hub-task springs only pull tasks
      color: {
        background: showHubs ? proj.color : 'rgba(0,0,0,0)',
        border: showHubs ? '#ffffff' : 'rgba(0,0,0,0)',
        highlight: { background: proj.color, border: '#ffffff' },
      },
      borderWidth: showHubs ? 1.5 : 0,
      font: { color: '#ffffff', size: 14, face: 'system-ui, sans-serif', strokeColor: '#0e0f12', strokeWidth: 3, bold: true },
      _isHub: true,
    }))

    // Edges
    const edges = []
    // Hub springs (drives clustering) — invisible-ish
    for (const t of visibleTasks) {
      const projName = t.project || 'Root'
      edges.push({
        id: `hub:${t.id}`,
        from: `__hub:${projName}`,
        to: t.id,
        length: 60,
        color: { color: '#3a4150', opacity: showHubs ? 0.10 : 0 },
        width: 0.5,
        smooth: false,
      })
    }
    // parent_task edges
    for (const t of visibleTasks) {
      if (t.parent_task && visibleIds.has(t.parent_task)) {
        edges.push({
          id: `p:${t.parent_task}->${t.id}`,
          from: t.parent_task,
          to: t.id,
          arrows: 'to',
          color: { color: '#4a5060', opacity: 0.7 },
          length: 50,
        })
      }
    }
    // depends_on edges
    const taskById = new Map(visibleTasks.map(t => [t.id, t]))
    for (const t of visibleTasks) {
      if (Array.isArray(t.depends_on)) {
        for (const depId of t.depends_on) {
          if (!visibleIds.has(depId)) continue
          const dep = taskById.get(depId)
          const isCross = dep && (dep.project || 'Root') !== (t.project || 'Root')
          edges.push({
            id: `d:${t.id}->${depId}`,
            from: t.id,
            to: depId,
            arrows: 'to',
            dashes: true,
            color: { color: isCross ? '#c2932a' : '#5a6072', opacity: 0.55 },
            length: isCross ? 240 : 70,
          })
        }
      }
    }

    return {
      nodes: [...hubNodes, ...taskNodes],
      hubs: hubNodes,
      edges,
      projects: projList,
    }
  }, [visibleTasks, projects, showHubs])

  // --- Init / refresh network on data change ------------------------------
  useEffect(() => {
    if (!containerRef.current) return

    const data = {
      nodes: new DataSet(graphData.nodes),
      edges: new DataSet(graphData.edges),
    }
    datasetRef.current = data
    hubListRef.current = graphData.hubs.map(h => ({ id: h.id, hubX: h.x, hubY: h.y }))

    const options = {
      nodes: {
        shape: 'dot',
        // Label scaling: at default zoom the user sees colored dots; zooming in
        // reveals task IDs underneath. drawThreshold is the minimum on-screen
        // font px below which the label isn't rendered, so overview is clean.
        scaling: {
          label: { enabled: true, min: 8, max: 22, drawThreshold: 7, maxVisible: 22 },
        },
      },
      edges: {
        width: 0.5,
        smooth: false,
        arrows: { to: { enabled: false } },  // per-edge `arrows: 'to'` still applies
      },
      physics: {
        enabled: true,
        solver: 'repulsion',
        repulsion: {
          nodeDistance: 120,
          centralGravity: 0.05,
          springLength: 120,
          springConstant: 0.05,
          damping: 0.55,
        },
        maxVelocity: 50,
        minVelocity: 0.75,
        timestep: 0.35,
        stabilization: { enabled: true, iterations: 200, fit: true },
      },
      interaction: {
        hover: true,
        hideEdgesOnDrag: true,
        hideEdgesOnZoom: true,
      },
      layout: { improvedLayout: false },
    }

    if (networkRef.current) {
      networkRef.current.destroy()
      networkRef.current = null
    }
    const net = new Network(containerRef.current, data, options)
    networkRef.current = net

    draggedRef.current.clear()
    net.on('dragStart', p => (p.nodes || []).forEach(id => draggedRef.current.add(id)))
    net.on('dragEnd', p => (p.nodes || []).forEach(id => draggedRef.current.delete(id)))

    net.on('click', p => {
      if (!p.nodes || p.nodes.length === 0) return
      const id = p.nodes[0]
      const node = data.nodes.get(id)
      if (node && node._task && onSelectTask) onSelectTask(node._task)
    })

    // Reset hub velocities for new graph
    hubVelocitiesRef.current = {}
    for (const h of graphData.hubs) hubVelocitiesRef.current[h.id] = { vx: 0, vy: 0 }

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy()
        networkRef.current = null
      }
    }
  }, [graphData, onSelectTask])

  // --- Custom hub physics loop -------------------------------------------
  // Hubs are `physics: false` in vis-network. This loop computes hub-on-hub
  // forces only — attraction + repulsion → equilibrium distance.
  useEffect(() => {
    let raf
    const ATTR = 0.0008
    const REP = 30000
    const MASS = 100
    const DECAY = 0.7

    const tick = () => {
      const net = networkRef.current
      const hubs = hubListRef.current
      if (net && hubs && hubs.length > 0 && net.body && net.body.nodes) {
        let anyMotion = false
        for (let i = 0; i < hubs.length; i++) {
          const aId = hubs[i].id
          if (draggedRef.current.has(aId)) continue
          const a = net.body.nodes[aId]
          if (!a) continue
          let fx = 0, fy = 0
          for (let j = 0; j < hubs.length; j++) {
            if (i === j) continue
            const b = net.body.nodes[hubs[j].id]
            if (!b) continue
            const dx = b.x - a.x
            const dy = b.y - a.y
            const r2 = dx * dx + dy * dy + 100
            const r = Math.sqrt(r2)
            const F = ATTR * r - REP / r2
            fx += (dx / r) * F
            fy += (dy / r) * F
          }
          const v = hubVelocitiesRef.current[aId] || (hubVelocitiesRef.current[aId] = { vx: 0, vy: 0 })
          v.vx = (v.vx + fx / MASS) * DECAY
          v.vy = (v.vy + fy / MASS) * DECAY
          const speed2 = v.vx * v.vx + v.vy * v.vy
          if (speed2 > 25) {
            const s = 5 / Math.sqrt(speed2)
            v.vx *= s; v.vy *= s
          }
          if (speed2 > 0.0004) {
            a.x += v.vx
            a.y += v.vy
            anyMotion = true
          }
        }
        if (anyMotion) net.redraw()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // --- Filter UI handlers -------------------------------------------------
  const toggleStatus = useCallback((status) => {
    setFilterStatuses(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    )
  }, [])
  const toggleTag = useCallback((tag) => {
    setFilterTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }, [])
  const resetFilters = useCallback(() => {
    setFilterStatuses(STATUSES.filter(s => s !== 'done'))
    setFilterTags([])
    setTimeScope('all')
  }, [])

  // --- Render -------------------------------------------------------------
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '260px 1fr',
        gap: 'var(--space-3)',
        height: '100%',
        minHeight: '60vh',
      }}
    >
      <aside
        className="custom-scrollbar"
        style={{
          overflowY: 'auto',
          padding: 'var(--space-3)',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--text-caption1)',
        }}
      >
        {/* Category legend (color key) */}
        <FilterSection title="Category (color)">
          <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
            {CATEGORY_LABELS.map(cat => (
              <span
                key={cat}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '2px 6px',
                  fontSize: 'var(--text-caption2)',
                  color: 'var(--text-muted)',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLOR[cat] }} />
                {cat}
              </span>
            ))}
          </div>
        </FilterSection>

        {/* Time scope */}
        <FilterSection icon={Calendar} title="Time scope">
          <div className="flex flex-col gap-1">
            {TIME_SCOPES.map(scope => (
              <label
                key={scope.value}
                className="flex items-center gap-2 cursor-pointer"
                style={{ padding: '4px 6px', borderRadius: 'var(--radius-sm)', background: timeScope === scope.value ? 'var(--fill-primary)' : 'transparent' }}
              >
                <input
                  type="radio"
                  name="time-scope"
                  value={scope.value}
                  checked={timeScope === scope.value}
                  onChange={() => setTimeScope(scope.value)}
                  style={{ accentColor: 'var(--accent-app)' }}
                />
                <span style={{ color: timeScope === scope.value ? 'var(--text-app)' : 'var(--text-muted)' }}>
                  {scope.label}
                </span>
              </label>
            ))}
          </div>
        </FilterSection>

        {/* Status */}
        <FilterSection icon={Filter} title="Status">
          <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
            {STATUSES.map(status => {
              const active = filterStatuses.includes(status)
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className="apple-press"
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? STATUS_BORDER_COLOR[status] : 'var(--separator)'}`,
                    background: active ? `color-mix(in srgb, ${STATUS_BORDER_COLOR[status]} 18%, transparent)` : 'transparent',
                    color: active ? 'var(--text-app)' : 'var(--text-muted)',
                    fontSize: 'var(--text-caption2)',
                    fontWeight: 'var(--font-medium)',
                    cursor: 'pointer',
                  }}
                >
                  {status.replace('_', ' ')}
                </button>
              )
            })}
          </div>
        </FilterSection>

        {/* Tags */}
        <FilterSection icon={Tag} title={`Tags${filterTags.length ? ` (${filterTags.length})` : ''}`}>
          {tagFrequency.length === 0 ? (
            <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-caption2)', padding: '6px 0' }}>
              No tags in current dataset.
            </div>
          ) : (
            <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
              {tagFrequency.map(([tag, count]) => {
                const active = filterTags.includes(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className="apple-press"
                    title={`${tag} — ${count} task${count === 1 ? '' : 's'}`}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      border: `1px solid ${active ? 'var(--accent-app)' : 'var(--separator)'}`,
                      background: active ? 'color-mix(in srgb, var(--accent-app) 18%, transparent)' : 'transparent',
                      color: active ? 'var(--text-app)' : 'var(--text-muted)',
                      fontSize: 'var(--text-caption2)',
                      fontWeight: 'var(--font-medium)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    {tag}
                    <span style={{ color: 'var(--text-tertiary)', marginLeft: 2 }}>{count}</span>
                  </button>
                )
              })}
            </div>
          )}
        </FilterSection>

        {/* Display options */}
        <FilterSection title="Display">
          <label className="flex items-center justify-between" style={{ padding: '4px 0' }}>
            <span style={{ color: 'var(--text-muted)' }}>Show project hubs</span>
            <input
              type="checkbox"
              checked={showHubs}
              onChange={e => setShowHubs(e.target.checked)}
              style={{ accentColor: 'var(--accent-app)' }}
            />
          </label>
        </FilterSection>

        {/* Reset */}
        <button
          onClick={resetFilters}
          className="apple-press"
          style={{
            marginTop: 'var(--space-2)',
            width: '100%',
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            border: 'var(--border-hairline)',
            background: 'transparent',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-caption2)',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <X className="w-3 h-3" /> Reset filters
        </button>

        {/* Counts */}
        <div
          style={{
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-2)',
            borderTop: 'var(--border-hairline)',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--text-caption2)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {visibleTasks.length} of {tasks.length} tasks · {graphData.projects.length} projects
        </div>
      </aside>

      <div
        style={{
          position: 'relative',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 *  FilterSection — small sectioned wrapper for the left panel
 * ------------------------------------------------------------------ */
function FilterSection({ icon: Icon, title, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-3)' }}>
      <h3
        style={{
          margin: 0,
          marginBottom: 'var(--space-1)',
          fontSize: 'var(--text-caption2)',
          fontWeight: 'var(--font-semibold)',
          color: 'var(--text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {Icon ? <Icon className="w-3 h-3" /> : null}
        {title}
      </h3>
      {children}
    </div>
  )
}
