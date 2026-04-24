import { memo } from 'react'
import { LayoutGrid, List, GitCommitHorizontal, Share2 } from 'lucide-react'

const VIEWS = [
  { id: 'board', label: 'Board', icon: LayoutGrid },
  { id: 'list', label: 'List', icon: List },
  { id: 'changes', label: 'Changes', icon: GitCommitHorizontal },
  { id: 'graph', label: 'Graph', icon: Share2 },
]

function ViewSwitcher({ activeView, onChangeView }) {
  return (
    <div
      className="flex items-center gap-0.5"
      style={{ padding: '3px', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}
    >
      {VIEWS.map(({ id, label, icon: Icon }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            onClick={() => onChangeView(id)}
            className="apple-segment apple-press flex items-center gap-1.5"
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-caption2)',
              fontWeight: 'var(--font-medium)',
              color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
              background: isActive ? 'var(--bg-card)' : 'transparent',
            }}
            title={`${label} view`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

export default memo(ViewSwitcher)
