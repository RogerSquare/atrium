// Facelift FilterBar.
//
// Full-width strip of filter pills. Pre-locked decision #5: the bar stays
// always-visible even when the detail pane is open, so filters remain
// accessible during task review.

import { UserCircle2, Clock, AlertCircle, X, Search } from 'lucide-react'
import { Button } from '../ui'

const TYPE_OPTIONS = ['all', 'frontend', 'backend', 'fullstack', 'devops']
const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export default function FilterBar({
  searchQuery, setSearchQuery,
  filterType, setFilterType,
  filterPriority, setFilterPriority,
  filterAssignee, setFilterAssignee,
  filterToday, setFilterToday,
  filterStale, setFilterStale,
  uniqueAssignees = [],
  activeFilterCount = 0,
  resetAllFilters,
  filteredCount = 0,
  totalCount = 0,
}) {
  return (
    <div
      className="shrink-0 flex items-center flex-wrap"
      style={{
        gridArea: 'filterbar',
        gap: 'var(--space-2)',
        padding: '0 var(--space-3)',
        borderBottom: 'var(--border-hairline)',
        background: 'var(--bg-app)',
        height: '40px',
      }}
    >
      {/* Search */}
      <div className="relative" style={{ minWidth: '220px', flex: '1 1 240px', maxWidth: '360px' }}>
        <Search
          className="absolute w-3.5 h-3.5"
          style={{ left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
        />
        <input
          type="text"
          placeholder="Search tasks…"
          value={searchQuery || ''}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="facelift-pill"
          style={{
            width: '100%',
            padding: '0 var(--space-2) 0 calc(var(--space-2) + 20px)',
            borderRadius: 'var(--radius-sm)',
            border: 'var(--border-hairline)',
            background: 'var(--bg-card)',
            color: 'var(--text-app)',
            fontSize: 'var(--text-caption1)',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="apple-press absolute"
            style={{
              right: 'var(--space-1)',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: 'var(--space-1)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
            }}
            aria-label="Clear search"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Type */}
      <select
        value={filterType}
        onChange={(e) => setFilterType(e.target.value)}
        className="facelift-pill"
        style={{
          padding: '0 var(--space-2)',
          borderRadius: 'var(--radius-sm)',
          border: 'var(--border-hairline)',
          background: filterType !== 'all' ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : 'var(--bg-card)',
          color: filterType !== 'all' ? 'var(--accent-app)' : 'var(--text-muted)',
          fontSize: 'var(--text-caption1)',
          fontWeight: 'var(--font-medium)',
          textTransform: 'capitalize',
          cursor: 'pointer',
        }}
      >
        {TYPE_OPTIONS.map((t) => (
          <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
        ))}
      </select>

      {/* Priority */}
      <select
        value={filterPriority}
        onChange={(e) => setFilterPriority(e.target.value)}
        className="facelift-pill"
        style={{
          padding: '0 var(--space-2)',
          borderRadius: 'var(--radius-sm)',
          border: 'var(--border-hairline)',
          background: filterPriority !== 'all' ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : 'var(--bg-card)',
          color: filterPriority !== 'all' ? 'var(--accent-app)' : 'var(--text-muted)',
          fontSize: 'var(--text-caption1)',
          fontWeight: 'var(--font-medium)',
          cursor: 'pointer',
        }}
      >
        {PRIORITY_OPTIONS.map((p) => (
          <option key={p.value} value={p.value}>{p.value === 'all' ? 'All priority' : p.label}</option>
        ))}
      </select>

      {/* Assignee */}
      <Button
        variant={filterAssignee === 'mine' ? 'secondary' : 'ghost'}
        pill={false}
        size="sm"
        className="facelift-pill"
        onClick={() => setFilterAssignee(filterAssignee === 'mine' ? 'all' : 'mine')}
      >
        <UserCircle2 className="w-3.5 h-3.5" />
        Mine
      </Button>

      {/* Today */}
      <Button
        variant={filterToday ? 'secondary' : 'ghost'}
        pill={false}
        size="sm"
        className="facelift-pill"
        onClick={() => setFilterToday((v) => !v)}
      >
        <Clock className="w-3.5 h-3.5" />
        Today
      </Button>

      {/* Stale */}
      <Button
        variant={filterStale ? 'secondary' : 'ghost'}
        pill={false}
        size="sm"
        className="facelift-pill"
        onClick={() => setFilterStale((v) => !v)}
        style={{
          color: filterStale ? 'var(--apple-orange)' : undefined,
          background: filterStale ? 'color-mix(in srgb, var(--apple-orange) 10%, transparent)' : undefined,
        }}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        Stale
      </Button>

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Button variant="danger" pill={false} size="sm" className="facelift-pill" onClick={resetAllFilters}>
          <X className="w-3 h-3" />
          Reset ({activeFilterCount})
        </Button>
      )}

      <div className="flex-1" />

      {/* Count */}
      <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
        {filteredCount} of {totalCount}
      </span>
    </div>
  )
}
