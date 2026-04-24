// Facelift TopBar — AvatarPopover.
//
// Top-right dropdown: Theme toggle, Settings, Help, Logout.
// Replaces the sidebar bottom rail per plan decision #10.

import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, HelpCircle, LogOut, Sun, Moon } from 'lucide-react'
import { Avatar } from '../ui'

const THEMES = [
  { id: 'auto', label: 'Auto' },
  { id: 'light', label: 'Light' },
  { id: 'oled', label: 'Dark (OLED)' },
  { id: 'paper', label: 'Paper' },
]

export default function AvatarPopover({
  user,
  theme,
  onSetTheme,
  onOpenSettings,
  onOpenHelp,
  onLogout,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="apple-press"
        style={{
          padding: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          borderRadius: 'var(--radius-full)',
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        title={user?.username}
      >
        <Avatar
          size="sm"
          alt={user?.username}
          color="white"
          background="var(--accent-app)"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute z-50"
          style={{
            top: 'calc(100% + var(--space-1))',
            right: 0,
            minWidth: '220px',
            padding: 'var(--space-1)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg-card)',
            border: 'var(--border-hairline)',
            boxShadow: 'var(--shadow-popover)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
          }}
        >
          {/* User header */}
          <div
            style={{
              padding: 'var(--space-2)',
              fontSize: 'var(--text-caption1)',
              color: 'var(--text-muted)',
              borderBottom: 'var(--border-hairline)',
              marginBottom: 'var(--space-1)',
            }}
          >
            Signed in as <strong style={{ color: 'var(--text-app)' }}>{user?.username}</strong>
          </div>

          {/* Theme row */}
          <div
            style={{
              padding: 'var(--space-2)',
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
            }}
          >
            {theme === 'light' || theme === 'paper' ? (
              <Sun className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
            ) : (
              <Moon className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
            )}
            <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>Theme</span>
            <select
              value={theme || 'auto'}
              onChange={(e) => onSetTheme?.(e.target.value)}
              style={{
                marginLeft: 'auto',
                padding: 'var(--space-0) var(--space-1)',
                borderRadius: 'var(--radius-sm)',
                border: 'var(--border-hairline)',
                background: 'var(--bg-card)',
                color: 'var(--text-app)',
                fontSize: 'var(--text-caption2)',
                cursor: 'pointer',
              }}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Actions */}
          <MenuRow
            icon={<SettingsIcon className="w-3.5 h-3.5" />}
            label="Settings"
            onClick={() => { close(); onOpenSettings?.() }}
          />
          <MenuRow
            icon={<HelpCircle className="w-3.5 h-3.5" />}
            label="Help & Usage"
            onClick={() => { close(); onOpenHelp?.() }}
          />
          <MenuRow
            icon={<LogOut className="w-3.5 h-3.5" />}
            label="Log out"
            onClick={() => { close(); onLogout?.() }}
            danger
          />
        </div>
      )}
    </div>
  )
}

function MenuRow({ icon, label, onClick, danger }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="apple-press flex items-center gap-2 text-left"
      style={{
        padding: 'var(--space-2)',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: danger ? 'var(--apple-red)' : 'var(--text-app)',
        fontSize: 'var(--text-caption1)',
      }}
    >
      {icon}
      {label}
    </button>
  )
}
