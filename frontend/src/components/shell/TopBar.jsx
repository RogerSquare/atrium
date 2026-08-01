// Facelift TopBar — Phase 4.
//
// Left: brand + ProjectAnchor (replaces left-sidebar project list)
// Center: ViewSwitcher (Board / List / Changes)
// Right: New Task | Help | Terminal (global shell modal) | AvatarPopover
//
// "New Task" and "Help" are ui-topbar-create-001 (usability P0-1 / P1-14):
// before them the ONLY create path was the command palette and the only help
// affordances were the `?` shortcut and a buried avatar-menu row — a first
// session had no visible way to do the product's core action.

import { Terminal, Plus, HelpCircle, MessageCircle } from 'lucide-react'
import { Button, IconButton } from '../ui'
import ViewSwitcher from '../ViewSwitcher'
import ProjectAnchor from './ProjectAnchor'
import AvatarPopover from './AvatarPopover'
import ApprovalsBell from './ApprovalsBell'

export default function TopBar({
  user,
  theme,
  onSetTheme,
  onLogout,
  activeView,
  onChangeView,
  // Project anchor
  projects,
  tasks,
  activeProject,
  onSetActiveProject,
  onCreateProject,
  onOpenArchived,
  onArchiveProject,
  archivedCount,
  // Avatar popover
  onOpenSettings,
  onOpenHelp,
  // Primary create action — opens the shell-mounted CreateTaskModal.
  onCreateTask,
  // Approvals inbox — opens a waiting_input task in the DetailPane.
  onSelectTask,
  // Team chat dock (ui-shell-consolidation-001) — toggles like the shell.
  onToggleChat,
  chatUnread = 0,
  chatOpen = false,
  // Global shell dock — toggles, so the same button that opened it closes it.
  onToggleGlobalShell,
  globalShellOpen = false,
}) {
  return (
    <header
      className="shrink-0 flex items-center justify-between"
      style={{
        gridArea: 'topbar',
        height: '48px',
        padding: '0 var(--space-3)',
        borderBottom: 'var(--border-hairline)',
        background: 'var(--bg-card)',
      }}
    >
      {/* Left — brand + project anchor */}
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="Atrium" style={{ width: '20px', height: '20px' }} />
        <ProjectAnchor
          projects={projects}
          tasks={tasks}
          activeProject={activeProject}
          onSetActiveProject={onSetActiveProject}
          onCreateProject={onCreateProject}
          onOpenArchived={onOpenArchived}
          onArchiveProject={onArchiveProject}
          archivedCount={archivedCount}
        />
      </div>

      {/* Center — view switcher. Hidden on mobile: the bottom tab bar owns
          view switching there (ui-mobile-appshell-001). */}
      <div className="hidden md:flex items-center">
        <ViewSwitcher activeView={activeView} onChangeView={onChangeView} />
      </div>

      {/* Right — create + help + global shell trigger + avatar popover.
          On mobile only the bell + avatar remain: New Task / Chat / Shell
          move to the bottom tab bar, Help lives in the avatar menu. */}
      <div className="flex items-center gap-2">
        {onCreateTask && (
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateTask}
            data-testid="topbar-new-task"
            title="Create a task"
            className="hidden md:flex"
          >
            <Plus className="w-3.5 h-3.5" /> New Task
          </Button>
        )}
        <ApprovalsBell tasks={tasks} onSelectTask={onSelectTask} />
        {onOpenHelp && (
          <IconButton
            size="sm"
            onClick={onOpenHelp}
            aria-label="Help"
            title="Help (?)"
            data-testid="topbar-help"
            className="hidden md:flex"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </IconButton>
        )}
        {onToggleChat && (
          <IconButton
            size="sm"
            onClick={onToggleChat}
            aria-label={chatOpen ? 'Close chat' : 'Open chat'}
            aria-pressed={chatOpen}
            title={chatOpen ? 'Close chat' : 'Team chat'}
            data-testid="topbar-chat"
            color={chatOpen ? 'var(--accent-app)' : undefined}
            className="hidden md:flex"
            style={chatOpen
              ? { background: 'var(--fill-quaternary, rgba(127,127,127,0.14))', position: 'relative' }
              : { position: 'relative' }}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {chatUnread > 0 && (
              <span
                data-testid="topbar-chat-unread"
                style={{
                  position: 'absolute', top: 0, right: 0,
                  minWidth: 14, height: 14, padding: '0 3px',
                  borderRadius: 'var(--radius-full)',
                  background: 'var(--apple-red)', color: '#fff',
                  fontSize: '9px', fontWeight: 'var(--font-bold)',
                  lineHeight: '14px', textAlign: 'center',
                }}
              >
                {chatUnread}
              </span>
            )}
          </IconButton>
        )}
        {/* Toggle, not a one-way open. aria-pressed states that contract for
            assistive tech, and the tint gives the same signal visually —
            without it nothing indicates the dock is already showing the
            shell, which is what made the button feel like it "only opens". */}
        <IconButton
          size="sm"
          onClick={onToggleGlobalShell}
          aria-label={globalShellOpen ? 'Close shell' : 'Open shell'}
          aria-pressed={globalShellOpen}
          title={globalShellOpen ? 'Close shell' : 'Open shell'}
          color={globalShellOpen ? 'var(--accent-app)' : undefined}
          className="hidden md:flex"
          style={globalShellOpen
            ? { background: 'var(--fill-quaternary, rgba(127,127,127,0.14))' }
            : undefined}
        >
          <Terminal className="w-3.5 h-3.5" />
        </IconButton>
        <AvatarPopover
          user={user}
          theme={theme}
          onSetTheme={onSetTheme}
          onOpenSettings={onOpenSettings}
          onOpenHelp={onOpenHelp}
          onLogout={onLogout}
        />
      </div>
    </header>
  )
}
