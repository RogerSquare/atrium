import { useMemo, useCallback } from 'react'
import { BarChart3, Play, Square, Activity } from 'lucide-react'
import { API_BASE, apiFetch } from '../config'

const STATUS_CONFIG = [
  { id: 'done', label: 'Done', color: 'var(--apple-green)' },
  { id: 'review', label: 'Review', color: 'var(--apple-orange)' },
  { id: 'in_progress', label: 'Active', color: 'var(--apple-blue)' },
  { id: 'todo', label: 'To Do', color: 'var(--gray-3)' },
]

const normalizeForMatch = (str) => (str || '').toLowerCase().replace(/[\s_-]+/g, '')

export default function ProjectProgress({ tasks, services = [], activeProject, onServiceAction, filterToday, onToggleFilterToday }) {
  const counts = useMemo(() => {
    const map = { todo: 0, in_progress: 0, review: 0, done: 0 }
    tasks.forEach(t => { if (map[t.status] !== undefined) map[t.status]++; else map.todo++ })
    return map
  }, [tasks])

  const projectServices = useMemo(() => {
    if (!activeProject || activeProject === 'All') return []
    const normProject = normalizeForMatch(activeProject)
    return services.filter(s => normalizeForMatch(s.group) === normProject)
  }, [services, activeProject])

  const activity = useMemo(() => {
    const now = Date.now()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    let lastActivityTs = 0, updatedToday = 0
    tasks.forEach(t => {
      if (!t.activity_log || t.activity_log.length === 0) return
      const ts = new Date(t.activity_log[t.activity_log.length - 1].timestamp).getTime()
      if (ts > lastActivityTs) lastActivityTs = ts
      if (ts >= todayStart.getTime()) updatedToday++
    })
    if (lastActivityTs === 0) return { updatedToday: 0, lastAgo: null, isRecent: false }
    const diffMs = now - lastActivityTs
    const diffMin = Math.floor(diffMs / 60000)
    const lastAgo = diffMin < 1 ? 'just now' : diffMin < 60 ? `${diffMin}m ago` : Math.floor(diffMs / 3600000) < 24 ? `${Math.floor(diffMs / 3600000)}h ago` : `${Math.floor(diffMs / 86400000)}d ago`
    return { updatedToday, lastAgo, isRecent: diffMs < 3600000 }
  }, [tasks])

  const handleToggleService = useCallback(async (service) => {
    const action = service.status === 'running' ? 'stop' : 'start'
    try { await apiFetch(`${API_BASE}/api/services/${service.id}/${action}`, { method: 'POST' }); setTimeout(() => onServiceAction?.(), 1000) } catch (e) {}
  }, [onServiceAction])

  const total = tasks.length
  if (total === 0) return null
  const donePercent = Math.round((counts.done / total) * 100)

  return (
    <div className="h-full overflow-hidden" style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: 'var(--border-hairline)' }}>
      <header className="flex items-center gap-2" style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--separator)' }}>
        <div style={{ padding: '6px', borderRadius: 'var(--radius-sm)', background: 'color-mix(in srgb, var(--accent-app) 12%, transparent)' }}>
          <BarChart3 className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
        </div>
        <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Progress</span>
        <span className="ml-auto" style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{donePercent}%</span>
      </header>

      <div style={{ padding: '16px' }}>
        {/* Progress bar */}
        <div className="flex overflow-hidden" style={{ height: '6px', borderRadius: 'var(--radius-full)', background: 'var(--fill-primary)' }}>
          {STATUS_CONFIG.map(status => {
            const count = counts[status.id]
            if (count === 0) return null
            return (
              <div key={status.id} style={{ width: `${(count / total) * 100}%`, background: status.color, transition: `width var(--duration-slow) var(--ease-out)` }} title={`${status.label}: ${count}`} />
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: '10px' }}>
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{counts.done} of {total}</span>
          <div className="flex items-center gap-3 ml-auto">
            {STATUS_CONFIG.map(status => {
              if (counts[status.id] === 0) return null
              return (
                <div key={status.id} className="flex items-center gap-1.5">
                  <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: status.color }} />
                  <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>{counts[status.id]} {status.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Activity pulse */}
        {activity.lastAgo && (
          <div
            onClick={onToggleFilterToday}
            className="flex items-center gap-2 cursor-pointer apple-press"
            style={{
              marginTop: '12px', paddingTop: '12px', borderTop: '0.5px solid var(--separator)',
              padding: '10px 8px', marginLeft: '-4px', marginRight: '-4px', borderRadius: 'var(--radius-sm)',
              background: filterToday ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : 'transparent',
              transition: `background var(--duration-fast) var(--ease-default)`,
            }}
          >
            <Activity className="w-3.5 h-3.5 shrink-0" style={{ color: filterToday ? 'var(--accent-app)' : activity.isRecent ? 'var(--apple-green)' : 'var(--text-tertiary)' }} />
            <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterToday ? 'var(--accent-app)' : activity.isRecent ? 'var(--apple-green)' : 'var(--text-muted)' }}>
              {activity.updatedToday > 0 ? `${activity.updatedToday} task${activity.updatedToday === 1 ? '' : 's'} updated today` : 'No activity today'}
            </span>
            <span className="ml-auto shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{activity.lastAgo}</span>
            {activity.isRecent && !filterToday && <span className="animate-gentle-pulse shrink-0" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)' }} />}
          </div>
        )}

        {/* Services */}
        {projectServices.length > 0 && (
          <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '0.5px solid var(--separator)' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>Services</span>
            <div className="flex flex-col gap-1.5">
              {projectServices.map(service => {
                const isRunning = service.status === 'running'
                return (
                  <div key={service.id} className="flex items-center gap-2">
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: isRunning ? 'var(--apple-green)' : 'var(--apple-red)', boxShadow: isRunning ? '0 0 6px var(--apple-green)' : 'none', flexShrink: 0 }} />
                    <span className="truncate flex-1" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }} title={service.name}>{service.name}</span>
                    <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>:{service.port}</span>
                    <button onClick={() => handleToggleService(service)} className="apple-press shrink-0" style={{ padding: '4px', borderRadius: 'var(--radius-sm)', color: isRunning ? 'var(--apple-red)' : 'var(--apple-green)' }} title={isRunning ? 'Stop' : 'Start'}>
                      {isRunning ? <Square className="w-3.5 h-3.5" fill="currentColor" /> : <Play className="w-3.5 h-3.5" fill="currentColor" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
