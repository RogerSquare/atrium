// Facelift TopBar — Phase 4.
//
// Left: brand + ProjectAnchor (replaces left-sidebar project list)
// Center: ViewSwitcher (Board / List / Changes)
// Right: AvatarPopover (Theme / Settings / Help / Logout)

import { Eye } from 'lucide-react'
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
  archivedCount,
  // Avatar popover
  onOpenSettings,
  onOpenHelp,
  // Preview
  onTogglePreview,
  previewOpen,
  previewRunningCount = 0,
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
          archivedCount={archivedCount}
        />
      </div>

      {/* Center — view switcher */}
      <div className="flex items-center">
        <ViewSwitcher activeView={activeView} onChangeView={onChangeView} />
      </div>

      {/* Right — preview toggle + avatar popover */}
      <div className="flex items-center gap-2">
        {onTogglePreview && (
          <button
            type="button"
            onClick={onTogglePreview}
            className="apple-press relative flex items-center justify-center"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: 'var(--radius-sm)',
              background: previewOpen ? 'color-mix(in srgb, var(--accent-app) 14%, transparent)' : 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: previewOpen ? 'var(--accent-app)' : 'var(--text-muted)',
            }}
            title={previewRunningCount > 0
              ? `Preview (${previewRunningCount} running)`
              : 'Preview services'}
            aria-label="Preview services"
            aria-pressed={previewOpen}
          >
            <Eye className="w-4 h-4" />
            {previewRunningCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: 'var(--apple-green)',
                  boxShadow: '0 0 6px var(--apple-green)',
                }}
                className="animate-gentle-pulse"
              />
            )}
          </button>
        )}
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
