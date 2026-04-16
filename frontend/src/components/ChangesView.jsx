import { memo, useState, useEffect, useMemo, useCallback } from 'react'
import { Circle, Loader2, Eye, CheckCircle2, GitBranch, GitPullRequest, ExternalLink, RefreshCw, X } from 'lucide-react'
import { API_BASE, apiFetch } from '../config'
import { STATUS_COLOR } from '../constants'

const STATUS_ICON = {
  todo: Circle,
  in_progress: Loader2,
  review: Eye,
  done: CheckCircle2,
  waiting_input: Circle,
  draft: Circle,
}

const LANE_PALETTE = [
  'var(--apple-purple)',
  'var(--apple-teal)',
  'var(--apple-orange)',
  'var(--apple-green)',
  'var(--apple-blue)',
  'var(--apple-pink)',
  'var(--apple-yellow)',
  'var(--apple-red)',
]

const LANE_WIDTH = 28
const LANE_PAD_LEFT = 14
const LANE_PAD_RIGHT = 18
const ROW_HEIGHT = 38
const ROW_GAP = 3
const ROW_STRIDE = ROW_HEIGHT + ROW_GAP
const LABEL_COL_WIDTH = 180
const UNCATEGORIZED_LANE = '__other__'

const CATEGORY_STYLE = {
  bug:    { color: 'var(--apple-red)',    label: 'bug'    },
  feat:   { color: 'var(--apple-blue)',   label: 'feat'   },
  ui:     { color: 'var(--apple-teal)',   label: 'ui'     },
  opt:    { color: 'var(--apple-orange)', label: 'opt'    },
  devops: { color: 'var(--apple-purple)', label: 'devops' },
  comp:   { color: 'var(--gray-1)',       label: 'comp'   },
  mobile: { color: 'var(--apple-pink)',   label: 'mobile' },
}

function categoryOf(taskId) {
  if (!taskId) return null
  const prefix = taskId.split('-')[0]?.toLowerCase()
  return CATEGORY_STYLE[prefix] ? prefix : null
}

const PR_STATE_STYLE = {
  OPEN:   { color: 'var(--apple-green)',  label: 'open'   },
  MERGED: { color: 'var(--apple-purple)', label: 'merged' },
  CLOSED: { color: 'var(--apple-red)',    label: 'closed' },
}

const FOCUS_STORAGE_KEY = 'taskBoardChangesFocus'

function ChangesView({ tasks, projects, activeProject, onSelectTask, recentlyUpdatedIds = [] }) {
  const [linksData, setLinksData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [focusedCategory, setFocusedCategory] = useState(() => {
    try { return localStorage.getItem(FOCUS_STORAGE_KEY) } catch { return null }
  })

  const setFocus = useCallback((key) => {
    setFocusedCategory(key)
    try {
      if (key) localStorage.setItem(FOCUS_STORAGE_KEY, key)
      else localStorage.removeItem(FOCUS_STORAGE_KEY)
    } catch { /* ignore storage errors */ }
  }, [])

  const projectInfo = useMemo(() => {
    if (!activeProject || activeProject === 'All') return null
    return projects.find(p => (p.folder || p) === activeProject) || null
  }, [projects, activeProject])

  const fetchLinks = useCallback(async (refresh = false) => {
    if (!projectInfo?.id || projectInfo.id === 'root') {
      setLinksData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const url = `${API_BASE}/api/github/links?project=${encodeURIComponent(projectInfo.id)}${refresh ? '&refresh=1' : ''}`
      const res = await apiFetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLinksData(await res.json())
    } catch (e) {
      setError(e.message)
      setLinksData({ by_task_id: {}, detached: [], repo: null })
    } finally {
      setLoading(false)
    }
  }, [projectInfo])

  useEffect(() => { fetchLinks(false) }, [fetchLinks])

  const { lanes, rows, firstRowByLaneKey, allCategoryKeys } = useMemo(() => {
    const links = linksData?.by_task_id || {}

    // Each task becomes a row — drafts are excluded since they aren't committed work yet
    const baseEnriched = tasks
      .filter(t => t.status !== 'draft')
      .map(t => {
        const link = links[t.id] || null
        const ts = link?.branch_date || t.updated_at || t.created_at || 0
        return { task: t, link, ts: new Date(ts).getTime() || 0 }
      })

    // Capture all categories present BEFORE focus filtering, for the self-heal check
    const allCategoryKeys = new Set(
      baseEnriched.map(r => categoryOf(r.task.id) || UNCATEGORIZED_LANE)
    )

    // Apply focus filter on top of the draft filter
    const enriched = focusedCategory
      ? baseEnriched.filter(r => (categoryOf(r.task.id) || UNCATEGORIZED_LANE) === focusedCategory)
      : baseEnriched

    // Newest first
    enriched.sort((a, b) => b.ts - a.ts)

    // Lane = task category (bug / feat / ui / opt / devops / comp / mobile).
    // Order lanes by most-recent activity in that category.
    const lastTsByCat = new Map()
    for (const r of enriched) {
      const key = categoryOf(r.task.id) || UNCATEGORIZED_LANE
      if (!lastTsByCat.has(key)) lastTsByCat.set(key, r.ts)
    }
    const laneList = Array.from(lastTsByCat.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => {
        const color = key === UNCATEGORIZED_LANE
          ? 'var(--gray-1)'
          : CATEGORY_STYLE[key]?.color || 'var(--gray-1)'
        const label = key === UNCATEGORIZED_LANE ? 'other' : CATEGORY_STYLE[key]?.label || key
        return { key, color, label }
      })

    const laneByKey = new Map(laneList.map((l, i) => [l.key, { ...l, index: i }]))

    const builtRows = enriched.map(r => {
      const key = categoryOf(r.task.id) || UNCATEGORIZED_LANE
      const lane = laneByKey.get(key)
      return { ...r, lane }
    })

    // Compute each lane's first-appearance row index so we know where to draw the label pill
    const firstRowByLaneKey = new Map()
    builtRows.forEach((r, i) => {
      if (r.lane && !firstRowByLaneKey.has(r.lane.key)) firstRowByLaneKey.set(r.lane.key, i)
    })

    return {
      lanes: laneList.map((l, i) => ({ ...l, index: i })),
      rows: builtRows,
      firstRowByLaneKey,
      allCategoryKeys,
    }
  }, [tasks, linksData, focusedCategory])

  // Self-heal: if the persisted focus is for a category no task currently has, exit focus mode
  useEffect(() => {
    if (focusedCategory && allCategoryKeys && !allCategoryKeys.has(focusedCategory)) {
      setFocus(null)
    }
  }, [focusedCategory, allCategoryKeys, setFocus])

  const graphWidth = LANE_PAD_LEFT + lanes.length * LANE_WIDTH + LANE_PAD_RIGHT
  const totalHeight = rows.length * ROW_STRIDE

  const showRepoBanner = linksData && !linksData.repo && !error
  const repoUrl = linksData?.repo_url
  const focusStyle = focusedCategory && focusedCategory !== UNCATEGORIZED_LANE
    ? CATEGORY_STYLE[focusedCategory]
    : null

  return (
    <div className="w-full">
      {/* Top toolbar */}
      <div className="flex items-center justify-between mb-3" style={{ paddingLeft: '4px' }}>
        <div className="flex items-center gap-2">
          {repoUrl && (
            <a
              href={repoUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 apple-press"
              style={{
                padding: '4px 10px', borderRadius: 'var(--radius-md)',
                background: 'var(--fill-secondary)', border: '1px solid var(--separator)',
                fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              }}
              title="Open repo on GitHub"
            >
              <GitBranch className="w-3 h-3" />
              {linksData.repo.owner}/{linksData.repo.repo}
              <ExternalLink className="w-2.5 h-2.5 opacity-60" />
            </a>
          )}
          {showRepoBanner && (
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>
              No GitHub repo linked for this project — showing tasks only
            </span>
          )}
          {error && (
            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-red)' }}>
              GitHub fetch failed: {error}
            </span>
          )}
          {focusedCategory && (
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="apple-press flex items-center gap-1"
              style={{
                padding: '4px 8px 4px 10px',
                borderRadius: 'var(--radius-md)',
                background: focusStyle
                  ? `color-mix(in srgb, ${focusStyle.color} 18%, transparent)`
                  : 'var(--fill-secondary)',
                border: focusStyle
                  ? `1px solid color-mix(in srgb, ${focusStyle.color} 45%, transparent)`
                  : '1px solid var(--separator)',
                color: focusStyle ? focusStyle.color : 'var(--text-tertiary)',
                fontSize: 'var(--text-caption2)',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
              title="Show all categories"
            >
              {focusStyle?.label || 'other'}
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <button
          onClick={() => fetchLinks(true)} disabled={loading}
          className="apple-press flex items-center gap-1.5"
          style={{
            padding: '5px 10px', borderRadius: 'var(--radius-md)',
            background: 'var(--fill-secondary)', border: '1px solid var(--separator)',
            fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)',
            opacity: loading ? 0.6 : 1,
          }}
          title="Refresh from GitHub"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)' }}>
        <div className="relative" style={{ minHeight: rows.length ? totalHeight : 120 }}>
          {/* SVG graph overlay — sits between the label column and the message column, doesn't capture clicks */}
          <svg
            width={graphWidth} height={totalHeight}
            className="absolute top-0"
            style={{ left: `${LABEL_COL_WIDTH}px`, pointerEvents: 'none' }}
          >
            {/* Lane lines — kept as muted vertical columns behind the trail so each category
                still has a visible home. Drawn first so the trail overlays them. */}
            {lanes.map((lane) => {
              const x = LANE_PAD_LEFT + lane.index * LANE_WIDTH + LANE_WIDTH / 2
              const rowsOnLane = rows
                .map((r, i) => ({ r, i }))
                .filter(({ r }) => r.lane?.key === lane.key)
              if (rowsOnLane.length < 2) return null
              const first = rowsOnLane[0]
              const last = rowsOnLane[rowsOnLane.length - 1]
              const y1 = first.i * ROW_STRIDE + ROW_HEIGHT / 2
              const y2 = last.i * ROW_STRIDE + ROW_HEIGHT / 2
              return (
                <line
                  key={`${lane.key}-line`}
                  x1={x} x2={x} y1={y1} y2={y2}
                  stroke={lane.color}
                  strokeWidth="1.5"
                  strokeOpacity="0.28"
                />
              )
            })}
            {/* Progression trail — one connected path from newest (top) to oldest (bottom)
                visiting every node. Each segment takes the arriving row's category color.
                Cross-lane hops draw an L-shape: straight down from the top node, a single
                rounded corner near the target row, then horizontal into the target node. */}
            {rows.slice(1).map((curr, idx) => {
              const prev = rows[idx]
              if (!prev.lane || !curr.lane) return null
              const prevX = LANE_PAD_LEFT + prev.lane.index * LANE_WIDTH + LANE_WIDTH / 2
              const prevY = idx * ROW_STRIDE + ROW_HEIGHT / 2
              const currX = LANE_PAD_LEFT + curr.lane.index * LANE_WIDTH + LANE_WIDTH / 2
              const currY = (idx + 1) * ROW_STRIDE + ROW_HEIGHT / 2
              const color = curr.lane.color
              const sameLane = prevX === currX
              let d
              if (sameLane) {
                d = `M ${prevX} ${prevY} L ${currX} ${currY}`
              } else {
                const dir = currX > prevX ? 1 : -1
                const midY = (prevY + currY) / 2
                // Symmetric S: short vertical leg out of each node, matching quarter-circle
                // corners at the midline, and a horizontal bridge between them. Clamp radius
                // so both corners fit the row height and the inter-lane distance.
                const r = Math.min(10, (currY - prevY) / 4, Math.abs(currX - prevX) / 2)
                d = [
                  `M ${prevX} ${prevY}`,
                  `L ${prevX} ${midY - r}`,
                  `Q ${prevX} ${midY}, ${prevX + dir * r} ${midY}`,
                  `L ${currX - dir * r} ${midY}`,
                  `Q ${currX} ${midY}, ${currX} ${midY + r}`,
                  `L ${currX} ${currY}`,
                ].join(' ')
              }
              return (
                <path
                  key={`trail-${curr.task.id}`}
                  d={d}
                  stroke={color}
                  strokeWidth="2.5"
                  strokeOpacity="0.95"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              )
            })}
            {/* Node circles — one per task, on its category lane, drawn on top of line endpoints */}
            {rows.map((r, i) => {
              if (!r.lane) return null
              const x = LANE_PAD_LEFT + r.lane.index * LANE_WIDTH + LANE_WIDTH / 2
              const y = i * ROW_STRIDE + ROW_HEIGHT / 2
              return (
                <circle
                  key={r.task.id}
                  cx={x} cy={y} r="5.5"
                  fill="var(--bg-card)"
                  stroke={r.lane.color} strokeWidth="2.25"
                />
              )
            })}
          </svg>

          {/* Rows — each row is a single horizontal band tinted by its lane color */}
          {rows.map((r, i) => {
            const StatusIcon = STATUS_ICON[r.task.status] || Circle
            const justUpdated = recentlyUpdatedIds.includes(r.task.id)
            const prStyle = r.link?.pr_state ? PR_STATE_STYLE[r.link.pr_state] : null
            const catKey = categoryOf(r.task.id)
            const catStyle = catKey ? CATEGORY_STYLE[catKey] : null
            const showLabel = r.lane && firstRowByLaneKey?.get(r.lane.key) === i
            const laneTint = r.lane
              ? `color-mix(in srgb, ${r.lane.color} ${justUpdated ? 22 : 10}%, transparent)`
              : (justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent')
            return (
              <div
                key={r.task.id}
                onClick={() => onSelectTask(r.task)}
                className="flex items-stretch cursor-pointer relative"
                style={{
                  height: `${ROW_HEIGHT}px`,
                  marginBottom: i === rows.length - 1 ? 0 : `${ROW_GAP}px`,
                  borderRadius: '3px',
                  background: laneTint,
                  transition: 'background var(--duration-fast) var(--ease-default)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = r.lane
                    ? `color-mix(in srgb, ${r.lane.color} 20%, transparent)`
                    : 'var(--fill-secondary)'
                }}
                onMouseLeave={(e) => { e.currentTarget.style.background = laneTint }}
              >
                {/* Label column — category name shown only on the first (topmost) row of each lane */}
                <div
                  className="shrink-0 flex items-center justify-end"
                  style={{ width: `${LABEL_COL_WIDTH}px`, padding: '0 10px 0 12px' }}
                >
                  {showLabel && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFocus(focusedCategory === r.lane.key ? null : r.lane.key)
                      }}
                      className="apple-press flex items-center gap-1.5 whitespace-nowrap"
                      style={{
                        padding: '3px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: r.lane.key === UNCATEGORIZED_LANE
                          ? 'var(--fill-secondary)'
                          : `color-mix(in srgb, ${r.lane.color} ${focusedCategory === r.lane.key ? 42 : 26}%, transparent)`,
                        color: r.lane.key === UNCATEGORIZED_LANE ? 'var(--text-tertiary)' : r.lane.color,
                        fontSize: '11px',
                        fontWeight: 600,
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                        letterSpacing: '0.02em',
                        textTransform: 'uppercase',
                        border: focusedCategory === r.lane.key
                          ? `1px solid color-mix(in srgb, ${r.lane.color} 60%, transparent)`
                          : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                      title={focusedCategory === r.lane.key
                        ? `Showing only ${r.lane.label} — click to show all`
                        : `Focus on ${r.lane.label} only`}
                    >
                      {r.lane.label}
                    </button>
                  )}
                </div>

                {/* Graph column spacer (SVG overlays this region) */}
                <div className="shrink-0" style={{ width: `${graphWidth}px` }} />

                {/* Message column */}
                <div
                  className="flex-1 flex items-center gap-2.5 min-w-0"
                  style={{ padding: '0 12px' }}
                >
                  <StatusIcon
                    className={`w-3.5 h-3.5 shrink-0 ${r.task.status === 'in_progress' ? 'animate-spin' : ''}`}
                    style={{ color: STATUS_COLOR[r.task.status] || 'var(--gray-1)' }}
                  />
                  <span
                    className="truncate"
                    style={{
                      fontSize: 'var(--text-subhead)',
                      color: r.task.status === 'done' ? 'var(--text-muted)' : 'var(--text-app)',
                      flex: '1 1 auto',
                      minWidth: 0,
                      textDecoration: r.task.status === 'done' ? 'line-through' : 'none',
                    }}
                    title={r.task.title}
                  >
                    {r.task.title}
                  </span>
                  <span
                    className="shrink-0"
                    style={{
                      padding: catStyle ? '2px 6px' : 0,
                      borderRadius: '4px',
                      background: catStyle ? `color-mix(in srgb, ${catStyle.color} 14%, transparent)` : 'transparent',
                      border: catStyle ? `1px solid color-mix(in srgb, ${catStyle.color} 35%, transparent)` : 'none',
                      color: catStyle ? catStyle.color : 'var(--text-muted)',
                      fontSize: '10px',
                      fontWeight: catStyle ? 600 : 400,
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    }}
                    title={catStyle ? `Category: ${catStyle.label}` : undefined}
                  >
                    {r.task.id}
                  </span>
                  {r.link?.branch && (
                    <a
                      href={r.link.branch_url || '#'}
                      target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 flex items-center gap-1"
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'var(--fill-secondary)',
                        color: 'var(--text-tertiary)',
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                        maxWidth: '180px',
                      }}
                      title={`Branch: ${r.link.branch}`}
                    >
                      <GitBranch className="w-2.5 h-2.5 shrink-0" />
                      <span className="truncate">{r.link.branch}</span>
                    </a>
                  )}
                  {r.link?.pr_number && prStyle && (
                    <a
                      href={r.link.pr_url}
                      target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 flex items-center gap-1"
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: `color-mix(in srgb, ${prStyle.color} 14%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${prStyle.color} 35%, transparent)`,
                        color: prStyle.color,
                        fontSize: '10px',
                        fontWeight: 600,
                      }}
                      title={`PR #${r.link.pr_number}: ${r.link.pr_title} (${prStyle.label})`}
                    >
                      <GitPullRequest className="w-2.5 h-2.5" />
                      #{r.link.pr_number}
                    </a>
                  )}
                </div>
              </div>
            )
          })}
          {rows.length === 0 && (
            <div className="text-center py-12" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-subhead)' }}>
              No tasks to display
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(ChangesView)
