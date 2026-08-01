// Mobile bottom tab bar (ui-mobile-appshell-001, usability P0-6).
//
// The legacy shell's mobile pattern, adapted to the surviving AppShell. The
// legacy DRAWER is deliberately NOT ported: it existed to reach the old
// sidebar (projects + filters), and both already live in mobile-reachable
// surfaces here — ProjectAnchor stays in the TopBar and FilterBar scrolls.
// What phones actually lacked was view switching and the primary actions,
// which is exactly what a thumb-reach tab bar is for.
//
// Renders only below MOBILE_BREAKPOINT (the parent gates on `narrow`).

import { Columns3, List, GitCommitHorizontal, Plus, MessageCircle, Terminal } from 'lucide-react'

const VIEW_CYCLE = ['board', 'list', 'changes']
const VIEW_META = {
  board: { icon: Columns3, label: 'Board' },
  list: { icon: List, label: 'List' },
  changes: { icon: GitCommitHorizontal, label: 'Changes' },
}

export default function MobileTabBar({
  activeView,
  onChangeView,
  onCreateTask,
  onToggleChat,
  chatUnread = 0,
  chatOpen = false,
  onToggleGlobalShell,
  globalShellOpen = false,
}) {
  const viewMeta = VIEW_META[activeView] || VIEW_META.board
  const ViewIcon = viewMeta.icon
  const nextView = VIEW_CYCLE[(VIEW_CYCLE.indexOf(activeView) + 1) % VIEW_CYCLE.length] || 'board'

  const tabs = [
    {
      key: 'view',
      icon: ViewIcon,
      label: viewMeta.label,
      active: true,
      onClick: () => onChangeView(nextView),
      title: `Switch view (next: ${VIEW_META[nextView].label})`,
    },
    { key: 'new', icon: Plus, label: 'New', active: false, onClick: onCreateTask, title: 'New task' },
    { key: 'chat', icon: MessageCircle, label: 'Chat', active: chatOpen, onClick: onToggleChat, badge: chatUnread, title: 'Team chat' },
    { key: 'shell', icon: Terminal, label: 'Shell', active: globalShellOpen, onClick: onToggleGlobalShell, title: 'Global shell' },
  ]

  return (
    <nav
      data-testid="mobile-tab-bar"
      className="fixed bottom-0 left-0 right-0 z-40 flex items-end justify-around vibrancy-thick mobile-tab-bar"
    >
      {tabs.map(({ key, icon: Icon, label, active, onClick, badge, title }) => (
        <button
          key={key}
          onClick={onClick}
          className="flex flex-col items-center gap-0.5 px-3 py-1 apple-press relative"
          style={{ minWidth: '56px', background: 'transparent', border: 'none', cursor: 'pointer' }}
          title={title}
          aria-label={title}
          data-testid={`mobile-tab-${key}`}
        >
          <Icon className="w-[22px] h-[22px]" style={{ color: active ? 'var(--accent-app)' : 'var(--gray-1)' }} />
          <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: active ? 'var(--accent-app)' : 'var(--gray-1)' }}>
            {label}
          </span>
          {badge > 0 && (
            <span
              className="absolute top-0 right-1 flex items-center justify-center px-1 text-white"
              style={{ minWidth: '17px', height: '17px', fontSize: '10px', fontWeight: 'var(--font-semibold)', borderRadius: 'var(--radius-full)', background: 'var(--apple-red)' }}
            >
              {badge}
            </span>
          )}
        </button>
      ))}
    </nav>
  )
}
