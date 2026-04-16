import { memo, useState, useEffect, useMemo, useCallback } from 'react'
import { Circle, Loader2, Eye, CheckCircle2, GitBranch, GitPullRequest, ExternalLink, RefreshCw } from 'lucide-react'
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

const LANE_WIDTH = 22
const LANE_PAD_LEFT = 14
const LANE_PAD_RIGHT = 14
const ROW_HEIGHT = 44
const HEADER_HEIGHT = 36
const NO_BRANCH_LANE = '__no_branch__'

const PR_STATE_STYLE = {
  OPEN:   { color: 'var(--apple-green)',  label: 'open'   },
  MERGED: { color: 'var(--apple-purple)', label: 'merged' },
  CLOSED: { color: 'var(--apple-red)',    label: 'closed' },
}

function ChangesView({ tasks, projects, activeProject, onSelectTask, recentlyUpdatedIds = [] }) {
  const [linksData, setLinksData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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

  const { lanes, rows } = useMemo(() => {
    const links = linksData?.by_task_id || {}

    // Each task becomes a row
    const enriched = tasks.map(t => {
      const link = links[t.id] || null
      const ts = link?.branch_date || t.updated_at || t.created_at || 0
      return { task: t, link, ts: new Date(ts).getTime() || 0 }
    })

    // Newest first
    enriched.sort((a, b) => b.ts - a.ts)

    // Lane order: most-recently-active branch first, then "no branch"
    const seen = new Map()
    for (const r of enriched) {
      const key = r.link?.branch || NO_BRANCH_LANE
      if (!seen.has(key)) seen.set(key, r.ts)
    }
    const laneList = Array.from(seen.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key], idx) => ({ key, color: LANE_PALETTE[idx % LANE_PALETTE.length] }))

    const laneByKey = new Map(laneList.map((l, i) => [l.key, { ...l, index: i }]))

    const builtRows = enriched.map(r => {
      const key = r.link?.branch || NO_BRANCH_LANE
      const lane = laneByKey.get(key)
      return { ...r, lane }
    })

    return { lanes: laneList.map((l, i) => ({ ...l, index: i })), rows: builtRows }
  }, [tasks, linksData])

  const graphWidth = LANE_PAD_LEFT + lanes.length * LANE_WIDTH + LANE_PAD_RIGHT
  const totalHeight = HEADER_HEIGHT + rows.length * ROW_HEIGHT

  const showRepoBanner = linksData && !linksData.repo && !error
  const repoUrl = linksData?.repo_url

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
        <div className="flex">
          {/* Graph column */}
          <div className="shrink-0 relative" style={{ width: `${graphWidth}px` }}>
            <svg
              width={graphWidth} height={totalHeight}
              style={{ display: 'block' }}
            >
              {/* Lane vertical lines */}
              {lanes.map((lane) => {
                const x = LANE_PAD_LEFT + lane.index * LANE_WIDTH + LANE_WIDTH / 2
                return (
                  <line
                    key={lane.key}
                    x1={x} x2={x}
                    y1={HEADER_HEIGHT - 4} y2={totalHeight}
                    stroke={lane.color}
                    strokeWidth="2"
                    strokeOpacity="0.45"
                  />
                )
              })}
              {/* Nodes */}
              {rows.map((r, i) => {
                if (!r.lane) return null
                const x = LANE_PAD_LEFT + r.lane.index * LANE_WIDTH + LANE_WIDTH / 2
                const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2
                return (
                  <g key={r.task.id}>
                    <circle cx={x} cy={y} r="5" fill="var(--bg-card)" stroke={r.lane.color} strokeWidth="2" />
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Right summary column */}
          <div className="flex-1 min-w-0">
            {/* Lane label header row */}
            <div
              className="flex items-center gap-1.5 overflow-x-auto"
              style={{
                height: `${HEADER_HEIGHT}px`,
                padding: '0 12px',
                borderBottom: '0.5px solid var(--separator)',
                background: 'var(--bg-secondary)',
              }}
            >
              {lanes.map(lane => (
                <span
                  key={lane.key}
                  className="flex items-center gap-1 whitespace-nowrap"
                  style={{
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: `color-mix(in srgb, ${lane.color} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${lane.color} 35%, transparent)`,
                    color: lane.color,
                    fontSize: '11px',
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                  }}
                >
                  {lane.key === NO_BRANCH_LANE ? (
                    <>no branch</>
                  ) : (
                    <><GitBranch className="w-2.5 h-2.5" /> {lane.key}</>
                  )}
                </span>
              ))}
            </div>
            {/* Rows */}
            {rows.map((r, i) => {
              const StatusIcon = STATUS_ICON[r.task.status] || Circle
              const justUpdated = recentlyUpdatedIds.includes(r.task.id)
              const prStyle = r.link?.pr_state ? PR_STATE_STYLE[r.link.pr_state] : null
              return (
                <div
                  key={r.task.id}
                  onClick={() => onSelectTask(r.task)}
                  className="flex items-center gap-2.5 cursor-pointer"
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    padding: '0 12px',
                    borderBottom: i === rows.length - 1 ? 'none' : '0.5px solid var(--separator)',
                    background: justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent',
                    transition: 'background var(--duration-fast) var(--ease-default)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--fill-secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = justUpdated ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent' }}
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
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                    }}
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
                        background: r.lane ? `color-mix(in srgb, ${r.lane.color} 12%, transparent)` : 'var(--fill-secondary)',
                        color: r.lane?.color || 'var(--text-tertiary)',
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
    </div>
  )
}

export default memo(ChangesView)
