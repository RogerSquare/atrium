// Facelift TopBar — Phase 2 placeholder.
//
// Phase 2 ships the skeleton (brand + view switcher). Phase 4 replaces this
// with the real project-anchor combobox + filter bar + avatar popover +
// conditional preview icon. Keep this file dumb — it's just layout slots.

import ViewSwitcher from '../ViewSwitcher'

export default function TopBar({ activeView, onChangeView, user }) {
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
      <div className="flex items-center gap-3">
        <img src="/favicon.svg" alt="Atrium" style={{ width: '24px', height: '24px' }} />
        <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', letterSpacing: 'var(--tracking-tight)' }}>
          Atrium
        </span>
        {/* Phase 4 inserts project-anchor combobox here */}
      </div>

      <div className="flex items-center gap-2">
        <ViewSwitcher activeView={activeView} onChangeView={onChangeView} />
        {/* Phase 4 inserts avatar-popover here; for now just show username */}
        {user?.username && (
          <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', padding: '0 var(--space-2)' }}>
            {user.username}
          </span>
        )}
      </div>
    </header>
  )
}
