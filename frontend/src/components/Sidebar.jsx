import { useState, useMemo, useCallback, memo } from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Folder, Plus, Trash2, UserCircle2, Clock, SlidersHorizontal, X, BarChart3, Activity, Play, Square, Settings as SettingsIcon, MessageCircle, Eye, LogOut, PanelLeftClose, PanelLeftOpen, AlertCircle, Palette, MoreHorizontal, Archive, HelpCircle } from 'lucide-react'
import { API_BASE, apiFetch } from '../config'

const FILTER_TYPES = ['all', 'frontend', 'backend', 'fullstack', 'devops']
const PRIORITY_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]

function SidebarSection({ title, collapsed: sectionCollapsed, onToggle, badge, children }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-2 apple-press" style={{ padding: '8px 14px', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', letterSpacing: 'var(--tracking-wide)' }}>
        {sectionCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span className="flex-1 text-left uppercase" style={{ fontSize: 'var(--text-caption2)' }}>{title}</span>
        {badge > 0 && (
          <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'white', background: 'var(--accent-app)', borderRadius: 'var(--radius-full)', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{badge}</span>
        )}
      </button>
      {!sectionCollapsed && <div style={{ padding: '0 8px 8px' }}>{children}</div>}
    </div>
  )
}

function Sidebar({
  // Sidebar state
  collapsed, onToggleCollapse, mobile,
  // Projects
  projects, tasks, activeProject, onSetActiveProject, onCreateProject, onDeleteProject,
  archivedProjects = [], onArchiveProject, onOpenArchivedModal,
  // Filters
  filterType, setFilterType, filterPriority, setFilterPriority,
  filterAssignee, setFilterAssignee, filterToday, setFilterToday,
  filterStale, setFilterStale,
  uniqueAssignees, activeFilterCount, resetAllFilters, filteredTasks,
  // Dashboard
  services, onServiceAction,
  // User & actions
  user, onLogout, onOpenSettings, onOpenChat, onOpenPreview, onOpenDesignStudio, onOpenHelp,
  chatUnread, showPreview,
}) {
  const [sectionsCollapsed, setSectionsCollapsed] = useState(() => mobile ? { filters: true, dashboard: true } : {})
  const toggleSection = (key) => setSectionsCollapsed(prev => ({ ...prev, [key]: !prev[key] }))
  const [projectMenuOpenId, setProjectMenuOpenId] = useState(null)

  // Progress data
  const counts = useMemo(() => {
    const map = { todo: 0, in_progress: 0, review: 0, done: 0 }
    filteredTasks.forEach(t => { if (map[t.status] !== undefined) map[t.status]++; else map.todo++ })
    return map
  }, [filteredTasks])

  const total = filteredTasks.length
  const donePercent = total > 0 ? Math.round((counts.done / total) * 100) : 0

  // Activity
  const activity = useMemo(() => {
    const now = Date.now()
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    let lastTs = 0, todayCount = 0
    filteredTasks.forEach(t => {
      if (!t.activity_log?.length) return
      const ts = new Date(t.activity_log[t.activity_log.length - 1].timestamp).getTime()
      if (ts > lastTs) lastTs = ts
      if (ts >= todayStart.getTime()) todayCount++
    })
    if (!lastTs) return null
    const diff = now - lastTs
    const mins = Math.floor(diff / 60000)
    const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m` : Math.floor(diff / 3600000) < 24 ? `${Math.floor(diff / 3600000)}h` : `${Math.floor(diff / 86400000)}d`
    return { todayCount, ago, recent: diff < 3600000 }
  }, [filteredTasks])

  // Project services
  const normalizeForMatch = (str) => (str || '').toLowerCase().replace(/[\s_-]+/g, '')
  const projectServices = useMemo(() => {
    if (!activeProject || activeProject === 'All') return []
    return services.filter(s => normalizeForMatch(s.group) === normalizeForMatch(activeProject))
  }, [services, activeProject])

  const handleToggleService = useCallback(async (svc) => {
    const action = svc.status === 'running' ? 'stop' : 'start'
    try { await apiFetch(`${API_BASE}/api/services/${svc.id}/${action}`, { method: 'POST' }); setTimeout(() => onServiceAction?.(), 1000) } catch (e) {}
  }, [onServiceAction])

  // Collapsed: icon-only sidebar
  if (collapsed) {
    return (
      <div className={`${mobile ? 'flex' : 'hidden sm:flex'} flex-col items-center shrink-0`} style={{ width: '60px', background: 'var(--bg-secondary)', borderRight: '0.5px solid var(--separator)', padding: '12px 0', transition: `width var(--duration-slow) var(--ease-default)` }}>
        <button onClick={onToggleCollapse} className="apple-press mb-4" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Expand sidebar">
          <PanelLeftOpen className="w-[18px] h-[18px]" />
        </button>
        <img src="/favicon.svg" alt="Logo" style={{ width: '28px', height: '28px', marginBottom: '12px', opacity: 0.7 }} />
        <div className="flex-1" />
        <div className="flex flex-col gap-1 items-center mt-auto">
          <button onClick={onOpenPreview} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: showPreview ? 'var(--accent-app)' : 'var(--text-muted)' }} title="Preview">
            <Eye className="w-[18px] h-[18px]" />
          </button>
          {onOpenDesignStudio && (
            <button onClick={onOpenDesignStudio} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Design Studio">
              <Palette className="w-[18px] h-[18px]" />
            </button>
          )}
          <button onClick={onOpenChat} className="apple-press relative" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Chat">
            <MessageCircle className="w-[18px] h-[18px]" />
            {chatUnread > 0 && <span style={{ position: 'absolute', top: '2px', right: '2px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--apple-red)' }} />}
          </button>
          <button onClick={onOpenSettings} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Settings">
            <SettingsIcon className="w-[18px] h-[18px]" />
          </button>
          {onOpenHelp && (
            <button onClick={onOpenHelp} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Help & Usage">
              <HelpCircle className="w-[18px] h-[18px]" />
            </button>
          )}
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white mt-1 cursor-pointer" style={{ fontSize: '11px', fontWeight: 'var(--font-bold)', background: 'var(--accent-app)' }} title={user?.username} onClick={onLogout}>
            {user?.username?.charAt(0).toUpperCase()}
          </div>
        </div>
      </div>
    )
  }

  // Expanded sidebar
  return (
    <div className={`${mobile ? 'flex' : 'hidden sm:flex'} flex-col shrink-0`} style={{ width: mobile ? '100%' : '260px', height: '100%', background: 'var(--bg-secondary)', borderRight: '0.5px solid var(--separator)', transition: `width var(--duration-slow) var(--ease-default)`, overflow: 'hidden' }}>
      {/* Header: logo + archive shortcut + collapse toggle */}
      <div className="flex items-center justify-between shrink-0" style={{ padding: '14px 14px 10px' }}>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="Logo" style={{ width: '26px', height: '26px' }} />
          <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', letterSpacing: 'var(--tracking-tight)' }}>Atrium</span>
        </div>
        <div className="flex items-center gap-1">
          {archivedProjects.length > 0 && (
            <button
              onClick={onOpenArchivedModal}
              className="apple-press"
              style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)' }}
              title={`Archived projects (${archivedProjects.length})`}
              aria-label={`Archived projects (${archivedProjects.length})`}
            >
              <Archive className="w-4 h-4" />
            </button>
          )}
          <button onClick={onToggleCollapse} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-tertiary)' }} title="Collapse sidebar">
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">

      {/* Projects */}
      <SidebarSection title="Projects" collapsed={sectionsCollapsed.projects} onToggle={() => toggleSection('projects')}>
        <div className="flex flex-col gap-0.5">
          {projects.map(proj => {
            const folder = proj.folder || proj
            const projName = proj.name || proj
            const isActive = activeProject === folder
            const count = tasks.filter(t => t.project === folder).length
            const menuOpen = projectMenuOpenId === folder
            return (
              <div key={folder} className="relative">
                <button
                  onClick={() => onSetActiveProject(folder)}
                  className="w-full flex items-center gap-2.5 text-left apple-press group"
                  style={{
                    padding: '7px 10px', borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)',
                    color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                    background: isActive ? 'var(--fill-secondary)' : 'transparent',
                  }}
                >
                  <Folder className="w-4 h-4 shrink-0" style={{ color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)' }} />
                  <span className="truncate">{folder === 'Root' ? 'Unassigned' : projName}</span>
                  <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)', background: isActive ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-full)', minWidth: '18px', textAlign: 'center', flexShrink: 0 }}>{count}</span>
                  <div className="flex-1" />
                  {folder !== 'Root' && isActive && (
                    <button onClick={(e) => { e.stopPropagation(); onDeleteProject() }} className="apple-press opacity-0 group-hover:opacity-100 shrink-0" style={{ padding: '2px', borderRadius: 'var(--radius-xs)', color: 'var(--apple-red)', transition: `opacity var(--duration-fast)` }} title="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                  {folder !== 'Root' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setProjectMenuOpenId(menuOpen ? null : folder) }}
                      className="apple-press opacity-0 group-hover:opacity-100 shrink-0"
                      style={{ padding: '2px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)', transition: `opacity var(--duration-fast)`, opacity: menuOpen ? 1 : undefined, minWidth: '20px', minHeight: '20px' }}
                      title="More"
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                    >
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </button>
                  )}
                </button>
                {menuOpen && folder !== 'Root' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpenId(null)} />
                    <div
                      role="menu"
                      className="absolute right-2 z-50 animate-fade-in"
                      style={{
                        top: 'calc(100% + 2px)',
                        minWidth: '160px',
                        padding: '4px',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--separator)',
                        boxShadow: 'var(--shadow-lg)',
                      }}
                    >
                      <button
                        role="menuitem"
                        onClick={() => {
                          setProjectMenuOpenId(null)
                          onArchiveProject?.(folder, projName)
                        }}
                        className="w-full flex items-center gap-2 apple-press text-left"
                        style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', color: 'var(--text-app)', minHeight: '32px' }}
                      >
                        <Archive className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                        <span>Archive</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <button onClick={onCreateProject} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)' }}>
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Project</span>
          </button>
        </div>
      </SidebarSection>

      <div style={{ height: '0.5px', background: 'var(--separator)', margin: '4px 14px' }} />

      {/* Filters */}
      <SidebarSection title="Filters" collapsed={sectionsCollapsed.filters} onToggle={() => toggleSection('filters')} badge={activeFilterCount}>
        <div className="flex flex-col gap-1">
          {/* Quick toggles */}
          <button onClick={() => setFilterAssignee(filterAssignee === 'mine' ? 'all' : 'mine')} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterAssignee === 'mine' ? 'var(--accent-app)' : 'var(--text-muted)', background: filterAssignee === 'mine' ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent' }}>
            <UserCircle2 className="w-4 h-4 shrink-0" />
            My Tasks
          </button>
          <button onClick={() => setFilterToday(prev => !prev)} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterToday ? 'var(--accent-app)' : 'var(--text-muted)', background: filterToday ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent' }}>
            <Clock className="w-4 h-4 shrink-0" />
            Updated Today
          </button>
          <button onClick={() => setFilterStale(prev => !prev)} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterStale ? 'var(--apple-orange)' : 'var(--text-muted)', background: filterStale ? 'color-mix(in srgb, var(--apple-orange) 10%, transparent)' : 'transparent' }}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            Stale Tasks
          </button>

          {/* Type */}
          <div style={{ padding: '4px 10px' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Type</span>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="w-full cursor-pointer focus:outline-none" style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterType !== 'all' ? 'var(--accent-app)' : 'var(--text-muted)', textTransform: 'capitalize' }}>
              {FILTER_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All' : t}</option>)}
            </select>
          </div>

          {/* Priority */}
          <div style={{ padding: '4px 10px' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Priority</span>
            <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="w-full cursor-pointer focus:outline-none" style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterPriority !== 'all' ? 'var(--accent-app)' : 'var(--text-muted)' }}>
              {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>

          {/* Assignee */}
          {filterAssignee !== 'mine' && (
            <div style={{ padding: '4px 10px' }}>
              <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Assignee</span>
              <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="w-full cursor-pointer focus:outline-none" style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 10px', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: filterAssignee !== 'all' ? 'var(--accent-app)' : 'var(--text-muted)' }}>
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {uniqueAssignees.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {activeFilterCount > 0 && (
            <button onClick={resetAllFilters} className="apple-press flex items-center gap-1.5" style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--apple-red)' }}>
              <X className="w-3.5 h-3.5" /> Reset filters
            </button>
          )}

          <div style={{ padding: '2px 10px', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
            {filteredTasks.length} of {tasks.length} tasks
          </div>
        </div>
      </SidebarSection>

      <div style={{ height: '0.5px', background: 'var(--separator)', margin: '4px 14px' }} />

      {/* Dashboard */}
      {total > 0 && (
        <SidebarSection title="Dashboard" collapsed={sectionsCollapsed.dashboard} onToggle={() => toggleSection('dashboard')}>
          <div style={{ padding: '4px 10px' }}>
            {/* Progress */}
            <div className="flex items-center justify-between" style={{ marginBottom: '6px' }}>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>Progress</span>
              <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-bold)', color: 'var(--text-app)' }}>{donePercent}%</span>
            </div>
            <div className="flex overflow-hidden" style={{ height: '4px', borderRadius: 'var(--radius-full)', background: 'var(--fill-primary)', marginBottom: '8px' }}>
              {counts.done > 0 && <div style={{ width: `${(counts.done / total) * 100}%`, background: 'var(--apple-green)', transition: `width var(--duration-slow) var(--ease-out)` }} />}
              {counts.review > 0 && <div style={{ width: `${(counts.review / total) * 100}%`, background: 'var(--apple-orange)' }} />}
              {counts.in_progress > 0 && <div style={{ width: `${(counts.in_progress / total) * 100}%`, background: 'var(--apple-blue)' }} />}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ marginBottom: '8px' }}>
              {[{ key: 'done', label: 'Done', color: 'var(--apple-green)' }, { key: 'review', label: 'Review', color: 'var(--apple-orange)' }, { key: 'in_progress', label: 'Active', color: 'var(--apple-blue)' }, { key: 'todo', label: 'To Do', color: 'var(--gray-3)' }].map(s => counts[s.key] > 0 && (
                <div key={s.key} className="flex items-center gap-1">
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.color }} />
                  <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>{counts[s.key]} {s.label}</span>
                </div>
              ))}
            </div>

            {/* Activity */}
            {activity && (
              <div className="flex items-center gap-2" style={{ fontSize: 'var(--text-caption2)', color: activity.recent ? 'var(--apple-green)' : 'var(--text-tertiary)' }}>
                <Activity className="w-3 h-3" />
                {activity.todayCount > 0 ? `${activity.todayCount} updated today` : 'No activity today'}
                <span className="ml-auto" style={{ color: 'var(--text-tertiary)' }}>{activity.ago}</span>
              </div>
            )}

            {/* Services */}
            {projectServices.length > 0 && (
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '0.5px solid var(--separator)' }}>
                {projectServices.map(svc => {
                  const running = svc.status === 'running'
                  return (
                    <div key={svc.id} className="flex items-center gap-2" style={{ padding: '4px 0' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: running ? 'var(--apple-green)' : 'var(--apple-red)', boxShadow: running ? '0 0 6px var(--apple-green)' : 'none', flexShrink: 0 }} />
                      <span className="truncate" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-app)' }}>{svc.name}</span>
                      <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '1px 6px', borderRadius: 'var(--radius-full)', flexShrink: 0 }}>:{svc.port}</span>
                      <div className="flex-1" />
                      <button onClick={(e) => { e.stopPropagation(); handleToggleService(svc) }} className="apple-press shrink-0" style={{ padding: '3px', borderRadius: 'var(--radius-xs)', color: running ? 'var(--apple-red)' : 'var(--apple-green)' }} title={running ? `Stop ${svc.name}` : `Start ${svc.name}`}>
                        {running ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3 h-3" fill="currentColor" />}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </SidebarSection>
      )}

      </div>{/* end scrollable middle */}

      {/* Bottom: actions + user — always visible */}
      <div className="shrink-0" style={{ padding: '8px', borderTop: '0.5px solid var(--separator)' }}>
        <div className="flex flex-col gap-0.5">
          <button onClick={onOpenPreview} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: showPreview ? 'var(--accent-app)' : 'var(--text-muted)' }}>
            <Eye className="w-4 h-4 shrink-0" /> Preview
          </button>
          {onOpenDesignStudio && (
            <button onClick={onOpenDesignStudio} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <Palette className="w-4 h-4 shrink-0" /> Design Studio
            </button>
          )}
          <button onClick={onOpenChat} className="w-full flex items-center gap-2.5 text-left apple-press relative" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
            <MessageCircle className="w-4 h-4 shrink-0" /> Chat
            {chatUnread > 0 && (
              <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'white', background: 'var(--apple-red)', borderRadius: 'var(--radius-full)', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', marginLeft: 'auto' }}>{chatUnread}</span>
            )}
          </button>
          <button onClick={onOpenSettings} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
            <SettingsIcon className="w-4 h-4 shrink-0" /> Settings
          </button>
          {onOpenHelp && (
            <button onClick={onOpenHelp} className="w-full flex items-center gap-2.5 text-left apple-press" style={{ padding: '7px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <HelpCircle className="w-4 h-4 shrink-0" /> Help &amp; Usage
            </button>
          )}
        </div>
        <div style={{ height: '0.5px', background: 'var(--separator)', margin: '8px 0' }} />
        <div className="flex items-center gap-2.5" style={{ padding: '6px 10px' }}>
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-white shrink-0" style={{ fontSize: '11px', fontWeight: 'var(--font-bold)', background: 'var(--accent-app)' }}>
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <span className="flex-1 truncate" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{user?.username}</span>
          <button onClick={onLogout} className="apple-press" style={{ padding: '4px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Logout">
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default memo(Sidebar)
