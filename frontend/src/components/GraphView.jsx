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
import { Calendar, Filter, GitBranch, X } from 'lucide-react'

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

// Wrapped so the eslint react-hooks/purity rule doesn't flag Date.now() in useMemo.
// Cutoff intentionally depends on render time — when the user changes time-scope,
// useMemo re-runs and we want a fresh "now".
function nowMs() { return Date.now() }

// Position persistence — survives reload, separate task / hub IDs share the
// same key namespace. v1 prefix lets us version-bump if the format changes.
const POSITIONS_STORAGE_KEY = 'atrium-graph-positions-v1'
const FILTERS_STORAGE_KEY = 'atrium-graph-filters-v1'

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

function loadPositions() {
  return loadJsonObject(POSITIONS_STORAGE_KEY) || {}
}
function persistPositions(positions) {
  saveJson(POSITIONS_STORAGE_KEY, positions)
}

const VALID_STATUSES = new Set(['draft', 'todo', 'in_progress', 'waiting_input', 'review', 'done'])
const VALID_TIME_SCOPES = new Set(['all', '1d', '3d', '1w', '3w', '1m'])
const VALID_BRANCH_FILTERS = new Set(['has', 'none'])
const DEFAULT_STATUSES = ['draft', 'todo', 'in_progress', 'waiting_input', 'review']
const DEFAULT_BRANCH_FILTER = ['has', 'none']  // both = no filter

// Sanitize on load so a malformed/old payload can't put the UI in a broken
// state — fall back to defaults for any field that fails validation.
function loadInitialFilters() {
  const raw = loadJsonObject(FILTERS_STORAGE_KEY)
  if (!raw) return { filterStatuses: DEFAULT_STATUSES, timeScope: 'all', filterBranch: DEFAULT_BRANCH_FILTER }
  const filterStatuses = Array.isArray(raw.filterStatuses)
    ? raw.filterStatuses.filter(s => VALID_STATUSES.has(s))
    : DEFAULT_STATUSES
  const timeScope = VALID_TIME_SCOPES.has(raw.timeScope) ? raw.timeScope : 'all'
  const filterBranch = Array.isArray(raw.filterBranch)
    ? raw.filterBranch.filter(b => VALID_BRANCH_FILTERS.has(b))
    : DEFAULT_BRANCH_FILTER
  return {
    filterStatuses: filterStatuses.length > 0 ? filterStatuses : DEFAULT_STATUSES,
    timeScope,
    filterBranch: filterBranch.length > 0 ? filterBranch : DEFAULT_BRANCH_FILTER,
  }
}

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

export default function GraphView({ tasks, projects, onSelectTask, githubLinks }) {
  // --- Local filter state -------------------------------------------------
  // Initial values come from localStorage (sanitized in loadInitialFilters).
  // Default for first-time users: every status except `done`, all-time scope.
  const [filterStatuses, setFilterStatuses] = useState(() => loadInitialFilters().filterStatuses)
  const [timeScope, setTimeScope] = useState(() => loadInitialFilters().timeScope)
  const [filterBranch, setFilterBranch] = useState(() => loadInitialFilters().filterBranch)

  // Persist filters whenever they change. Cheap debounceless write — toggling
  // a chip just writes a small JSON blob; no perf concern at this size.
  useEffect(() => {
    saveJson(FILTERS_STORAGE_KEY, { filterStatuses, timeScope, filterBranch })
  }, [filterStatuses, timeScope, filterBranch])
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

  // --- Saved node positions (persistence) --------------------------------
  // Stored as { taskId | hubId: {x, y} }. Lazy-loaded once via useState's
  // initializer so we don't re-read localStorage on every render. The ref
  // points to the same mutable object, which is what dragEnd updates.
  const [initialPositions] = useState(loadPositions)
  const positionsRef = useRef(initialPositions)
  // Bumping this triggers a network rebuild without changing any other
  // dependency — used by the "Reset positions" button.
  const [resetVersion, setResetVersion] = useState(0)

  // --- Filter pipeline ----------------------------------------------------
  const visibleTasks = useMemo(() => {
    const scope = TIME_SCOPES.find(s => s.value === timeScope)
    const cutoff = scope && scope.days != null ? nowMs() - scope.days * 86400000 : null
    const statusSet = new Set(filterStatuses)
    const branchSet = new Set(filterBranch)
    // Only enforce the branch axis when the user has narrowed it — both
    // chips selected ('has' + 'none') is the no-op default.
    const branchFiltered = branchSet.size > 0 && branchSet.size < 2

    return tasks.filter(t => {
      if (statusSet.size > 0 && !statusSet.has(t.status)) return false
      if (cutoff !== null) {
        if (lastActivityTimestamp(t) < cutoff) return false
      }
      if (branchFiltered) {
        const link = githubLinks && githubLinks[t.id]
        const hasBranch = !!(link && (link.branch || link.pr_url))
        const key = hasBranch ? 'has' : 'none'
        if (!branchSet.has(key)) return false
      }
      return true
    })
  }, [tasks, filterStatuses, timeScope, filterBranch, githubLinks])

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
    // With one project visible (active-project filter or filters happen to
    // leave a single project's tasks), drop the ring radius to 0 so the lone
    // hub sits dead center. With multiple projects, fall back to the spread
    // ring so clusters don't collide.
    const ringR = N <= 1 ? 0 : Math.max(600, N * 90)
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
    // positionsRef is only mutated by the dragEnd handler and the reset
    // callback (both event-driven), never during render — so this read is
    // stable. resetVersion in the deps below ensures we re-run after a reset.
    const savedPositions = positionsRef.current || {}
    const taskNodes = visibleTasks.map(t => {
      const proj = projectByName.get(t.project || 'Root')
      const off = seededOffset(t.id || '')
      const offR = off.radius
      const offA = off.angle
      const fill = colorForTask(t.id, categoryHex)
      const border = STATUS_BORDER_COLOR[t.status] || '#3a4150'
      const size = t.priority === 'high' ? 14 : t.priority === 'medium' ? 10 : 7
      const saved = savedPositions[t.id]
      const seedX = proj ? proj.hubX + Math.cos(offA) * offR : 0
      const seedY = proj ? proj.hubY + Math.sin(offA) * offR : 0
      // Saved position is the *starting* coordinate, not a pin — physics is
      // always on, so the spring + Brownian forces continue acting. The rAF
      // loop saves positions periodically so what's restored on the next
      // mount is the latest physics-driven position, not a stale snapshot.
      return {
        id: t.id,
        label: t.id || '',
        size,
        shape: 'dot',
        x: saved ? saved.x : seedX,
        y: saved ? saved.y : seedY,
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
    const hubNodes = projList.map(proj => {
      const hubId = `__hub:${proj.name}`
      const saved = savedPositions[hubId]
      return {
      id: hubId,
      label: showHubs ? `${proj.displayName} · ${proj.taskCount}` : '',
      shape: 'hexagon',
      size: showHubs ? 22 : 1,
      x: saved ? saved.x : proj.hubX,
      y: saved ? saved.y : proj.hubY,
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
      }
    })

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
    // resetVersion is in deps so "Reset positions" forces this useMemo to
    // re-run with the now-empty positionsRef → nodes get seeded coords again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTasks, projects, showHubs, resetVersion])

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
    net.on('dragEnd', p => {
      const ids = p.nodes || []
      let touched = false
      for (const id of ids) {
        draggedRef.current.delete(id)
        const n = net.body.nodes[id]
        if (n && typeof n.x === 'number' && typeof n.y === 'number') {
          positionsRef.current[id] = { x: n.x, y: n.y }
          touched = true
        }
      }
      // Immediate save on release so a hard reload right after a drag
      // doesn't lose the user's intent. The rAF tick keeps positions
      // fresh during continuous physics motion.
      if (touched) persistPositions(positionsRef.current)
    })

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
      // Snapshot final positions before tearing down — covers the gap
      // between the last rAF save and the unmount (e.g. user drags then
      // immediately switches views).
      const finalNet = networkRef.current
      const finalDs = datasetRef.current
      if (finalNet && finalDs && finalDs.nodes && finalNet.body && finalNet.body.nodes) {
        finalDs.nodes.forEach(node => {
          const bn = finalNet.body.nodes[node.id]
          if (bn && typeof bn.x === 'number' && typeof bn.y === 'number') {
            positionsRef.current[node.id] = { x: bn.x, y: bn.y }
          }
        })
        persistPositions(positionsRef.current)
      }
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
    // How often to snapshot positions to localStorage. Physics is always
    // on, so without periodic saves a view switch would lose all the drift
    // that happened since the user's last drag.
    const POSITION_SAVE_INTERVAL_MS = 2000
    let lastSaveTime = performance.now()

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

        // Periodic position snapshot. Physics is always running, so we
        // capture the current state every ~2s. On view-switch / reload,
        // the next mount loads the most recent snapshot and the layout
        // resumes near where the user left it.
        const now = performance.now()
        if (now - lastSaveTime > POSITION_SAVE_INTERVAL_MS) {
          lastSaveTime = now
          const ds = datasetRef.current
          if (ds && ds.nodes) {
            ds.nodes.forEach(node => {
              const bn = bodyNodes[node.id]
              if (bn && typeof bn.x === 'number' && typeof bn.y === 'number') {
                positionsRef.current[node.id] = { x: bn.x, y: bn.y }
              }
            })
            persistPositions(positionsRef.current)
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
  const toggleBranch = useCallback((kind) => {
    setFilterBranch(prev =>
      prev.includes(kind) ? prev.filter(k => k !== kind) : [...prev, kind]
    )
  }, [])
  const resetFilters = useCallback(() => {
    // Reset state — the persistence effect re-saves the defaults so storage
    // matches what the user sees. No need to delete the storage key.
    setFilterStatuses(DEFAULT_STATUSES)
    setTimeScope('all')
    setFilterBranch(DEFAULT_BRANCH_FILTER)
  }, [])
  const resetPositions = useCallback(() => {
    // Wipe stored positions in memory + on disk, drop hub-physics velocities
    // so the layout starts from rest, then bump resetVersion to force the
    // graphData useMemo + build effect to re-run with seeded coordinates.
    positionsRef.current = {}
    hubVelocitiesRef.current = {}
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem(POSITIONS_STORAGE_KEY) } catch { /* ignore */ }
    }
    setResetVersion(v => v + 1)
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
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: CATEGORY_COLOR_VAR[cat] }} />
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

        {/* Branch */}
        <FilterSection icon={GitBranch} title="Branch">
          <div className="flex flex-wrap" style={{ gap: 'var(--space-1)' }}>
            {[
              { key: 'has', label: 'has branch' },
              { key: 'none', label: 'no branch' },
            ].map(({ key, label }) => {
              const active = filterBranch.includes(key)
              return (
                <button
                  key={key}
                  onClick={() => toggleBranch(key)}
                  className="apple-press"
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${active ? 'var(--accent-app)' : 'var(--separator)'}`,
                    background: active ? 'color-mix(in srgb, var(--accent-app) 18%, transparent)' : 'transparent',
                    color: active ? 'var(--text-app)' : 'var(--text-muted)',
                    fontSize: 'var(--text-caption2)',
                    fontWeight: 'var(--font-medium)',
                    cursor: 'pointer',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </FilterSection>

        {/* Reset */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-2)' }}>
          <button
            onClick={resetFilters}
            className="apple-press"
            style={{
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
          <button
            onClick={resetPositions}
            className="apple-press"
            title="Clear saved node positions and rebuild the layout from defaults."
            style={{
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
            <X className="w-3 h-3" /> Reset positions
          </button>
        </div>

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
