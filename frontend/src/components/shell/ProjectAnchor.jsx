// Facelift TopBar — ProjectAnchor.
//
// Replaces the left-sidebar project list. Click the anchor to open a
// searchable combobox of projects + "Unassigned" + an archived shortcut.
// Cmd+P opens it from anywhere.
//
// Workspaces (feat-workspaces-impl-001): the popover's header row is the
// workspace switcher — workspaces ISOLATE, so flipping one swaps the whole
// project list below it. Management (create/rename/delete) lives inline in
// the expanded workspace panel; per-project rows gain a "move to workspace"
// hover action beside Archive.

import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown, Folder, Archive, Plus, Search, LayoutGrid,
  Layers, Pencil, Trash2, FolderInput, Check,
} from 'lucide-react'
import { IconButton } from '../ui'

export default function ProjectAnchor({
  projects,
  tasks,
  activeProject,
  onSetActiveProject,
  onCreateProject,
  onOpenArchived,
  onArchiveProject,
  archivedCount,
  // Workspaces
  workspaces = [],
  activeWorkspace = 'personal',
  allProjects = [],
  onSetActiveWorkspace,
  onCreateWorkspace,
  onRenameWorkspace,
  onDeleteWorkspace,
  onAssignProjectWorkspace,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  // Workspace panel state — all transient, reset when the popover closes.
  const [wsOpen, setWsOpen] = useState(false)
  const [wsCreating, setWsCreating] = useState(false)
  const [wsCreateName, setWsCreateName] = useState('')
  const [wsRenamingId, setWsRenamingId] = useState(null)
  const [wsRenameValue, setWsRenameValue] = useState('')
  const [moveFor, setMoveFor] = useState(null) // project folder with the move submenu open
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // Workspace-panel state is per-visit: reset alongside every open/close
  // toggle (an unmount-style reset effect would set state synchronously
  // inside an effect, which the hooks lint rightly flags).
  const resetWorkspacePanel = () => {
    setWsOpen(false)
    setWsCreating(false)
    setWsCreateName('')
    setWsRenamingId(null)
    setMoveFor(null)
  }
  const toggleOpen = () => {
    resetWorkspacePanel()
    setOpen((v) => !v)
  }

  // Cmd+P / Ctrl+P opens the anchor
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault()
        toggleOpen()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Click-outside to close
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  // 'All' is the default activeProject sentinel — show it as "All projects"
  // rather than a bare "All" (ui-topbar-create-001; the old `|| 'All projects'`
  // fallback was dead code because 'All' is truthy).
  // "No project", not "Unassigned" — that word belongs to the assignee filter
  // (ui-copy-glossary-001, UBIQUITOUS_LANGUAGE overload).
  const displayName = activeProject === 'Root'
    ? 'No project'
    : (!activeProject || activeProject === 'All') ? 'All projects' : activeProject

  const filtered = projects.filter((p) => {
    const folder = p.folder || p
    const name = p.name || p
    const display = folder === 'Root' ? 'No project' : name
    return display.toLowerCase().includes(query.toLowerCase())
  })

  const select = (folder) => {
    onSetActiveProject(folder)
    setOpen(false)
    setQuery('')
  }

  const activeWs = workspaces.find((w) => w.id === activeWorkspace)
  const wsProjectCount = (wsId) =>
    allProjects.filter((p) => p.id !== 'root' && (p.workspace || 'personal') === wsId).length

  const submitCreateWorkspace = async () => {
    const name = wsCreateName.trim()
    if (!name) return
    const result = await onCreateWorkspace?.(name)
    if (result?.ok) {
      setWsCreating(false)
      setWsCreateName('')
    }
  }

  const submitRenameWorkspace = async (id) => {
    const name = wsRenameValue.trim()
    if (!name) { setWsRenamingId(null); return }
    await onRenameWorkspace?.(id, name)
    setWsRenamingId(null)
  }

  const hoverAction = {
    width: 22,
    height: 22,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-tertiary)',
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggleOpen}
        className="apple-press flex items-center gap-2 facelift-pill"
        style={{
          padding: '0 var(--space-2)',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-app)',
          cursor: 'pointer',
          fontSize: 'var(--text-footnote)',
          fontWeight: 'var(--font-semibold)',
        }}
        title="Switch project (Cmd+P)"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Folder className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
        <span className="truncate" style={{ maxWidth: '200px' }}>{displayName}</span>
        <ChevronDown className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50"
          style={{
            top: 'calc(100% + var(--space-1))',
            left: 0,
            minWidth: '280px',
            maxHeight: '520px',
            padding: 'var(--space-2)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            boxShadow: 'var(--shadow-popover)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          {/* Workspace switcher — the isolation boundary above projects. */}
          <div
            className="shrink-0"
            style={{ borderBottom: 'var(--border-hairline)', paddingBottom: 'var(--space-1)' }}
          >
            <button
              data-testid="workspace-switcher"
              onClick={() => setWsOpen((v) => !v)}
              className="apple-press w-full flex items-center gap-2 text-left"
              aria-expanded={wsOpen}
              aria-label={`Workspace: ${activeWs?.name || 'Personal'}`}
              style={{
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-caption1)',
                color: 'var(--text-app)',
              }}
            >
              <Layers className="w-3.5 h-3.5" style={{ color: activeWs?.color || 'var(--accent-app)' }} />
              <span className="truncate flex-1" style={{ fontWeight: 'var(--font-semibold)' }}>
                {activeWs?.name || 'Personal'}
              </span>
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                Workspace
              </span>
              <ChevronDown
                className="w-3 h-3"
                style={{
                  color: 'var(--text-tertiary)',
                  transform: wsOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 120ms ease',
                }}
              />
            </button>

            {wsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {workspaces.map((ws) => {
                  const isActive = ws.id === activeWorkspace
                  const renaming = wsRenamingId === ws.id
                  return (
                    <div key={ws.id} className="relative group">
                      {renaming ? (
                        <input
                          autoFocus
                          value={wsRenameValue}
                          onChange={(e) => setWsRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRenameWorkspace(ws.id)
                            if (e.key === 'Escape') setWsRenamingId(null)
                          }}
                          onBlur={() => submitRenameWorkspace(ws.id)}
                          style={{
                            width: '100%',
                            padding: 'var(--space-2)',
                            borderRadius: 'var(--radius-sm)',
                            border: 'var(--border-hairline)',
                            background: 'var(--bg-card)',
                            color: 'var(--text-app)',
                            fontSize: 'var(--text-caption1)',
                          }}
                        />
                      ) : (
                        <>
                          <button
                            data-testid={`workspace-row-${ws.id}`}
                            onClick={() => { onSetActiveWorkspace?.(ws.id); setWsOpen(false) }}
                            className="apple-press w-full flex items-center gap-2 text-left"
                            style={{
                              padding: 'var(--space-2)',
                              paddingRight: 'calc(var(--space-2) + 52px)',
                              borderRadius: 'var(--radius-sm)',
                              background: isActive ? 'var(--fill-secondary)' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: 'var(--text-caption1)',
                              color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                            }}
                          >
                            <span
                              aria-hidden
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: ws.color || 'var(--accent-app)',
                                flexShrink: 0,
                              }}
                            />
                            <span className="truncate flex-1">{ws.name}</span>
                            {isActive && <Check className="w-3 h-3" style={{ color: 'var(--accent-app)' }} />}
                            <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                              {wsProjectCount(ws.id)}
                            </span>
                          </button>
                          <div
                            className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center"
                            style={{ position: 'absolute', top: '50%', right: 'var(--space-1)', transform: 'translateY(-50%)' }}
                          >
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setWsRenamingId(ws.id)
                                setWsRenameValue(ws.name)
                              }}
                              className="apple-press"
                              title={`Rename "${ws.name}"`}
                              aria-label={`Rename "${ws.name}"`}
                              style={hoverAction}
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            {ws.id !== 'personal' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteWorkspace?.(ws.id) }}
                                className="apple-press"
                                title={`Delete "${ws.name}"`}
                                aria-label={`Delete "${ws.name}"`}
                                style={hoverAction}
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}

                {wsCreating ? (
                  <input
                    autoFocus
                    data-testid="workspace-create-input"
                    placeholder="Workspace name…"
                    value={wsCreateName}
                    onChange={(e) => setWsCreateName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitCreateWorkspace()
                      if (e.key === 'Escape') { setWsCreating(false); setWsCreateName('') }
                    }}
                    style={{
                      width: '100%',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      border: 'var(--border-hairline)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-app)',
                      fontSize: 'var(--text-caption1)',
                    }}
                  />
                ) : (
                  <button
                    data-testid="workspace-create"
                    onClick={() => setWsCreating(true)}
                    className="apple-press w-full flex items-center gap-2 text-left"
                    style={{
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-tertiary)',
                      fontSize: 'var(--text-caption1)',
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New workspace
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Search */}
          <div className="relative shrink-0">
            <Search
              className="absolute w-3.5 h-3.5"
              style={{ left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
            />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search projects…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
              style={{
                width: '100%',
                padding: 'var(--space-1) var(--space-2) var(--space-1) calc(var(--space-2) + 20px)',
                borderRadius: 'var(--radius-sm)',
                border: 'var(--border-hairline)',
                background: 'var(--bg-card)',
                color: 'var(--text-app)',
                fontSize: 'var(--text-caption1)',
              }}
            />
          </div>

          {/* Project list */}
          <ul
            role="none"
            className="overflow-y-auto custom-scrollbar"
            style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '320px' }}
          >
            {/* Pinned "All projects" — the default scope used to be a one-way
                trap: once a project was picked, nothing in this list led back
                to 'All' (ui-topbar-create-001, usability P0-3). Pinned above
                the searchable rows so it is always reachable. Under workspace
                isolation "All" means all of THIS workspace's projects. */}
            <li>
              <button
                role="option"
                aria-selected={!activeProject || activeProject === 'All'}
                data-testid="project-anchor-all"
                onClick={() => select('All')}
                className="apple-press w-full flex items-center gap-2 text-left"
                style={{
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background: (!activeProject || activeProject === 'All') ? 'var(--fill-secondary)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 'var(--text-caption1)',
                  color: (!activeProject || activeProject === 'All') ? 'var(--text-app)' : 'var(--text-muted)',
                }}
              >
                <LayoutGrid className="w-3.5 h-3.5" style={{ color: (!activeProject || activeProject === 'All') ? 'var(--accent-app)' : 'var(--text-tertiary)' }} />
                <span className="truncate flex-1">All projects</span>
                <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {tasks?.length ?? 0}
                </span>
              </button>
            </li>
            {filtered.map((proj) => {
              const folder = proj.folder || proj
              const name = proj.name || proj
              const display = folder === 'Root' ? 'No project' : name
              const isActive = activeProject === folder
              const count = tasks?.filter((t) => t.project === folder).length ?? 0
              // Root cannot be archived per backend rules; non-Root only.
              const canArchive = folder !== 'Root' && !!onArchiveProject
              // Root is pinned to the default workspace; moving needs >1 target.
              const canMove = folder !== 'Root' && !!onAssignProjectWorkspace && workspaces.length > 1
              const actionCount = (canArchive ? 1 : 0) + (canMove ? 1 : 0)
              return (
                <li key={folder} className="relative group">
                  <button
                    role="option"
                    aria-selected={isActive}
                    onClick={() => select(folder)}
                    className="apple-press w-full flex items-center gap-2 text-left"
                    style={{
                      padding: 'var(--space-2)',
                      paddingRight: actionCount ? `calc(var(--space-2) + ${actionCount * 26}px)` : 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      background: isActive ? 'var(--fill-secondary)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-caption1)',
                      color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                    }}
                  >
                    <Folder className="w-3.5 h-3.5" style={{ color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)' }} />
                    <span className="truncate flex-1">{display}</span>
                    <span
                      style={{
                        fontSize: 'var(--text-caption2)',
                        color: 'var(--text-tertiary)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                  {actionCount > 0 && (
                    <div
                      className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center"
                      style={{ position: 'absolute', top: '50%', right: 'var(--space-1)', transform: 'translateY(-50%)' }}
                    >
                      {canMove && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setMoveFor((prev) => prev === folder ? null : folder)
                          }}
                          className="apple-press"
                          title={`Move "${display}" to another workspace`}
                          aria-label={`Move "${display}" to another workspace`}
                          style={hoverAction}
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canArchive && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setOpen(false)
                            onArchiveProject(folder, display)
                          }}
                          className="apple-press"
                          title={`Archive "${display}"`}
                          aria-label={`Archive "${display}"`}
                          style={hoverAction}
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  {moveFor === folder && (
                    <div
                      style={{
                        margin: '0 var(--space-2) var(--space-1)',
                        padding: 'var(--space-1)',
                        borderRadius: 'var(--radius-sm)',
                        border: 'var(--border-hairline)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      {workspaces.filter((w) => w.id !== activeWorkspace).map((w) => (
                        <button
                          key={w.id}
                          data-testid={`move-project-to-${w.id}`}
                          onClick={() => {
                            setMoveFor(null)
                            onAssignProjectWorkspace?.(folder, w.id, display)
                          }}
                          className="apple-press w-full flex items-center gap-2 text-left"
                          style={{
                            padding: 'var(--space-1) var(--space-2)',
                            borderRadius: 'var(--radius-sm)',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 'var(--text-caption1)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          <span
                            aria-hidden
                            style={{ width: 8, height: 8, borderRadius: '50%', background: w.color || 'var(--accent-app)', flexShrink: 0 }}
                          />
                          <span className="truncate flex-1">{w.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>

          {/* Footer actions */}
          <div
            className="shrink-0 flex items-center gap-1"
            style={{ paddingTop: 'var(--space-2)', borderTop: 'var(--border-hairline)' }}
          >
            <button
              onClick={() => { setOpen(false); onCreateProject?.() }}
              className="apple-press flex items-center gap-2 flex-1 text-left"
              style={{
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--text-caption1)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              New Project
            </button>
            {archivedCount > 0 && (
              <IconButton
                size="sm"
                onClick={() => { setOpen(false); onOpenArchived?.() }}
                title={`Archived projects (${archivedCount})`}
                aria-label={`Archived projects (${archivedCount})`}
                style={{ color: 'var(--text-tertiary)' }}
              >
                <Archive className="w-4 h-4" />
              </IconButton>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
