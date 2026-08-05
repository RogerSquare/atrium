// Facelift Phase 6 — Command Palette.
//
// Cmd+K / Ctrl+K opens a fuzzy-searchable command palette. All commands
// delegate to callbacks the parent already owns (TaskContext + AuthContext).
// No new backend surface.

import { useEffect } from 'react'
import { Command } from 'cmdk'
import {
  Folder, FolderPlus, Plus, Filter as FilterIcon, UserCircle2, Clock,
  AlertCircle, X, Sun, Moon, Settings as SettingsIcon, HelpCircle,
  LogOut, LayoutGrid, List, GitBranch, Layers,
} from 'lucide-react'
import { motion, AnimatePresence, useMotionTransition, MOTION_DURATIONS } from '../../lib/motion'

const TYPE_OPTIONS = ['frontend', 'backend', 'fullstack', 'devops']
const PRIORITY_OPTIONS = ['high', 'medium', 'low']
const THEME_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'oled', label: 'Dark (OLED)' },
  { id: 'paper', label: 'Paper' },
]

export default function CommandPalette({
  open,
  onOpenChange,
  projects = [],
  workspaces = [],
  activeWorkspace = 'personal',
  onSetActiveWorkspace,
  onSetActiveProject,
  onChangeView,
  onSetFilterType,
  onSetFilterPriority,
  onSetFilterAssignee,
  onSetFilterToday,
  onSetFilterStale,
  onResetFilters,
  onSetTheme,
  onCreateProject,
  onCreateTask,
  onOpenSettings,
  onOpenHelp,
  onLogout,
}) {
  // Cmd+K / Ctrl+K toggles the palette. We still let inputs keep typed Ks,
  // so the only consumer is the global modifier chord.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  const run = (fn) => () => {
    onOpenChange(false)
    fn?.()
  }

  // Escape closes the palette when it's open. (Cmd+K toggle handled above.)
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  const backdropTransition = useMotionTransition({ duration: MOTION_DURATIONS.palette, ease: 'easeOut' })
  const panelTransition = useMotionTransition({ duration: MOTION_DURATIONS.palette, ease: [0.2, 0.8, 0.2, 1] })

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-label="Command palette"
          aria-modal="true"
          onClick={() => onOpenChange(false)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={backdropTransition}
          className="facelift-palette-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: '12vh 16px 16px',
            background: 'color-mix(in srgb, var(--bg-app) 60%, transparent)',
            backdropFilter: 'blur(6px)',
          }}
        >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -8 }}
        transition={panelTransition}
        style={{
          width: '100%',
          maxWidth: '560px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          boxShadow: 'var(--shadow-popover)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <Command label="Command palette" shouldFilter>
        <Command.Input
          placeholder="Type a command or search…"
          style={{
            width: '100%',
            padding: 'var(--space-3)',
            borderBottom: 'var(--border-hairline)',
            background: 'transparent',
            color: 'var(--text-app)',
            fontSize: 'var(--text-body)',
            outline: 'none',
            border: 'none',
            borderRadius: 0,
          }}
        />
        <Command.List
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 'var(--space-1)',
          }}
        >
          <Command.Empty
            style={{
              padding: 'var(--space-3)',
              fontSize: 'var(--text-caption1)',
              color: 'var(--text-tertiary)',
              textAlign: 'center',
            }}
          >
            No commands match.
          </Command.Empty>

          {workspaces.length > 1 && (
            <Group heading="Switch workspace">
              {workspaces.filter((w) => w.id !== activeWorkspace).map((w) => (
                <Item
                  key={`ws-${w.id}`}
                  value={`workspace switch ${w.name}`}
                  onSelect={run(() => onSetActiveWorkspace?.(w.id))}
                  icon={<Layers className="w-3.5 h-3.5" />}
                  label={`Workspace: ${w.name}`}
                />
              ))}
            </Group>
          )}

          <Group heading="Go to project">
            {projects.map((p) => {
              const folder = p.folder || p
              const label = folder === 'Root' ? 'Unassigned' : folder
              return (
                <Item
                  key={`proj-${folder}`}
                  value={`go ${label} ${folder}`}
                  onSelect={run(() => onSetActiveProject?.(folder))}
                  icon={<Folder className="w-3.5 h-3.5" />}
                  label={label}
                />
              )
            })}
          </Group>

          <Group heading="View">
            <Item value="view board" onSelect={run(() => onChangeView?.('board'))} icon={<LayoutGrid className="w-3.5 h-3.5" />} label="Switch to Board" />
            <Item value="view list" onSelect={run(() => onChangeView?.('list'))} icon={<List className="w-3.5 h-3.5" />} label="Switch to List" />
            <Item value="view changes" onSelect={run(() => onChangeView?.('changes'))} icon={<GitBranch className="w-3.5 h-3.5" />} label="Switch to Changes" />
          </Group>

          <Group heading="Create">
            <Item value="create project new" onSelect={run(onCreateProject)} icon={<FolderPlus className="w-3.5 h-3.5" />} label="New project…" />
            <Item value="create task new" onSelect={run(onCreateTask)} icon={<Plus className="w-3.5 h-3.5" />} label="New task…" />
          </Group>

          <Group heading="Filter">
            {TYPE_OPTIONS.map((t) => (
              <Item
                key={`ftype-${t}`}
                value={`filter type ${t}`}
                onSelect={run(() => onSetFilterType?.(t))}
                icon={<FilterIcon className="w-3.5 h-3.5" />}
                label={`Type: ${t}`}
              />
            ))}
            {PRIORITY_OPTIONS.map((p) => (
              <Item
                key={`fpri-${p}`}
                value={`filter priority ${p}`}
                onSelect={run(() => onSetFilterPriority?.(p))}
                icon={<FilterIcon className="w-3.5 h-3.5" />}
                label={`Priority: ${p}`}
              />
            ))}
            <Item value="filter mine only" onSelect={run(() => onSetFilterAssignee?.('mine'))} icon={<UserCircle2 className="w-3.5 h-3.5" />} label="Filter: Mine only" />
            <Item value="filter today due" onSelect={run(() => onSetFilterToday?.(true))} icon={<Clock className="w-3.5 h-3.5" />} label="Filter: Due today" />
            <Item value="filter stale" onSelect={run(() => onSetFilterStale?.(true))} icon={<AlertCircle className="w-3.5 h-3.5" />} label="Filter: Stale" />
            <Item value="filter reset clear" onSelect={run(onResetFilters)} icon={<X className="w-3.5 h-3.5" />} label="Reset all filters" />
          </Group>

          <Group heading="Theme">
            {THEME_OPTIONS.map((t) => (
              <Item
                key={`theme-${t.id}`}
                value={`theme ${t.id} ${t.label}`}
                onSelect={run(() => onSetTheme?.(t.id))}
                icon={t.id === 'light' || t.id === 'paper' ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                label={`Theme: ${t.label}`}
              />
            ))}
          </Group>

          <Group heading="Settings">
            <Item value="settings open" onSelect={run(onOpenSettings)} icon={<SettingsIcon className="w-3.5 h-3.5" />} label="Open settings" />
            <Item value="help open usage" onSelect={run(onOpenHelp)} icon={<HelpCircle className="w-3.5 h-3.5" />} label="Open help & usage" />
            <Item value="logout sign out" onSelect={run(onLogout)} icon={<LogOut className="w-3.5 h-3.5" />} label="Log out" danger />
          </Group>
        </Command.List>
        </Command>
      </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Group({ heading, children }) {
  return (
    <Command.Group
      heading={heading}
      style={{
        fontSize: 'var(--text-caption2)',
        color: 'var(--text-tertiary)',
      }}
    >
      {children}
    </Command.Group>
  )
}

function Item({ value, onSelect, icon, label, danger }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        color: danger ? 'var(--apple-red)' : 'var(--text-app)',
        fontSize: 'var(--text-caption1)',
        cursor: 'pointer',
      }}
    >
      <span style={{ color: danger ? 'var(--apple-red)' : 'var(--text-tertiary)', display: 'flex' }}>{icon}</span>
      {label}
    </Command.Item>
  )
}
