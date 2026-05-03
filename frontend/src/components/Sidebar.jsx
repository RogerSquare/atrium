import { useState, useMemo, useCallback, memo } from 'react'
import { ChevronDown, ChevronRight, ChevronLeft, Folder, Plus, Trash2, UserCircle2, Clock, SlidersHorizontal, X, BarChart3, Activity, Play, Square, Settings as SettingsIcon, MessageCircle, Eye, LogOut, PanelLeftClose, PanelLeftOpen, AlertCircle, Palette, MoreHorizontal, Archive, HelpCircle } from 'lucide-react'
import { API_BASE, apiFetch } from '../config'
import { Button, IconButton, Select, Avatar } from './ui'

const FILTER_TYPES = ['all', 'frontend', 'backend', 'fullstack', 'devops']
const PRIORITY_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]

function SidebarSection({ title, collapsed: sectionCollapsed, onToggle, badge, children }) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 apple-press"
        style={{
          padding: 'var(--space-2) var(--space-3)',
          fontSize: 'var(--text-caption1)',
          fontWeight: 'var(--font-semibold)',
          color: 'var(--text-tertiary)',
          letterSpacing: 'var(--tracking-wide)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {sectionCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        <span className="flex-1 text-left uppercase" style={{ fontSize: 'var(--text-caption2)' }}>{title}</span>
        {badge > 0 && (
          <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'white', background: 'var(--accent-app)', borderRadius: 'var(--radius-full)', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 var(--space-1)' }}>{badge}</span>
        )}
      </button>
      {!sectionCollapsed && <div style={{ padding: `0 var(--space-2) var(--space-2)` }}>{children}</div>}
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
      <div
        className={`${mobile ? 'flex' : 'hidden sm:flex'} flex-col items-center shrink-0`}
        style={{
          width: '60px',
          background: 'var(--bg-secondary)',
          borderRight: '0.5px solid var(--separator)',
          padding: 'var(--space-3) 0',
          transition: `width var(--duration-slow) var(--ease-default)`,
        }}
      >
        <IconButton onClick={onToggleCollapse} className="mb-4" aria-label="Expand sidebar" title="Expand sidebar">
          <PanelLeftOpen className="w-[18px] h-[18px]" />
        </IconButton>
        <img src="/favicon.svg" alt="Logo" style={{ width: '28px', height: '28px', marginBottom: 'var(--space-3)', opacity: 0.7 }} />
        <div className="flex-1" />
        <div className="flex flex-col gap-1 items-center mt-auto">
          <IconButton onClick={onOpenPreview} aria-label="Preview" title="Preview" style={{ color: showPreview ? 'var(--accent-app)' : undefined }}>
            <Eye className="w-[18px] h-[18px]" />
          </IconButton>
          {onOpenDesignStudio && (
            <IconButton onClick={onOpenDesignStudio} aria-label="Design Studio" title="Design Studio">
              <Palette className="w-[18px] h-[18px]" />
            </IconButton>
          )}
          <IconButton onClick={onOpenChat} aria-label="Chat" title="Chat" className="relative">
            <MessageCircle className="w-[18px] h-[18px]" />
            {chatUnread > 0 && <span style={{ position: 'absolute', top: 'var(--space-0)', right: 'var(--space-0)', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--apple-red)' }} />}
          </IconButton>
          <IconButton onClick={onOpenSettings} aria-label="Settings" title="Settings">
            <SettingsIcon className="w-[18px] h-[18px]" />
          </IconButton>
          {onOpenHelp && (
            <IconButton onClick={onOpenHelp} aria-label="Help & Usage" title="Help & Usage">
              <HelpCircle className="w-[18px] h-[18px]" />
            </IconButton>
          )}
          <Avatar
            size="sm"
            alt={user?.username}
            color="white"
            background="var(--accent-app)"
            className="mt-1 cursor-pointer"
            title={user?.username}
            onClick={onLogout}
          />
        </div>
      </div>
    )
  }

  // Expanded sidebar
  return (
    <div className={`${mobile ? 'flex' : 'hidden sm:flex'} flex-col shrink-0`} style={{ width: mobile ? '100%' : '260px', height: '100%', background: 'var(--bg-secondary)', borderRight: '0.5px solid var(--separator)', transition: `width var(--duration-slow) var(--ease-default)`, overflow: 'hidden' }}>
      {/* Header: logo + archive shortcut + collapse toggle */}
      <div className="flex items-center justify-between shrink-0" style={{ padding: 'var(--space-3) var(--space-3) var(--space-2)' }}>
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="Logo" style={{ width: '26px', height: '26px' }} />
          <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', letterSpacing: 'var(--tracking-tight)' }}>Atrium</span>
          <span
            data-testid="sidebar-task-count"
            style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)' }}
          >
            {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {archivedProjects.length > 0 && (
            <IconButton
              size="sm"
              onClick={onOpenArchivedModal}
              title={`Archived projects (${archivedProjects.length})`}
              aria-label={`Archived projects (${archivedProjects.length})`}
              style={{ color: 'var(--text-tertiary)' }}
            >
              <Archive className="w-4 h-4" />
            </IconButton>
          )}
          <IconButton size="sm" onClick={onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar" style={{ color: 'var(--text-tertiary)' }}>
            <PanelLeftClose className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Scrollable middle section */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">

      {/* Projects */}
      <SidebarSection title="Projects" collapsed={sectionsCollapsed.projects} onToggle={() => toggleSection('projects')}>
        <div className="flex flex-col gap-1">
          {projects.map(proj => {
            const folder = proj.folder || proj
            const projName = proj.name || proj
            const isActive = activeProject === folder
            const count = tasks.filter(t => t.project === folder).length
            const menuOpen = projectMenuOpenId === folder
            return (
              <div key={folder} className="relative flex items-center group" style={{
                padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                background: isActive ? 'var(--fill-secondary)' : 'transparent',
                transition: `background var(--duration-fast) var(--ease-default)`,
              }}>
                <button
                  onClick={() => onSetActiveProject(folder)}
                  className="flex-1 flex items-center gap-2 text-left apple-press"
                  style={{
                    fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)',
                    color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                  }}
                >
                  <Folder className="w-4 h-4 shrink-0" style={{ color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)' }} />
                  <span className="truncate flex-1">{folder === 'Root' ? 'Unassigned' : projName}</span>
                  <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)', background: isActive ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)', padding: '0 var(--space-2)', borderRadius: 'var(--radius-full)', minWidth: '18px', textAlign: 'center', flexShrink: 0 }}>{count}</span>
                </button>
                {folder !== 'Root' && isActive && (
                  <IconButton
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onDeleteProject() }}
                    className="opacity-0 group-hover:opacity-100"
                    style={{ width: '20px', height: '20px', padding: 'var(--space-0)', color: 'var(--apple-red)' }}
                    title="Delete"
                    aria-label="Delete project"
                  >
                    <Trash2 className="w-3 h-3" />
                  </IconButton>
                )}
                {folder !== 'Root' && (
                  <IconButton
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); setProjectMenuOpenId(menuOpen ? null : folder) }}
                    className={`opacity-0 group-hover:opacity-100 ${menuOpen ? 'opacity-100' : ''}`}
                    style={{ width: '20px', height: '20px', padding: 'var(--space-0)', color: 'var(--text-tertiary)' }}
                    title="More"
                    aria-label="Project actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    <MoreHorizontal className="w-3.5 h-3.5" />
                  </IconButton>
                )}
                {menuOpen && folder !== 'Root' && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpenId(null)} />
                    <div
                      role="menu"
                      className="absolute right-2 z-50 animate-fade-in"
                      style={{
                        top: 'calc(100% + var(--space-0))',
                        minWidth: '160px',
                        padding: 'var(--space-1)',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--separator)',
                        boxShadow: 'var(--shadow-popover)',
                      }}
                    >
                      <Button
                        variant="ghost"
                        pill={false}
                        role="menuitem"
                        onClick={() => {
                          setProjectMenuOpenId(null)
                          onArchiveProject?.(folder, projName)
                        }}
                        className="w-full justify-start"
                        style={{ minHeight: '32px', fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}
                      >
                        <Archive className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />
                        <span>Archive</span>
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
          <Button
            variant="ghost"
            pill={false}
            onClick={onCreateProject}
            className="w-full justify-start"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>New Project</span>
          </Button>
        </div>
      </SidebarSection>

      <div style={{ height: '0.5px', background: 'var(--separator)', margin: 'var(--space-1) var(--space-3)' }} />

      {/* Filters */}
      <SidebarSection title="Filters" collapsed={sectionsCollapsed.filters} onToggle={() => toggleSection('filters')} badge={activeFilterCount}>
        <div className="flex flex-col gap-1">
          {/* Quick toggles */}
          <Button
            variant={filterAssignee === 'mine' ? 'secondary' : 'ghost'}
            pill={false}
            onClick={() => setFilterAssignee(filterAssignee === 'mine' ? 'all' : 'mine')}
            className="w-full justify-start"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
          >
            <UserCircle2 className="w-4 h-4 shrink-0" />
            My Tasks
          </Button>
          <Button
            variant={filterToday ? 'secondary' : 'ghost'}
            pill={false}
            onClick={() => setFilterToday(prev => !prev)}
            className="w-full justify-start"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
          >
            <Clock className="w-4 h-4 shrink-0" />
            Updated Today
          </Button>
          <Button
            variant={filterStale ? 'secondary' : 'ghost'}
            pill={false}
            onClick={() => setFilterStale(prev => !prev)}
            className="w-full justify-start"
            style={{
              padding: 'var(--space-2)',
              fontSize: 'var(--text-caption1)',
              color: filterStale ? 'var(--apple-orange)' : undefined,
              background: filterStale ? 'var(--fill-secondary)' : undefined,
            }}
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            Stale Tasks
          </Button>

          {/* Type */}
          <div style={{ padding: 'var(--space-1) var(--space-2)' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Type</span>
            <Select
              fullWidth
              active={filterType !== 'all'}
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              style={{ textTransform: 'capitalize' }}
            >
              {FILTER_TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All' : t}</option>)}
            </Select>
          </div>

          {/* Priority */}
          <div style={{ padding: 'var(--space-1) var(--space-2)' }}>
            <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Priority</span>
            <Select
              fullWidth
              active={filterPriority !== 'all'}
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              {PRIORITY_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>

          {/* Assignee */}
          {filterAssignee !== 'mine' && (
            <div style={{ padding: 'var(--space-1) var(--space-2)' }}>
              <span style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Assignee</span>
              <Select
                fullWidth
                active={filterAssignee !== 'all'}
                value={filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value)}
              >
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {uniqueAssignees.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </div>
          )}

          {activeFilterCount > 0 && (
            <Button
              variant="danger"
              pill={false}
              size="sm"
              onClick={resetAllFilters}
              className="justify-start"
              style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
            >
              <X className="w-3.5 h-3.5" /> Reset filters
            </Button>
          )}

          <div style={{ padding: 'var(--space-0) var(--space-2)', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
            {filteredTasks.length} of {tasks.length} tasks
          </div>
        </div>
      </SidebarSection>

      <div style={{ height: '0.5px', background: 'var(--separator)', margin: 'var(--space-1) var(--space-3)' }} />

      {/* Dashboard */}
      {total > 0 && (
        <SidebarSection title="Dashboard" collapsed={sectionsCollapsed.dashboard} onToggle={() => toggleSection('dashboard')}>
          <div style={{ padding: 'var(--space-1) var(--space-2)' }}>
            {/* Progress */}
            <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>Progress</span>
              <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{donePercent}%</span>
            </div>
            <div className="flex overflow-hidden" style={{ height: '4px', borderRadius: 'var(--radius-full)', background: 'var(--fill-primary)', marginBottom: 'var(--space-2)' }}>
              {counts.done > 0 && <div style={{ width: `${(counts.done / total) * 100}%`, background: 'var(--apple-green)', transition: `width var(--duration-slow) var(--ease-out)` }} />}
              {counts.review > 0 && <div style={{ width: `${(counts.review / total) * 100}%`, background: 'var(--apple-orange)' }} />}
              {counts.in_progress > 0 && <div style={{ width: `${(counts.in_progress / total) * 100}%`, background: 'var(--apple-blue)' }} />}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1" style={{ marginBottom: 'var(--space-2)' }}>
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
              <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '0.5px solid var(--separator)' }}>
                {projectServices.map(svc => {
                  const running = svc.status === 'running'
                  return (
                    <div key={svc.id} className="flex items-center gap-2" style={{ padding: 'var(--space-1) 0' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: running ? 'var(--apple-green)' : 'var(--apple-red)', boxShadow: running ? '0 0 6px var(--apple-green)' : 'none', flexShrink: 0 }} />
                      <span className="truncate" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-app)' }}>{svc.name}</span>
                      <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '0 var(--space-2)', borderRadius: 'var(--radius-full)', flexShrink: 0 }}>:{svc.port}</span>
                      <div className="flex-1" />
                      <IconButton
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); handleToggleService(svc) }}
                        style={{ width: '24px', height: '24px', padding: 'var(--space-1)', color: running ? 'var(--apple-red)' : 'var(--apple-green)' }}
                        title={running ? `Stop ${svc.name}` : `Start ${svc.name}`}
                        aria-label={running ? `Stop ${svc.name}` : `Start ${svc.name}`}
                      >
                        {running ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3 h-3" fill="currentColor" />}
                      </IconButton>
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
      <div className="shrink-0" style={{ padding: 'var(--space-2)', borderTop: '0.5px solid var(--separator)' }}>
        <div className="flex flex-col gap-1">
          <Button
            variant={showPreview ? 'secondary' : 'ghost'}
            pill={false}
            onClick={onOpenPreview}
            className="w-full justify-start"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
          >
            <Eye className="w-4 h-4 shrink-0" /> Preview
          </Button>
          {onOpenDesignStudio && (
            <Button
              variant="ghost"
              pill={false}
              onClick={onOpenDesignStudio}
              className="w-full justify-start"
              style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
            >
              <Palette className="w-4 h-4 shrink-0" /> Design Studio
            </Button>
          )}
          <Button
            variant="ghost"
            pill={false}
            onClick={onOpenChat}
            className="w-full justify-start relative"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
          >
            <MessageCircle className="w-4 h-4 shrink-0" /> Chat
            {chatUnread > 0 && (
              <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'white', background: 'var(--apple-red)', borderRadius: 'var(--radius-full)', minWidth: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 var(--space-1)', marginLeft: 'auto' }}>{chatUnread}</span>
            )}
          </Button>
          <Button
            variant="ghost"
            pill={false}
            onClick={onOpenSettings}
            className="w-full justify-start"
            style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
          >
            <SettingsIcon className="w-4 h-4 shrink-0" /> Settings
          </Button>
          {onOpenHelp && (
            <Button
              variant="ghost"
              pill={false}
              onClick={onOpenHelp}
              className="w-full justify-start"
              style={{ padding: 'var(--space-2)', fontSize: 'var(--text-caption1)' }}
            >
              <HelpCircle className="w-4 h-4 shrink-0" /> Help &amp; Usage
            </Button>
          )}
        </div>
        <div style={{ height: '0.5px', background: 'var(--separator)', margin: 'var(--space-2) 0' }} />
        <div className="flex items-center gap-2" style={{ padding: 'var(--space-1) var(--space-2)' }}>
          <Avatar size="sm" alt={user?.username} color="white" background="var(--accent-app)" />
          <span className="flex-1 truncate" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{user?.username}</span>
          <IconButton
            size="sm"
            onClick={onLogout}
            style={{ width: '24px', height: '24px', padding: 'var(--space-1)', color: 'var(--text-tertiary)' }}
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

export default memo(Sidebar)
