// Facelift TopBar — Phase 4.
//
// Left: brand + ProjectAnchor (replaces left-sidebar project list)
// Center: ViewSwitcher (Board / List / Changes)
// Right: Terminal (global shell modal) | AvatarPopover (Theme / Settings / Help / Logout)

import { Terminal } from 'lucide-react'
import { IconButton } from '../ui'
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
  // Global shell modal trigger
  onOpenGlobalShell,
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
        <span
          data-testid="sidebar-task-count"
          style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)' }}
        >
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'}
        </span>
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

      {/* Right — global shell trigger + avatar popover */}
      <div className="flex items-center gap-2">
        <IconButton
          size="sm"
          onClick={onOpenGlobalShell}
          aria-label="Open shell"
          title="Open shell"
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
