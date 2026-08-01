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

import { Terminal, Plus, HelpCircle } from 'lucide-react'
import { Button, IconButton } from '../ui'
import ViewSwitcher from '../ViewSwitcher'
import ProjectAnchor from './ProjectAnchor'
import AvatarPopover from './AvatarPopover'

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

      {/* Center — view switcher */}
      <div className="flex items-center">
        <ViewSwitcher activeView={activeView} onChangeView={onChangeView} />
      </div>

      {/* Right — create + help + global shell trigger + avatar popover */}
      <div className="flex items-center gap-2">
        {onCreateTask && (
          <Button
            variant="primary"
            size="sm"
            onClick={onCreateTask}
            data-testid="topbar-new-task"
            title="Create a task"
          >
            <Plus className="w-3.5 h-3.5" /> New Task
          </Button>
        )}
        {onOpenHelp && (
          <IconButton
            size="sm"
            onClick={onOpenHelp}
            aria-label="Help"
            title="Help (?)"
            data-testid="topbar-help"
          >
            <HelpCircle className="w-3.5 h-3.5" />
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
