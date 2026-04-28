import { useState, useCallback, useEffect, useMemo } from 'react'
import { LogOut, Search, MessageCircle, X, Eye, Plus, Columns3, List, GitCommitHorizontal, Menu, Copy, Check, HelpCircle } from 'lucide-react'
import Board from './components/Board'
import ListView from './components/ListView'
import ChangesView from './components/ChangesView'
import GraphView from './components/GraphView'
import ViewSwitcher from './components/ViewSwitcher'
import Sidebar from './components/Sidebar'
import TaskModal from './components/TaskModal'
import CreateTaskModal from './components/CreateTaskModal'
import CreateProjectModal from './components/CreateProjectModal'
import ArchivedProjectsModal from './components/ArchivedProjectsModal'
import Login from './components/Login'
import Settings from './components/Settings'
import ProjectDescription from './components/ProjectDescription'
import ProjectProgress from './components/ProjectProgress'
import ChatPanel from './components/ChatPanel'
import ChatNotification from './components/ChatNotification'
import PreviewPanel from './components/PreviewPanel'
import DesignStudio from './components/DesignStudio'
import HelpModal from './components/HelpModal'
import UndoToast from './components/UndoToast'
import ErrorToast from './components/ErrorToast'
import BulkActionBar from './components/BulkActionBar'
import AppShell from './components/shell/AppShell'
import { API_BASE, apiFetch } from './config'
import { faceliftShellEnabled } from './config/featureFlags'
import useChat from './hooks/useChat'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TaskProvider, useTaskContext } from './contexts/TaskContext'
import { lazy, Suspense } from 'react'

// Dev-only kitchen sink — tree-shaken in production
const KitchenSink = import.meta.env.DEV ? lazy(() => import('./components/KitchenSink')) : null

function AppContent() {
  const { user, theme, setTheme, socketRef, handleLogout, updateUser } = useAuth()
  const ctx = useTaskContext()

  const {
    tasks, projects, loading, selectedTask, activeProject, setActiveProject,
    filterType, setFilterType, filterPriority, setFilterPriority,
    filterAssignee, setFilterAssignee, searchQuery, setSearchQuery,
    filterToday, setFilterToday, filterStale, setFilterStale,
    filteredTasks, uniqueAssignees, activeFilterCount, resetAllFilters,
    selectTask, handleUpdateTask, handleDeleteTask, handleCreateTask,
    handleCreateProject, handleDeleteProject,
    archivedProjects, archiveProject, unarchiveProject,
    activeAgents, agentsEnabled, aiChatEnabled, taskViewers, handleStartAgent, handleStopAgent,
    undoRedo,
    bulkSelectMode, setBulkSelectMode, selectedTaskIds, batchLoading,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    selectAllVisible, deselectAll, exitBulkMode,
    handleBatchUpdate, handleBatchDelete,
    errorToast, setErrorToast,
    recentlyUpdatedIds,
    githubLinks,
  } = ctx

  // Active project ID lookup
  const activeProjectInfo = useMemo(() => {
    if (!activeProject || activeProject === 'All') return null
    const proj = projects.find(p => (p.folder || p) === activeProject)
    return proj && proj.id && proj.id !== 'root' ? proj : null
  }, [projects, activeProject])
  const [copiedProjectId, setCopiedProjectId] = useState(false)
  const handleCopyProjectId = useCallback(() => {
    if (!activeProjectInfo?.id) return
    navigator.clipboard.writeText(activeProjectInfo.id).then(() => {
      setCopiedProjectId(true)
      setTimeout(() => setCopiedProjectId(false), 1500)
    })
  }, [activeProjectInfo])

  // --- UI state (local to layout) ---
  const [showSettings, setShowSettings] = useState(false)
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false)
  const [showCreateProjectModal, setShowCreateProjectModal] = useState(false)
  const [showArchivedModal, setShowArchivedModal] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewServices, setPreviewServices] = useState([])
  const [dashboardCollapsed, setDashboardCollapsed] = useState(() => localStorage.getItem('taskBoardDashCollapsed') === 'true')
  const [activeView, setActiveView] = useState(() => localStorage.getItem('taskBoardView') || 'board')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('taskBoardSidebarCollapsed') === 'true')
  const [showMobileDrawer, setShowMobileDrawer] = useState(false)
  const [showMobileSearch, setShowMobileSearch] = useState(false)
  const [showKitchenSink, setShowKitchenSink] = useState(false)
  const [showDesignStudio, setShowDesignStudio] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Kitchen sink shortcut: Ctrl+Shift+K (dev only)
  useEffect(() => {
    if (!KitchenSink) return
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'K') {
        e.preventDefault()
        setShowKitchenSink(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // Help shortcut: `?` opens the help modal. Suppressed inside text inputs and
  // when any modal is already open (ModalOverlay marks body.modal-open).
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== '?') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = document.activeElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (document.body.classList.contains('modal-open')) return
      e.preventDefault()
      setShowHelp(true)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // --- Chat ---
  const chat = useChat(user, socketRef)
  const {
    showChat, setShowChat, chatMinimized, setChatMinimized,
    chatUnread, setChatUnread, chatMessages, chatOnlineUsers, chatTypingUsers,
    chatSoundEnabled, setChatSoundEnabled, toastQueue,
    handleToggleChat, dismissToast, openChat,
  } = chat

  // --- Preview services ---
  const fetchPreviewServices = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/services`)
      if (res.ok) setPreviewServices(await res.json())
    } catch (e) { /* non-critical */ }
  }, [])

  const handleTogglePreview = useCallback(() => {
    setShowPreview(prev => {
      if (!prev) fetchPreviewServices()
      return !prev
    })
  }, [fetchPreviewServices])

  useEffect(() => {
    if (!user) return
    fetchPreviewServices()
    const interval = setInterval(fetchPreviewServices, 30000)
    return () => clearInterval(interval)
  }, [user, fetchPreviewServices])

  useEffect(() => {
    if (!showPreview) return
    fetchPreviewServices()
    const interval = setInterval(fetchPreviewServices, 10000)
    return () => clearInterval(interval)
  }, [showPreview, fetchPreviewServices])

  // --- Layout handlers ---
  const handleChangeView = useCallback((view) => {
    setActiveView(view)
    localStorage.setItem('taskBoardView', view)
  }, [])

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed(prev => {
      localStorage.setItem('taskBoardSidebarCollapsed', String(!prev))
      return !prev
    })
  }, [])

  const handleArchiveProject = useCallback(async (idOrName, displayName) => {
    const result = await archiveProject(idOrName)
    if (result.ok) {
      undoRedo.pushCustomUndo(`Archived "${displayName || idOrName}"`, {
        undoFn: () => { unarchiveProject(idOrName) },
        undoneMessage: `Restored "${displayName || idOrName}"`,
        redoFn: () => { archiveProject(idOrName) },
        redoneMessage: `Archived "${displayName || idOrName}"`,
      })
    } else {
      ctx.setErrorToast(result.error || 'Archive failed')
    }
  }, [archiveProject, unarchiveProject, undoRedo, ctx])

  const handleUnarchiveProject = useCallback(async (idOrName, displayName) => {
    const result = await unarchiveProject(idOrName)
    if (result.ok) {
      undoRedo.pushCustomUndo(`Restored "${displayName || idOrName}"`, {
        undoFn: () => { archiveProject(idOrName) },
        undoneMessage: `Archived "${displayName || idOrName}"`,
        redoFn: () => { unarchiveProject(idOrName) },
        redoneMessage: `Restored "${displayName || idOrName}"`,
      })
    } else {
      ctx.setErrorToast(result.error || 'Restore failed')
    }
  }, [archiveProject, unarchiveProject, undoRedo, ctx])

  // --- Sidebar props (shared between desktop and mobile drawer) ---
  const sidebarProps = {
    projects, tasks, activeProject,
    onSetActiveProject: setActiveProject,
    onCreateProject: () => setShowCreateProjectModal(true),
    onDeleteProject: handleDeleteProject,
    archivedProjects,
    onArchiveProject: handleArchiveProject,
    onOpenArchivedModal: () => setShowArchivedModal(true),
    filterType, setFilterType,
    filterPriority, setFilterPriority,
    filterAssignee, setFilterAssignee,
    filterToday, setFilterToday,
    filterStale, setFilterStale,
    uniqueAssignees, activeFilterCount, resetAllFilters, filteredTasks,
    services: previewServices, onServiceAction: fetchPreviewServices,
    user, onLogout: handleLogout,
    onOpenSettings: () => setShowSettings(true),
    onOpenChat: handleToggleChat,
    onOpenPreview: handleTogglePreview,
    onOpenDesignStudio: () => { fetchPreviewServices(); setShowDesignStudio(true) },
    onOpenHelp: () => setShowHelp(true),
    chatUnread, showPreview,
  }

  return (
    <div className="flex h-screen overflow-hidden bg-app-bg text-app-text app-shell" style={{ fontFamily: 'var(--font-sans)', transition: `background-color var(--duration-slow) var(--ease-default), color var(--duration-slow) var(--ease-default)` }}>

      {/* Sidebar (desktop) */}
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapse={handleToggleSidebar} {...sidebarProps} />

      {/* Mobile drawer backdrop */}
      {showMobileDrawer && (
        <div className="fixed inset-0 z-40 sm:hidden animate-fade-in" style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} onClick={() => setShowMobileDrawer(false)} />
      )}

      {/* Mobile drawer sidebar */}
      {showMobileDrawer && (
        <div className="fixed inset-y-0 left-0 z-50 sm:hidden animate-slide-in" style={{ width: '280px', maxWidth: '80vw' }}>
          <div className="h-full flex flex-col" style={{ background: 'var(--bg-secondary)' }}>
            <Sidebar
              mobile collapsed={false}
              onToggleCollapse={() => setShowMobileDrawer(false)}
              {...sidebarProps}
              onSetActiveProject={(p) => { setActiveProject(p); setShowMobileDrawer(false) }}
              onCreateProject={() => { setShowCreateProjectModal(true); setShowMobileDrawer(false) }}
              onDeleteProject={() => { handleDeleteProject(); setShowMobileDrawer(false) }}
              onOpenSettings={() => { setShowSettings(true); setShowMobileDrawer(false) }}
              onOpenChat={() => { handleToggleChat(); setShowMobileDrawer(false) }}
              onOpenPreview={() => { handleTogglePreview(); setShowMobileDrawer(false) }}
              onOpenHelp={() => { setShowHelp(true); setShowMobileDrawer(false) }}
            />
          </div>
        </div>
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="shrink-0 flex items-center gap-2 sm:gap-3 topbar" style={{ padding: '10px 12px' }}>
          <button onClick={() => setShowMobileDrawer(true)} className="sm:hidden apple-press shrink-0" style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
            <Menu className="w-5 h-5" />
          </button>

          {/* Project ID badge */}
          {activeProjectInfo && (
            <button
              onClick={handleCopyProjectId}
              className="hidden sm:flex items-center gap-1.5 apple-press shrink-0"
              style={{
                padding: '5px 10px',
                borderRadius: 'var(--radius-md)',
                background: copiedProjectId ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)' : 'var(--fill-secondary)',
                border: `1px solid ${copiedProjectId ? 'color-mix(in srgb, var(--apple-green) 25%, transparent)' : 'var(--separator)'}`,
                fontSize: '12px',
                fontWeight: 600,
                fontFamily: 'var(--font-mono, ui-monospace, monospace)',
                color: copiedProjectId ? 'var(--apple-green)' : 'var(--text-tertiary)',
                letterSpacing: '0.02em',
                transition: 'all 0.15s ease',
              }}
              title={copiedProjectId ? 'Copied!' : `Copy project ID: ${activeProjectInfo.id}`}
            >
              {copiedProjectId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {activeProjectInfo.id}
            </button>
          )}

          {/* Search — desktop */}
          <div className="relative group hidden sm:block flex-1" style={{ maxWidth: '480px' }}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-text-muted group-focus-within:text-app-accent" style={{ transition: `color var(--duration-fast)` }} />
            <input
              type="text" autoComplete="off" placeholder="Search tasks..."
              value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-app-text search-input"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-app-text-muted" style={{ background: 'var(--fill-primary)' }}>
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Mobile search */}
          {!showMobileSearch ? (
            <button onClick={() => setShowMobileSearch(true)} className="sm:hidden apple-press shrink-0" style={{ padding: '6px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
              <Search className="w-5 h-5" />
            </button>
          ) : (
            <div className="sm:hidden flex-1 flex items-center gap-2" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>
              <Search className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
              <input type="text" autoComplete="off" placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="flex-1 text-app-text focus:outline-none bg-transparent" style={{ fontSize: 'var(--text-subhead)', border: 'none' }} autoFocus />
              <button onClick={() => { setShowMobileSearch(false); setSearchQuery('') }} className="shrink-0" style={{ color: 'var(--text-muted)', padding: '2px' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!showMobileSearch && <div className="flex-1" />}

          <div className="hidden sm:block">
            <ViewSwitcher activeView={activeView} onChangeView={handleChangeView} />
          </div>

          <button
            onClick={() => setShowHelp(true)}
            aria-label="Help"
            title="Help & Usage"
            className="apple-press hidden sm:flex items-center justify-center shrink-0"
            style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', color: 'var(--text-muted)', background: 'var(--fill-secondary)' }}
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          <button onClick={() => setShowCreateTaskModal(true)} className="apple-press text-white whitespace-nowrap hidden sm:flex items-center gap-1.5" style={{ padding: '7px 16px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)' }}>
            <Plus className="w-4 h-4" /> New Task
          </button>
          {!showMobileSearch && (
            <button onClick={() => setShowCreateTaskModal(true)} className="sm:hidden apple-press flex items-center justify-center text-white shrink-0" style={{ width: '34px', height: '34px', borderRadius: 'var(--radius-md)', background: 'var(--accent-app)' }}>
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar main-scroll-area" style={{ padding: '16px' }}>
          {bulkSelectMode && selectedTaskIds.length > 0 && (
            <BulkActionBar
              selectedIds={selectedTaskIds} totalVisible={filteredTasks.length}
              onSelectAll={selectAllVisible} onDeselectAll={deselectAll} onExit={exitBulkMode}
              onBatchUpdate={handleBatchUpdate} onBatchDelete={handleBatchDelete}
              uniqueAssignees={uniqueAssignees} currentUser={user?.username} loading={batchLoading}
            />
          )}

          {loading ? (
            <div className="text-center text-app-text-muted py-12 italic animate-pulse">Loading workspace...</div>
          ) : activeView === 'list' ? (
            <ListView tasks={filteredTasks} onSelectTask={selectTask} onUpdateTask={undoRedo.updateTaskWithUndo} activeAgents={activeAgents} taskViewers={taskViewers} currentUser={user?.username} selectable={bulkSelectMode} selectedIds={selectedTaskIds} onToggleSelect={toggleSelectTask} recentlyUpdatedIds={recentlyUpdatedIds} githubLinks={githubLinks} />
          ) : activeView === 'changes' ? (
            <ChangesView tasks={filteredTasks} projects={projects} activeProject={activeProject} onSelectTask={selectTask} recentlyUpdatedIds={recentlyUpdatedIds} />
          ) : activeView === 'graph' ? (
            <GraphView tasks={filteredTasks} projects={projects} onSelectTask={selectTask} />
          ) : (
            <Board
              tasks={filteredTasks} onUpdateTask={undoRedo.updateTaskWithUndo} onSelectTask={selectTask}
              activeAgents={activeAgents} onStartAgent={handleStartAgent} onStopAgent={handleStopAgent}
              taskViewers={taskViewers} currentUser={user?.username}
              selectable={bulkSelectMode} selectedIds={selectedTaskIds}
              onToggleSelect={toggleSelectTask} onShiftSelect={shiftSelectTask} onToggleSelectColumn={toggleSelectColumn}
              recentlyUpdatedIds={recentlyUpdatedIds}
              onToggleBulkSelect={() => setBulkSelectMode(prev => { if (prev) { ctx.deselectAll(); return false } return true })}
              githubLinks={githubLinks}
            />
          )}
        </div>

        {/* Modals */}
        {selectedTask && (
          <TaskModal task={selectedTask} projects={projects} currentUser={user} onClose={() => selectTask(null)} onUpdateTask={undoRedo.updateTaskWithUndo} onDeleteTask={handleDeleteTask} activeAgents={activeAgents} onStartAgent={handleStartAgent} onStopAgent={handleStopAgent} socket={socketRef.current} taskViewers={taskViewers[selectedTask?.id] || []} agentsEnabled={agentsEnabled} canRunAgents={user?.can_run_agents !== false} aiChatEnabled={aiChatEnabled} githubLinks={githubLinks} />
        )}
        {showCreateTaskModal && <CreateTaskModal projects={projects} activeProject={activeProject} onClose={() => setShowCreateTaskModal(false)} onCreateTask={handleCreateTask} />}
        {showCreateProjectModal && <CreateProjectModal onClose={() => setShowCreateProjectModal(false)} onCreateProject={handleCreateProject} />}
        {showArchivedModal && (
          <ArchivedProjectsModal
            archivedProjects={archivedProjects}
            onClose={() => setShowArchivedModal(false)}
            onUnarchiveProject={(idOrName, displayName) => {
              handleUnarchiveProject(idOrName, displayName)
            }}
          />
        )}
        {showSettings && <Settings theme={theme} onSetTheme={setTheme} onClose={() => setShowSettings(false)} currentUser={user} onUserUpdate={updateUser} onOpenPreview={() => { fetchPreviewServices(); setShowPreview(true) }} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
        {showPreview && <PreviewPanel services={previewServices} onClose={() => setShowPreview(false)} socket={socketRef.current} activeProject={activeProject} />}
        {showDesignStudio && <DesignStudio services={previewServices} onClose={() => setShowDesignStudio(false)} activeProject={activeProject} user={user} socket={socketRef.current} />}
        {showChat && <ChatPanel user={user} socket={socketRef.current} messages={chatMessages} onlineUsers={chatOnlineUsers} typingUsers={chatTypingUsers} minimized={chatMinimized} onMinimize={setChatMinimized} soundEnabled={chatSoundEnabled} onToggleSound={() => setChatSoundEnabled(prev => !prev)} onClose={() => setShowChat(false)} onUnreadChange={setChatUnread} aiChatEnabled={aiChatEnabled} />}

        {/* Dev kitchen sink (Ctrl+Shift+K) */}
        {KitchenSink && showKitchenSink && (
          <Suspense fallback={null}>
            <KitchenSink onClose={() => setShowKitchenSink(false)} currentTheme={theme} onSetTheme={setTheme} />
          </Suspense>
        )}

        {/* Toasts */}
        <ChatNotification toasts={toastQueue} onDismiss={dismissToast} onOpenChat={openChat} />
        <UndoToast message={undoRedo.undoToast} canUndo={undoRedo.canUndo} canRedo={undoRedo.canRedo} onUndo={undoRedo.undo} onRedo={undoRedo.redo} onDismiss={undoRedo.clearToast} />
        <ErrorToast message={errorToast} onDismiss={() => setErrorToast(null)} />

        {/* Mobile bottom tab bar */}
        <nav className="fixed bottom-0 left-0 right-0 z-40 flex sm:hidden items-end justify-around vibrancy-thick safe-bottom mobile-tab-bar">
          {[
            { icon: Menu, label: 'Menu', active: false, onClick: () => setShowMobileDrawer(true) },
            { icon: activeView === 'list' ? List : activeView === 'changes' ? GitCommitHorizontal : Columns3, label: activeView === 'list' ? 'List' : activeView === 'changes' ? 'Changes' : 'Board', active: true, onClick: () => handleChangeView(activeView === 'board' ? 'list' : activeView === 'list' ? 'changes' : 'board') },
            { icon: MessageCircle, label: 'Chat', active: false, onClick: handleToggleChat, badge: chatUnread },
            { icon: Eye, label: 'Preview', active: showPreview, onClick: handleTogglePreview },
          ].map(({ icon: Icon, label, active, onClick, badge }) => (
            <button key={label} onClick={onClick} className="flex flex-col items-center gap-0.5 px-3 py-1 apple-press relative" style={{ minWidth: '50px' }}>
              <Icon className="w-[22px] h-[22px]" style={{ color: active ? 'var(--accent-app)' : 'var(--gray-1)' }} />
              <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: active ? 'var(--accent-app)' : 'var(--gray-1)' }}>{label}</span>
              {badge > 0 && <span className="absolute top-0 right-1 min-w-[17px] h-[17px] flex items-center justify-center px-1 text-white" style={{ fontSize: '10px', fontWeight: 'var(--font-semibold)', borderRadius: 'var(--radius-full)', background: 'var(--apple-red)' }}>{badge}</span>}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

// Root: AuthProvider wraps everything, AppInner conditionally renders TaskProvider + content
function AppRoot() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}

function AppInner() {
  const { user, handleLogin, socketRef } = useAuth()
  if (!user) return <Login onLogin={handleLogin} />
  // Facelift feature flag — off by default. Toggle via:
  //   localStorage.atriumFacelift = 'true'  (then reload)
  const useFacelift = faceliftShellEnabled()
  return (
    <TaskProvider user={user} socketRef={socketRef}>
      {useFacelift ? <AppShell /> : <AppContent />}
    </TaskProvider>
  )
}

export default AppRoot
