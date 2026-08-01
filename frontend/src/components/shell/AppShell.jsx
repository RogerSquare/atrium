// AppShell — THE shell (ui-shell-consolidation-001).
//
// Formerly "the facelift shell" behind the atriumFacelift flag, with a
// complete legacy sidebar+board shell (App.jsx AppContent) beside it. The
// legacy path and the flag are deleted; everything the product does mounts
// here now.
//
// Grid:
//   [topbar]     48px      brand + ProjectAnchor | ViewSwitcher | New Task/Help/Bell/Shell/Avatar
//   [filterbar]  40px      search + type/priority/mine/today/stale + reset
//   [content]    1fr       [focal flex] [side dock {width} or 0]
//
// The side dock hosts ONE of: the task DetailPane, the global shell, or the
// team chat. Settings/Help/Create/Archived modals mount at shell level.
// TaskModal stays as opt-in focus mode via Cmd+Shift+Enter. Design Studio is
// parked behind localStorage.atriumDesignStudio (no nav entry — Q9).

import { useState, useEffect, useCallback, useRef, lazy, Suspense, startTransition } from 'react'
import { Eye } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTaskData, useTaskActions } from '../../contexts/TaskContext'
import { API_BASE, apiFetch } from '../../config'
import { designStudioEnabled } from '../../config/featureFlags'
import useChat from '../../hooks/useChat'
import { MOBILE_MEDIA_QUERY } from '../../hooks/useIsMobile'
import TopBar from './TopBar'
import FilterBar from './FilterBar'
import FocalZone from './FocalZone'
import DetailPane from './DetailPane'
import MobileTabBar from './MobileTabBar'
import CommandPalette from './CommandPalette'
import { AnimatePresence } from '../../lib/motion'

// Lazy-loaded — only downloaded when the user opens a task in focus mode.
const TaskModal = lazy(() => import('../TaskModal'))
// Lazy-loaded — xterm + the global commands list aren't part of the
// initial render path. Pulled in on first click of the TopBar terminal
// button. Suspense-wrapped at the use site below.
const GlobalShellPanel = lazy(() => import('./GlobalShellPanel'))
// Lazy — only ever rendered on a fresh install or an explicit reopen.
const SetupWizard = lazy(() => import('../SetupWizard'))
// Lazy — socket plumbing + GIF picker load on first chat open.
const ChatPanel = lazy(() => import('../ChatPanel'))
// Lazy + parked (Q9): only reachable via localStorage.atriumDesignStudio.
const DesignStudio = lazy(() => import('../DesignStudio'))
// Dev-only kitchen sink — tree-shaken in production (Ctrl+Shift+K).
const KitchenSink = import.meta.env.DEV ? lazy(() => import('../KitchenSink')) : null
import Settings from '../Settings'
import HelpModal from '../HelpModal'
import CreateProjectModal from '../CreateProjectModal'
import CreateTaskModal from '../CreateTaskModal'
import ArchivedProjectsModal from '../ArchivedProjectsModal'
import BulkActionBar from '../BulkActionBar'
import PreviewPanel from '../PreviewPanel'
import ChatNotification from '../ChatNotification'
import ErrorToast from '../ErrorToast'
import UndoToast from '../UndoToast'

const WIDTH_STORAGE_KEY = 'taskBoardDetailWidth'
// The default width doubles as the MINIMUM — the detail pane can be dragged
// WIDER (to give the task more room) but never narrower than its default. This
// inverts the old behavior where default === max and you could only shrink it.
const DEFAULT_WIDTH = 720
const MIN_WIDTH = DEFAULT_WIDTH
// Keep at least this much horizontal space for the focal zone (board/list) so
// the pane can't grow to cover the whole window.
const MIN_FOCAL = 400

// Upper bound is viewport-relative so the pane never exceeds the window: it can
// grow until the focal zone is squeezed to MIN_FOCAL, but no further. Guards
// against MIN > max on very narrow desktops by never returning below MIN_WIDTH.
function maxDetailWidth(viewportWidth = window.innerWidth) {
  return Math.max(MIN_WIDTH, viewportWidth - MIN_FOCAL)
}

function clampWidth(raw, viewportWidth = window.innerWidth) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return DEFAULT_WIDTH
  return Math.max(MIN_WIDTH, Math.min(n, maxDetailWidth(viewportWidth)))
}

function readStoredWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY)
    if (raw != null) return clampWidth(raw)
  } catch { /* storage unavailable — fall through to default */ }
  return DEFAULT_WIDTH
}

export default function AppShell() {
  const { user, theme, setTheme, socketRef, handleLogout, updateUser } = useAuth()
  // Two-context split (Phase 3 of opt-perf-audit-001-implement). Same pattern
  // as App.jsx's AppContent — split the destructure across the two slices so
  // the facelift shell only re-renders when the slice it actually reads changes.
  const {
    filteredTasks, tasks, projects, activeProject, setActiveProject,
    loading, selectedTask,
    archivedProjects,
    searchQuery, setSearchQuery,
    filterType, setFilterType, filterPriority, setFilterPriority,
    filterAssignee, setFilterAssignee, filterToday, setFilterToday,
    filterStale, setFilterStale,
    filterShellActive, setFilterShellActive,
    uniqueAssignees, activeFilterCount,
    activeAgents, taskViewers,
    bulkSelectMode, selectedTaskIds, batchLoading,
    recentlyUpdatedIds, githubLinks, errorToast,
    agentsEnabled, aiChatEnabled,
  } = useTaskData()
  const {
    selectTask, handleDeleteTask, handleCreateProject, handleCreateTask,
    archiveProject, unarchiveProject,
    resetAllFilters,
    handleStartAgent, handleStopAgent,
    undoRedo, setBulkSelectMode,
    toggleSelectTask, shiftSelectTask, toggleSelectColumn,
    selectAllVisible, deselectAll, exitBulkMode,
    handleBatchUpdate, handleBatchDelete,
    setErrorToast,
  } = useTaskActions()

  const [activeView, setActiveView] = useState(() => localStorage.getItem('taskBoardView') || 'board')
  const [focusModal, setFocusModal] = useState(false)
  const [detailWidth, setDetailWidth] = useState(readStoredWidth)

  // Single source of truth for resizing the detail pane: clamp to
  // [MIN_WIDTH, viewport − MIN_FOCAL] and persist so the width survives a
  // reload AND a logout (logout only clears taskBoardUser, not this key).
  // DetailPane reports a raw target width; clamping/persistence live here.
  const setDetailWidthClamped = useCallback((raw) => {
    const w = clampWidth(raw)
    setDetailWidth(w)
    try { localStorage.setItem(WIDTH_STORAGE_KEY, String(w)) } catch { /* storage disabled */ }
  }, [])

  // Re-clamp on viewport shrink so a previously-wide pane can never end up
  // larger than the new window. Doesn't persist the shrink — the user's chosen
  // width is restored (clamped) when there's room again.
  useEffect(() => {
    const onResize = () => setDetailWidth(w => clampWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [showSettings, setShowSettings] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewServices, setPreviewServices] = useState([])
  const [showGlobalShell, setShowGlobalShell] = useState(false)
  const [showSetupWizard, setShowSetupWizard] = useState(false)
  // Design Studio is parked (Q9): mounts at boot ONLY when its flag is set —
  // there is no nav entry. Closing it parks it again until the next reload.
  const [showDesignStudio, setShowDesignStudio] = useState(() => designStudioEnabled())
  const [showKitchenSink, setShowKitchenSink] = useState(false)
  // Narrow-viewport mode — master-detail doesn't fit below the shared
  // MOBILE_BREAKPOINT, so DetailPane switches to a full-screen overlay and
  // the bottom tab bar takes over view switching + primary actions
  // (ui-mobile-appshell-001: one token, no more 639/768 mix).
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(MOBILE_MEDIA_QUERY).matches : false
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (e) => setNarrow(e.matches)
    mql.addEventListener?.('change', onChange)
    return () => mql.removeEventListener?.('change', onChange)
  }, [])
  const syncingUrl = useRef(false)

  // --- Which projects declare test suites (ui-tests-tab-generic-001) -------
  // Fetched lazily per visited project and cached for the session. Drives the
  // card-level tests badge: only projects that opted into atrium.tests.json
  // (or tasks with actual run data) show it — no more permanent "pending".
  const [testedProjects, setTestedProjects] = useState(() => new Set())
  const checkedProjectsRef = useRef(new Set())
  useEffect(() => {
    const p = activeProject
    if (!p || p === 'All' || p === 'Root' || checkedProjectsRef.current.has(p)) return
    checkedProjectsRef.current.add(p)
    apiFetch(`${API_BASE}/api/runners/suites?project=${encodeURIComponent(p)}`)
      .then((r) => (r.ok ? r.json() : { declared: false }))
      .then((d) => {
        if (d && d.declared) setTestedProjects((prev) => new Set(prev).add(p))
      })
      .catch(() => { /* stays unlisted — badge falls back to run-data-only */ })
  }, [activeProject])

  // --- Team chat (ported from the legacy shell, ui-shell-consolidation-001).
  // The hook owns messages/unread/toasts over the shared authed socket; the
  // panel renders as a dock occupant below. setShowChat is destructured so
  // callbacks can depend on the stable setter, not the per-render hook object.
  const chat = useChat(user, socketRef)
  const { setShowChat } = chat

  // Dev kitchen sink shortcut: Ctrl+Shift+K.
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

  // Preload TaskModal in the background once the shell mounts. After F2
  // made it lazy, the first focus-mode open of a session paid the chunk-load.
  // Fire-and-forget — the import resolves whenever it does; React.lazy
  // dedupes when the user opens the modal. See opt-select-task-latency-001.
  useEffect(() => {
    import('../TaskModal').catch(() => { /* ignore — lazy() handles errors at use site */ })
  }, [])

  const handleChangeView = useCallback((view) => {
    // startTransition keeps the current view interactive while React renders
    // the next view in the background. localStorage.setItem stays outside the
    // transition so the persisted value matches what the user clicked.
    // See opt-view-switch-latency-001.
    startTransition(() => setActiveView(view))
    localStorage.setItem('taskBoardView', view)
  }, [])

  // --- First-run setup (feat-first-run-setup-001) -------------------------
  // Asked once per mount. Anything other than an explicit "incomplete" leaves
  // the wizard shut — a network blip must not pop a setup dialog at someone
  // whose install is already configured.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/setup/status`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data && data.complete === false) setShowSetupWizard(true)
      } catch { /* stay closed */ }
    })()
    return () => { cancelled = true }
  }, [])

  // --- Preview services (background poll) --------------------------------
  const fetchPreviewServices = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/services`)
      if (res.ok) setPreviewServices(await res.json())
    } catch { /* non-critical */ }
  }, [])
  useEffect(() => {
    fetchPreviewServices()
    const interval = setInterval(fetchPreviewServices, 30000)
    return () => clearInterval(interval)
  }, [fetchPreviewServices])
  useEffect(() => {
    if (!showPreview) return
    fetchPreviewServices()
    const interval = setInterval(fetchPreviewServices, 10000)
    return () => clearInterval(interval)
  }, [showPreview, fetchPreviewServices])

  // --- URL <-> selection round-trip -------------------------------------
  useEffect(() => {
    const applyUrl = () => {
      syncingUrl.current = true
      try {
        const taskId = new URLSearchParams(window.location.search).get('task')
        if (taskId) {
          const t = tasks.find((x) => x.id === taskId)
          if (t) selectTask(t)
          else if (selectedTask) selectTask(null)
        } else if (selectedTask) {
          selectTask(null)
        }
      } finally {
        queueMicrotask(() => { syncingUrl.current = false })
      }
    }
    applyUrl()
    window.addEventListener('popstate', applyUrl)
    return () => window.removeEventListener('popstate', applyUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks])

  useEffect(() => {
    if (syncingUrl.current) return
    const url = new URL(window.location.href)
    if (selectedTask) {
      if (url.searchParams.get('task') !== selectedTask.id) {
        url.searchParams.set('task', selectedTask.id)
        window.history.pushState({}, '', url)
      }
    } else if (url.searchParams.has('task')) {
      url.searchParams.delete('task')
      window.history.pushState({}, '', url)
    }
  }, [selectedTask])

  // --- Keyboard -----------------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      // The global shell used to be a modal, so simply being open suppressed
      // these. As a dock it coexists with an open task, and suppressing on
      // "open" would disable task shortcuts for the whole session. Gate on
      // FOCUS instead: keys typed into the terminal belong to the terminal
      // (Esc leaves insert mode in vim, interrupts prompts in claude), while
      // the same keys pressed on the board still drive the task pane.
      if (showGlobalShell && document.activeElement?.closest?.('[data-testid="global-shell-panel"]')) return
      if (!selectedTask) return
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        setFocusModal((v) => !v)
        return
      }
      if (e.key === 'Escape' && !focusModal) selectTask(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedTask, focusModal, selectTask, showGlobalShell])

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

  useEffect(() => { if (!selectedTask) setFocusModal(false) }, [selectedTask])

  // Picking a task from the board hands the dock back to it. Without this the
  // click would appear to do nothing — the task would be selected but stay
  // hidden behind the shell or chat, which is indistinguishable from a dead
  // card.
  const selectTaskFromFocal = useCallback((task) => {
    if (task) {
      setShowGlobalShell(false)
      setShowChat(false)
    }
    selectTask(task)
  }, [selectTask, setShowChat])

  // The side region shows exactly ONE thing at a time — the task pane, the
  // global shell, or the team chat, never two. A vertical split was tried and
  // rejected: it left the terminal in a short strip and made the region feel
  // crowded rather than like a place you work.
  //
  // Precedence: shell > chat > task. The selected task is NOT cleared when the
  // shell or chat takes over, only hidden — closing them brings it straight
  // back (the shell header carries the task as a back-chip).
  const chatOpen = chat.showChat && !focusModal && !showGlobalShell
  const detailOpen = Boolean(selectedTask) && !focusModal && !showGlobalShell && !chatOpen
  const backgroundTask = showGlobalShell && !focusModal ? selectedTask : null
  const sideOpen = detailOpen || showGlobalShell || chatOpen
  // On narrow viewports both are fixed overlays — grid column stays 0.
  const detailGridCol = sideOpen && !narrow ? `minmax(0, ${detailWidth}px)` : '0'

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
      setErrorToast(result.error || 'Archive failed')
    }
  }, [archiveProject, unarchiveProject, undoRedo, setErrorToast])

  // Restore with undo — parity with the legacy shell's handler (the modal
  // previously called unarchiveProject bare, so restores weren't undoable).
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
      setErrorToast(result.error || 'Restore failed')
    }
  }, [archiveProject, unarchiveProject, undoRedo, setErrorToast])

  return (
    <div
      className="h-screen overflow-hidden bg-app-bg text-app-text app-shell facelift-shell"
      style={{
        display: 'grid',
        gridTemplateRows: '[topbar] 48px [filterbar] 40px [content] 1fr',
        gridTemplateColumns: `[focal] 1fr [detail] ${detailGridCol}`,
        gridTemplateAreas: `
          'topbar topbar'
          'filterbar filterbar'
          'focal detail'
        `,
        fontFamily: 'var(--font-sans)',
      }}
    >
      <TopBar
        user={user}
        theme={theme}
        onSetTheme={setTheme}
        onLogout={handleLogout}
        activeView={activeView}
        onChangeView={handleChangeView}
        projects={projects}
        tasks={tasks}
        activeProject={activeProject}
        onSetActiveProject={setActiveProject}
        onCreateProject={() => setShowCreateProject(true)}
        onOpenArchived={() => setShowArchived(true)}
        onArchiveProject={handleArchiveProject}
        archivedCount={archivedProjects?.length || 0}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
        onCreateTask={() => setShowCreateTask(true)}
        onSelectTask={selectTaskFromFocal}
        onToggleGlobalShell={() => setShowGlobalShell(v => !v)}
        globalShellOpen={showGlobalShell}
        onToggleChat={() => { setShowGlobalShell(false); chat.handleToggleChat() }}
        chatUnread={chat.chatUnread}
        chatOpen={chatOpen}
      />

      <FilterBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filterType={filterType}
        setFilterType={setFilterType}
        filterPriority={filterPriority}
        setFilterPriority={setFilterPriority}
        filterAssignee={filterAssignee}
        setFilterAssignee={setFilterAssignee}
        filterToday={filterToday}
        setFilterToday={setFilterToday}
        filterStale={filterStale}
        setFilterStale={setFilterStale}
        filterShellActive={filterShellActive}
        setFilterShellActive={setFilterShellActive}
        uniqueAssignees={uniqueAssignees}
        activeFilterCount={activeFilterCount}
        resetAllFilters={resetAllFilters}
        filteredCount={filteredTasks.length}
        totalCount={tasks.length}
      />

      <FocalZone
        activeView={activeView}
        tasks={filteredTasks}
        projects={projects}
        activeProject={activeProject}
        loading={loading}
        onSelectTask={selectTaskFromFocal}
        onUpdateTask={undoRedo.updateTaskWithUndo}
        onStartAgent={handleStartAgent}
        onStopAgent={handleStopAgent}
        activeAgents={activeAgents}
        taskViewers={taskViewers}
        currentUser={user?.username}
        selectable={bulkSelectMode}
        selectedIds={selectedTaskIds}
        onToggleSelect={toggleSelectTask}
        onShiftSelect={shiftSelectTask}
        onToggleSelectColumn={toggleSelectColumn}
        onToggleBulkSelect={() =>
          setBulkSelectMode((prev) => {
            if (prev) { deselectAll(); return false }
            return true
          })
        }
        recentlyUpdatedIds={recentlyUpdatedIds}
        githubLinks={githubLinks}
        socketRef={socketRef}
        onCreateTask={() => setShowCreateTask(true)}
        testedProjects={testedProjects}
        topSlot={
          bulkSelectMode && selectedTaskIds.length > 0 ? (
            <BulkActionBar
              selectedIds={selectedTaskIds}
              totalVisible={filteredTasks.length}
              onSelectAll={selectAllVisible}
              onDeselectAll={deselectAll}
              onExit={exitBulkMode}
              onBatchUpdate={handleBatchUpdate}
              onBatchDelete={handleBatchDelete}
              uniqueAssignees={uniqueAssignees}
              currentUser={user?.username}
              loading={batchLoading}
            />
          ) : null
        }
      />

      {/* SIDE DOCK — one grid column, one occupant at a time:
            task open           → DetailPane fills the column
            shell open          → GlobalShellPanel fills the column, and the
                                  task (if any) waits behind it, surfaced as a
                                  back-chip in the shell header
          On narrow viewports there is no column at all and both render as
          full-screen overlays, matching what DetailPane already did. */}
      <div
        style={narrow ? undefined : {
          gridArea: 'detail',
          display: sideOpen ? 'flex' : 'none',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <AnimatePresence initial={false}>
          {detailOpen && (
            <DetailPane
              key="detail-pane"
              task={selectedTask}
              currentUser={user}
              onClose={() => selectTask(null)}
              onSelectTask={selectTaskFromFocal}
              tasks={tasks}
              onUpdateTask={undoRedo.updateTaskWithUndo}
              activeAgents={activeAgents}
              onStartAgent={handleStartAgent}
              onStopAgent={handleStopAgent}
              socket={socketRef?.current}
              agentsEnabled={agentsEnabled}
              canRunAgents={user?.can_run_agents !== false}
              aiChatEnabled={aiChatEnabled}
              width={detailWidth}
              onWidthChange={setDetailWidthClamped}
              narrow={narrow}
              docked={!narrow}
            />
          )}
        </AnimatePresence>
        {showGlobalShell && (
          <Suspense fallback={null}>
            {/* Own socket — see SOCKET LIFECYCLE in GlobalShellPanel.jsx.
                Sharing AuthContext's socket would trip the backend's
                one-PTY-per-socket cap and kill the DetailPane Shell tab's
                terminal the moment this one opens. */}
            <GlobalShellPanel
              onClose={() => setShowGlobalShell(false)}
              narrow={narrow}
              backgroundTask={backgroundTask}
              onReturnToTask={() => setShowGlobalShell(false)}
              width={detailWidth}
              onWidthChange={setDetailWidthClamped}
            />
          </Suspense>
        )}
        {chatOpen && (
          <Suspense fallback={null}>
            {/* Docked on desktop; the panel's own fullscreen-overlay layout on
                narrow viewports (matching DetailPane's split behavior). */}
            <ChatPanel
              docked={!narrow}
              user={user}
              socket={socketRef?.current}
              messages={chat.chatMessages}
              onlineUsers={chat.chatOnlineUsers}
              typingUsers={chat.chatTypingUsers}
              minimized={false}
              onMinimize={() => {}}
              soundEnabled={chat.chatSoundEnabled}
              onToggleSound={() => chat.setChatSoundEnabled(prev => !prev)}
              onClose={() => chat.setShowChat(false)}
              onUnreadChange={chat.setChatUnread}
              aiChatEnabled={aiChatEnabled}
            />
          </Suspense>
        )}
      </div>

      {/* Focus modal — opt-in via Cmd+Shift+Enter */}
      {focusModal && selectedTask && (
        <Suspense fallback={null}>
          <TaskModal
            task={selectedTask}
            projects={projects}
            currentUser={user}
            onClose={() => { setFocusModal(false); selectTask(null) }}
            onUpdateTask={undoRedo.updateTaskWithUndo}
            onDeleteTask={handleDeleteTask}
            activeAgents={activeAgents}
            onStartAgent={handleStartAgent}
            onStopAgent={handleStopAgent}
            socket={socketRef?.current}
            taskViewers={taskViewers[selectedTask?.id] || []}
            agentsEnabled={agentsEnabled}
            canRunAgents={user?.can_run_agents !== false}
            aiChatEnabled={aiChatEnabled}
            githubLinks={githubLinks}
          />
        </Suspense>
      )}

      {/* Settings / Help / Create Project / Archived — mounted at shell level */}
      {showSettings && (
        <Settings
          theme={theme}
          onSetTheme={setTheme}
          onClose={() => setShowSettings(false)}
          currentUser={user}
          onUserUpdate={updateUser}
          onOpenSetup={() => { setShowSettings(false); setShowSetupWizard(true) }}
        />
      )}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showCreateProject && (
        <CreateProjectModal
          onClose={() => setShowCreateProject(false)}
          onCreateProject={handleCreateProject}
        />
      )}
      {showCreateTask && (
        <CreateTaskModal
          projects={projects}
          activeProject={activeProject}
          onClose={() => setShowCreateTask(false)}
          onCreateTask={handleCreateTask}
          tasks={tasks}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        projects={projects}
        onSetActiveProject={setActiveProject}
        onChangeView={handleChangeView}
        onSetFilterType={setFilterType}
        onSetFilterPriority={setFilterPriority}
        onSetFilterAssignee={setFilterAssignee}
        onSetFilterToday={setFilterToday}
        onSetFilterStale={setFilterStale}
        onResetFilters={resetAllFilters}
        onSetTheme={setTheme}
        onCreateProject={() => setShowCreateProject(true)}
        onCreateTask={() => setShowCreateTask(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenHelp={() => setShowHelp(true)}
        onLogout={handleLogout}
      />
      {showArchived && (
        <ArchivedProjectsModal
          archivedProjects={archivedProjects}
          onClose={() => setShowArchived(false)}
          onUnarchiveProject={handleUnarchiveProject}
        />
      )}
      {/* First-run setup (feat-first-run-setup-001). Opens itself on a fresh
          install; the terminal step hands off to the global shell above and
          detects the Claude Code login by polling. */}
      {showSetupWizard && (
        <Suspense fallback={null}>
          <SetupWizard
            onClose={() => setShowSetupWizard(false)}
            onOpenTerminal={() => setShowGlobalShell(true)}
          />
        </Suspense>
      )}
      {showPreview && (
        <PreviewPanel
          services={previewServices}
          onClose={() => setShowPreview(false)}
          socket={socketRef?.current}
          activeProject={activeProject}
        />
      )}

      {/* Floating Preview button — bottom-LEFT FAB (see the anchor comment
          below for why it moved off the right).
          Only renders when the active project has at least one service
          registered in services.json — avoids showing a dead affordance on
          projects that don't have a dev server to preview. Also hidden while
          the PreviewPanel itself is open. It is NOT hidden when a task is
          open; that suppression existed only to dodge the right-hand column
          and is no longer needed. */}
      {(() => {
        const projectServices = previewServices.filter((s) => s.group === activeProject)
        const runningCount = projectServices.filter((s) => s.status === 'running').length
        // Previously also hid on `detailOpen`, because the button was pinned to
        // the VIEWPORT's bottom-right and would have sat on top of the detail
        // pane. Now that it is anchored bottom-LEFT it never overlaps the pane,
        // so it can stay reachable while a task is open.
        const shouldShow = projectServices.length > 0 && !showPreview
        if (!shouldShow) return null
        return (
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="apple-press"
          title={runningCount > 0
            ? `Preview (${runningCount} running)`
            : 'Preview services'}
          aria-label="Preview services"
          style={{
            position: 'fixed',
            // Bottom-LEFT, not bottom-right. The right corner is contested:
            // GraphView renders its own zoom controls at
            // `absolute; right/bottom: var(--space-3)` inside the focal area,
            // so a viewport-pinned button landed on top of them. The detail
            // pane also occupies the right column when a task is open.
            // The left corner is unclaimed in every view.
            left: 'calc(var(--space-4) + env(safe-area-inset-left, 0px))',
            bottom: 'calc(var(--space-4) + env(safe-area-inset-bottom, 0px))',
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-full)',
            background: 'var(--bg-card)',
            color: 'var(--text-app)',
            border: 'var(--border-hairline)',
            boxShadow: 'var(--shadow-popover)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 30,
          }}
        >
          <Eye className="w-[18px] h-[18px]" />
        </button>
        )
      })()}

      {/* Design Studio — parked (Q9): mounts only when its localStorage flag
          was set at load time; closing parks it until the next reload. */}
      {showDesignStudio && (
        <Suspense fallback={null}>
          <DesignStudio
            services={previewServices}
            onClose={() => setShowDesignStudio(false)}
            activeProject={activeProject}
            user={user}
            socket={socketRef?.current}
          />
        </Suspense>
      )}

      {/* Dev kitchen sink (Ctrl+Shift+K) */}
      {KitchenSink && showKitchenSink && (
        <Suspense fallback={null}>
          <KitchenSink onClose={() => setShowKitchenSink(false)} currentTheme={theme} onSetTheme={setTheme} />
        </Suspense>
      )}

      {/* Chat toasts — new-message previews while the chat dock is closed;
          clicking one opens the dock (and hands it over from the shell). */}
      <ChatNotification
        toasts={chat.toastQueue}
        onDismiss={chat.dismissToast}
        onOpenChat={() => { setShowGlobalShell(false); chat.openChat() }}
      />
      <UndoToast
        message={undoRedo.undoToast}
        canUndo={undoRedo.canUndo}
        canRedo={undoRedo.canRedo}
        onUndo={undoRedo.undo}
        onRedo={undoRedo.redo}
        onDismiss={undoRedo.clearToast}
      />
      <ErrorToast message={errorToast} onDismiss={() => setErrorToast(null)} />

      {/* Mobile bottom tab bar — the .app-shell height carve-out in index.css
          reserves its 56px below the breakpoint. */}
      {narrow && (
        <MobileTabBar
          activeView={activeView}
          onChangeView={handleChangeView}
          onCreateTask={() => setShowCreateTask(true)}
          onToggleChat={() => { setShowGlobalShell(false); chat.handleToggleChat() }}
          chatUnread={chat.chatUnread}
          chatOpen={chatOpen}
          onToggleGlobalShell={() => setShowGlobalShell(v => !v)}
          globalShellOpen={showGlobalShell}
        />
      )}
    </div>
  )
}
