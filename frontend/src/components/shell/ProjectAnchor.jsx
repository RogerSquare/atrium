// Facelift TopBar — ProjectAnchor.
//
// Replaces the left-sidebar project list. Click the anchor to open a
// searchable combobox of projects + "Unassigned" + an archived shortcut.
// Cmd+P opens it from anywhere.

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Folder, Archive, Plus, Search, LayoutGrid } from 'lucide-react'
import { IconButton, Avatar } from '../ui'

export default function ProjectAnchor({
  projects,
  tasks,
  activeProject,
  onSetActiveProject,
  onCreateProject,
  onOpenArchived,
  onArchiveProject,
  archivedCount,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const inputRef = useRef(null)

  // Cmd+P / Ctrl+P opens the anchor
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p' && !e.shiftKey) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
  const displayName = activeProject === 'Root'
    ? 'Unassigned'
    : (!activeProject || activeProject === 'All') ? 'All projects' : activeProject

  const filtered = projects.filter((p) => {
    const folder = p.folder || p
    const name = p.name || p
    const display = folder === 'Root' ? 'Unassigned' : name
    return display.toLowerCase().includes(query.toLowerCase())
  })

  const select = (folder) => {
    onSetActiveProject(folder)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
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
            maxHeight: '480px',
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
                the searchable rows so it is always reachable. */}
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
              const display = folder === 'Root' ? 'Unassigned' : name
              const isActive = activeProject === folder
              const count = tasks?.filter((t) => t.project === folder).length ?? 0
              // Root cannot be archived per backend rules; non-Root only.
              const canArchive = folder !== 'Root' && !!onArchiveProject
              return (
                <li key={folder} className="relative group">
                  <button
                    role="option"
                    aria-selected={isActive}
                    onClick={() => select(folder)}
                    className="apple-press w-full flex items-center gap-2 text-left"
                    style={{
                      padding: 'var(--space-2)',
                      paddingRight: canArchive ? 'calc(var(--space-2) + 28px)' : 'var(--space-2)',
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
                  {canArchive && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpen(false)
                        onArchiveProject(folder, display)
                      }}
                      className="apple-press opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                      title={`Archive "${display}"`}
                      aria-label={`Archive "${display}"`}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        right: 'var(--space-1)',
                        transform: 'translateY(-50%)',
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
                      }}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
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
