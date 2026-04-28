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
import { Calendar, Filter, X } from 'lucide-react'

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
// CATEGORY_STYLE) so the same task has the same color across views. Two maps:
//
//   CATEGORY_COLOR_VAR  — `var(--apple-*)` strings; safe in the React DOM
//                          (legend swatches) where CSS resolves them.
//   resolveCategoryHex() — reads computed --apple-* values at runtime so the
//                          canvas-bound vis-network nodes get real hex.
//                          Canvas `fillStyle` does NOT resolve CSS variables.
const CATEGORY_COLOR_VAR = {
  bug:    'var(--apple-red)',
  feat:   'var(--apple-blue)',
  ui:     'var(--apple-teal)',
  opt:    'var(--apple-orange)',
  devops: 'var(--apple-purple)',
  comp:   'var(--gray-1)',
  mobile: 'var(--apple-pink)',
}
const CATEGORY_VAR_NAMES = {
  bug: '--apple-red',
  feat: '--apple-blue',
  ui: '--apple-teal',
  opt: '--apple-orange',
  devops: '--apple-purple',
  comp: '--gray-1',
  mobile: '--apple-pink',
}
const CATEGORY_FALLBACK = {
  bug: '#FF453A', feat: '#0A84FF', ui: '#64D2FF', opt: '#FF9F0A',
  devops: '#BF5AF2', comp: '#8E8E93', mobile: '#FF375F',
}
const CATEGORY_LABELS = ['feat', 'bug', 'ui', 'opt', 'devops', 'comp', 'mobile']
const OTHER_CATEGORY_VAR = 'var(--gray-1)'
const OTHER_CATEGORY_FALLBACK = '#8E8E93'

function readCssVar(name, fallback) {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}
function resolveCategoryHex() {
  const out = {}
  for (const cat of CATEGORY_LABELS) {
    out[cat] = readCssVar(CATEGORY_VAR_NAMES[cat], CATEGORY_FALLBACK[cat])
  }
  out.__other__ = readCssVar('--gray-1', OTHER_CATEGORY_FALLBACK)
  return out
}

function categoryOf(taskId) {
  if (!taskId) return null
  const prefix = taskId.split('-')[0]?.toLowerCase()
  return CATEGORY_COLOR_VAR[prefix] ? prefix : null
}
function colorForTask(taskId, hexMap) {
  const cat = categoryOf(taskId)
  return cat ? hexMap[cat] : hexMap.__other__
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

// --- Filter persistence -------------------------------------------------
// Filters survive reload and view switch. v1 prefix lets us version-bump
// the storage shape if it ever changes.
const FILTERS_STORAGE_KEY = 'atrium-graph-filters-v1'
const VALID_STATUSES = new Set(['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done'])
const VALID_TIME_SCOPES = new Set(['all', '1d', '3d', '1w', '3w', '1m'])
const OTHER_CATEGORY_KEY = '__other__'
const VALID_CATEGORIES = new Set([...CATEGORY_LABELS, OTHER_CATEGORY_KEY])
const DEFAULT_STATUSES = ['draft', 'todo', 'in_progress', 'waiting_input', 'review']
const DEFAULT_CATEGORIES = [...CATEGORY_LABELS, OTHER_CATEGORY_KEY]

function loadJsonObject(key) {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
function saveJson(key, value) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota / disabled — fail silent, in-memory state still works for the session
  }
}
// Sanitize on load so a malformed/old/forward-versioned payload can't put
// the UI in a broken state — drop unknown values per field, fall back to
// defaults if a field's filtered list is empty.
function loadInitialFilters() {
  const raw = loadJsonObject(FILTERS_STORAGE_KEY)
  if (!raw) return { filterStatuses: DEFAULT_STATUSES, timeScope: 'all', filterCategories: DEFAULT_CATEGORIES }
  const filterStatuses = Array.isArray(raw.filterStatuses)
    ? raw.filterStatuses.filter(s => VALID_STATUSES.has(s))
    : DEFAULT_STATUSES
  const timeScope = VALID_TIME_SCOPES.has(raw.timeScope) ? raw.timeScope : 'all'
  const filterCategories = Array.isArray(raw.filterCategories)
    ? raw.filterCategories.filter(c => VALID_CATEGORIES.has(c))
    : DEFAULT_CATEGORIES
  return {
    filterStatuses: filterStatuses.length > 0 ? filterStatuses : DEFAULT_STATUSES,
    timeScope,
    filterCategories: filterCategories.length > 0 ? filterCategories : DEFAULT_CATEGORIES,
  }
}

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
  // Initial values come from localStorage (sanitized in loadInitialFilters).
  // Defaults for first-time users: all statuses except `done`, all-time scope,
  // every category selected (filter is a no-op).
  const [filterStatuses, setFilterStatuses] = useState(() => loadInitialFilters().filterStatuses)
  const [timeScope, setTimeScope] = useState(() => loadInitialFilters().timeScope)
  const [filterCategories, setFilterCategories] = useState(() => loadInitialFilters().filterCategories)

  // Persist filters whenever they change. Cheap debounceless write — toggling
  // a chip just writes a small JSON blob; no perf concern at this size.
  useEffect(() => {
    saveJson(FILTERS_STORAGE_KEY, { filterStatuses, timeScope, filterCategories })
  }, [filterStatuses, timeScope, filterCategories])

  // Category chip set — always show the seven standard prefixes; conditionally
  // include `other` when at least one task in the dataset has a non-standard
  // prefix (legacy IDs). Memoized so the chip list is stable across renders.
  const categoryChipKinds = useMemo(() => {
    const hasOther = tasks.some(t => categoryOf(t.id) === null)
    const out = CATEGORY_LABELS.map(cat => ({
      key: cat,
      color: CATEGORY_COLOR_VAR[cat],
      label: cat,
    }))
    if (hasOther) out.push({ key: OTHER_CATEGORY_KEY, color: OTHER_CATEGORY_VAR, label: 'other' })
    return out
  }, [tasks])
  const [showHubs] = useState(true)
  // Spring length and showHubs are kept as state (so the network and the
  // spring-length effect can react), but the controls are intentionally not
  // surfaced in the side panel — defaults are good enough that exposing them
  // was just noise. Reintroduce as sliders/toggles later if they're needed.
  const [springLength] = useState(350)
  const springLengthRef = useRef(350)
  useEffect(() => { springLengthRef.current = springLength }, [springLength])

  // --- Refs ---------------------------------------------------------------
  const containerRef = useRef(null)
  const networkRef = useRef(null)
  const datasetRef = useRef(null)
  const hubListRef = useRef([])           // [{id, hubX, hubY}]
  const hubVelocitiesRef = useRef({})     // hubId -> {vx, vy}
  const draggedRef = useRef(new Set())

  // --- Filter pipeline ----------------------------------------------------
  const visibleTasks = useMemo(() => {
    const scope = TIME_SCOPES.find(s => s.value === timeScope)
    const cutoff = scope && scope.days != null ? nowMs() - scope.days * 86400000 : null
    const statusSet = new Set(filterStatuses)
    const categorySet = new Set(filterCategories)
    // Only enforce the category axis when the user has narrowed it — every
    // chip selected is the no-op default and shouldn't run a per-task check.
    const categoryFiltered = categorySet.size > 0 && categorySet.size < (CATEGORY_LABELS.length + 1)

    return tasks.filter(t => {
      if (statusSet.size > 0 && !statusSet.has(t.status)) return false
      if (cutoff !== null) {
        if (lastActivityTimestamp(t) < cutoff) return false
      }
      if (categoryFiltered) {
        const cat = categoryOf(t.id) || OTHER_CATEGORY_KEY
        if (!categorySet.has(cat)) return false
      }
      return true
    })
  }, [tasks, filterStatuses, timeScope, filterCategories])

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
    // Resolve theme-driven hex values once per build. CSS vars don't work in
    // canvas, so vis-network needs real colors.
    const categoryHex = resolveCategoryHex()
    // Hub palette — neutral accent colors so projects are visually separable
    // but not category-encoded. Resolved to hex for the canvas renderer.
    const HUB_PALETTE = [
      readCssVar('--apple-blue',   '#0A84FF'),
      readCssVar('--apple-purple', '#BF5AF2'),
      readCssVar('--apple-teal',   '#64D2FF'),
      readCssVar('--apple-orange', '#FF9F0A'),
      readCssVar('--apple-pink',   '#FF375F'),
      readCssVar('--apple-green',  '#30D158'),
      readCssVar('--apple-red',    '#FF453A'),
      readCssVar('--gray-1',       '#8E8E93'),
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
      const fill = colorForTask(t.id, categoryHex)
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
        // Thin border lets the category fill dominate; at the smallest dot size (7px)
        // a 2px ring used to make all-done filters look monochrome.
        borderWidth: 1.5,
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
    // Edges store a relative `_factor` instead of an absolute length; the
    // springLength effect (below) applies `springLength × _factor` via
    // DataSet.update() so the slider can re-tune layout without rebuilding
    // the network. Factors hand-tuned for visual hierarchy:
    //   hub→task   1.00 — the "spring length" the user controls directly
    //   parent     0.85 — slightly tighter than hub springs
    //   depends    1.20 — a bit looser, so deps don't crowd parents
    //   depends    2.80 — cross-project deps stretch across hubs without
    //                     pulling clusters together
    for (const t of visibleTasks) {
      const projName = t.project || 'Root'
      edges.push({
        id: `hub:${t.id}`,
        from: `__hub:${projName}`,
        to: t.id,
        _factor: 1.0,
        color: { color: '#3a4150', opacity: showHubs ? 0.10 : 0 },
        width: 0.5,
        smooth: false,
      })
    }
    for (const t of visibleTasks) {
      if (t.parent_task && visibleIds.has(t.parent_task)) {
        edges.push({
          id: `p:${t.parent_task}->${t.id}`,
          from: t.parent_task,
          to: t.id,
          arrows: 'to',
          color: { color: '#4a5060', opacity: 0.7 },
          _factor: 0.85,
        })
      }
    }
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
            _factor: isCross ? 2.8 : 1.2,
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

    // Edges arrive with a `_factor` only — apply the current springLength to
    // each one before handing them to DataSet, so the network is born at the
    // user's chosen scale instead of the factor-1 default of 1px.
    const sl = springLengthRef.current
    const edgesWithLength = graphData.edges.map(e =>
      typeof e._factor === 'number' ? { ...e, length: sl * e._factor } : e
    )
    const data = {
      nodes: new DataSet(graphData.nodes),
      edges: new DataSet(edgesWithLength),
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
          // springLength + nodeDistance scale with the slider state. A live
          // effect (below) calls setOptions when the user drags the slider.
          nodeDistance: sl * 1.5,
          centralGravity: 0.05,
          springLength: sl,
          springConstant: 0.05,
          // Lower damping → motion lingers longer; perpetual Brownian impulses
          // from the rAF loop keep the system from coasting to a stop.
          damping: 0.4,
        },
        maxVelocity: 50,
        // Very low minVelocity prevents vis-network's auto-pause. Combined
        // with per-frame Brownian impulses (see custom rAF loop below) the
        // engine never reaches its "stable" condition, so motion is continuous.
        minVelocity: 0.01,
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

  // --- Live spring-length updates ----------------------------------------
  // Avoid rebuilding the network on every slider tick: walk the existing
  // edge DataSet, scale each edge's `length` by its `_factor`, then push
  // new repulsion params via setOptions. Both ops are O(edges) and fast.
  useEffect(() => {
    const data = datasetRef.current
    const net = networkRef.current
    if (!data || !net) return
    const updates = []
    data.edges.forEach(e => {
      if (typeof e._factor === 'number') {
        updates.push({ id: e.id, length: springLength * e._factor })
      }
    })
    if (updates.length > 0) data.edges.update(updates)
    net.setOptions({
      physics: {
        repulsion: {
          springLength,
          nodeDistance: springLength * 1.5,
        },
      },
    })
  }, [springLength])

  // --- Custom hub physics + perpetual task motion ------------------------
  // Two roles for this rAF loop:
  //
  //   1. Hub-on-hub physics. Hubs are `physics: false` in vis-network so
  //      task spring forces don't pull them. Their motion comes entirely
  //      from this loop: linear attraction + inverse-square repulsion → an
  //      equilibrium distance, no merging.
  //
  //   2. Brownian impulses on tasks. vis-network auto-pauses physics once
  //      every node's velocity is below `minVelocity` — that's why the
  //      graph used to freeze. Adding a tiny random velocity to each task
  //      every frame keeps the system above the threshold so the engine
  //      never stops simulating, and the natural damping means the random
  //      noise reads as gentle drift rather than jitter.
  useEffect(() => {
    let raf
    const ATTR = 0.0008
    const REP = 30000
    const HUB_MASS = 100
    const HUB_DECAY = 0.7
    // Magnitude of per-frame random impulse on tasks. Small enough that
    // each impulse is sub-pixel; the cumulative effect is gentle drift.
    const BROWNIAN = 0.08

    const tick = () => {
      const net = networkRef.current
      const hubs = hubListRef.current
      if (net && net.body && net.body.nodes) {
        const bodyNodes = net.body.nodes

        // Hub physics
        if (hubs && hubs.length > 0) {
          let anyMotion = false
          for (let i = 0; i < hubs.length; i++) {
            const aId = hubs[i].id
            if (draggedRef.current.has(aId)) continue
            const a = bodyNodes[aId]
            if (!a) continue
            let fx = 0, fy = 0
            for (let j = 0; j < hubs.length; j++) {
              if (i === j) continue
              const b = bodyNodes[hubs[j].id]
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
            v.vx = (v.vx + fx / HUB_MASS) * HUB_DECAY
            v.vy = (v.vy + fy / HUB_MASS) * HUB_DECAY
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

        // Brownian impulses on tasks. Walks the physics body's index of
        // simulated node ids — skips hubs (they have physics:false so they
        // aren't in this index anyway) and skips dragged nodes so a drag
        // isn't fighting against random noise.
        const phys = net.physics && net.physics.physicsBody
        const indices = phys && phys.physicsNodeIndices
        if (indices) {
          for (let i = 0; i < indices.length; i++) {
            const id = indices[i]
            if (draggedRef.current.has(id)) continue
            const n = bodyNodes[id]
            if (!n) continue
            // Tiny random velocity nudge keeps the engine above minVelocity
            // and causes sub-pixel drift through the spring/damping system.
            n.vx += (Math.random() - 0.5) * BROWNIAN
            n.vy += (Math.random() - 0.5) * BROWNIAN
          }
        }
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
  const toggleCategory = useCallback((cat) => {
    setFilterCategories(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }, [])
  const resetFilters = useCallback(() => {
    // The persistence effect re-saves the defaults, so storage matches the
    // visible state. No need to delete the storage key.
    setFilterStatuses(DEFAULT_STATUSES)
    setTimeScope('all')
    setFilterCategories(DEFAULT_CATEGORIES)
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
        {/* Category — filter + color key. Each chip's swatch matches the
            dot fill color, so the chip serves both roles. */}
        <FilterSection title="Category">
          <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
            {categoryChipKinds.map(({ key, color, label }) => {
              const active = filterCategories.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleCategory(key)}
                  className="apple-press"
                  title={`Toggle ${label}`}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? color : 'var(--separator)'}`,
                    background: active ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent',
                    color: active ? 'var(--text-app)' : 'var(--text-muted)',
                    fontSize: 'var(--text-caption2)',
                    fontWeight: 'var(--font-medium)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
                  {label}
                </button>
              )
            })}
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
