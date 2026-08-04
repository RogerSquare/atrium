// Facelift FilterBar.
//
// Full-width strip of filter pills. Pre-locked decision #5: the bar stays
// always-visible even when the detail pane is open, so filters remain
// accessible during task review.

import { useState } from 'react'
import { UserCircle2, Clock, AlertCircle, X, Search, Terminal, SlidersHorizontal } from 'lucide-react'
import { Button, BottomSheet } from '../ui'
import useIsMobile from '../../hooks/useIsMobile'

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
  filterShellActive, setFilterShellActive,
  uniqueAssignees = [],
  activeFilterCount = 0,
  resetAllFilters,
  filteredCount = 0,
  totalCount = 0,
}) {
  const isMobile = useIsMobile()
  const [sheetOpen, setSheetOpen] = useState(false)

  // Mobile: the full pill row was bulky and unreadable on a phone — the bar
  // slims to search + one Filters button (badged with the active count), and
  // every filter control moves into a bottom sheet as 44px rows.
  if (isMobile) {
    const sheetRow = { display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: '44px', width: '100%' }
    const sheetSelect = {
      flex: 1, minHeight: '40px', padding: '0 var(--space-2)', borderRadius: 'var(--radius-sm)',
      border: 'var(--border-hairline)', background: 'var(--bg-card)', color: 'var(--text-app)',
      fontSize: 'var(--text-footnote)',
    }
    const toggleRow = (active, onClick, icon, label, tint) => (
      <button
        onClick={onClick}
        aria-pressed={active}
        className="apple-press flex items-center"
        style={{
          ...sheetRow,
          gap: 'var(--space-2)',
          padding: '0 var(--space-2)',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          cursor: 'pointer',
          background: active ? `color-mix(in srgb, ${tint || 'var(--accent-app)'} 12%, transparent)` : 'transparent',
          color: active ? (tint || 'var(--accent-app)') : 'var(--text-app)',
          fontSize: 'var(--text-footnote)',
          fontWeight: active ? 'var(--font-semibold)' : 'var(--font-regular)',
        }}
      >
        {icon}
        {label}
        <span style={{ flex: 1 }} />
        {active && <span style={{ fontSize: 'var(--text-caption2)' }}>on</span>}
      </button>
    )

    return (
      <div
        className="shrink-0 flex items-center"
        data-testid="filter-bar"
        style={{ gridArea: 'filterbar', gap: 'var(--space-2)', padding: '0 var(--space-3)', borderBottom: 'var(--border-hairline)', background: 'var(--bg-app)', height: '40px' }}
      >
        <div className="relative" style={{ flex: 1, minWidth: 0 }}>
          <Search className="absolute w-3.5 h-3.5" style={{ left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            data-testid="filter-search"
            placeholder="Search tasks…"
            value={searchQuery || ''}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="facelift-pill"
            style={{ width: '100%', padding: '0 var(--space-2) 0 calc(var(--space-2) + 20px)', borderRadius: 'var(--radius-sm)', border: 'var(--border-hairline)', background: 'var(--bg-card)', color: 'var(--text-app)', fontSize: 'var(--text-caption1)' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="apple-press absolute" style={{ right: 'var(--space-1)', top: '50%', transform: 'translateY(-50%)', padding: 'var(--space-1)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }} aria-label="Clear search">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <button
          data-testid="filter-sheet-toggle"
          onClick={() => setSheetOpen(true)}
          aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : 'Filters'}
          className="apple-press relative flex items-center justify-center shrink-0"
          style={{ minWidth: '44px', minHeight: '40px', border: 'none', background: 'transparent', cursor: 'pointer', color: activeFilterCount > 0 ? 'var(--accent-app)' : 'var(--text-muted)' }}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {activeFilterCount > 0 && (
            <span style={{ position: 'absolute', top: '2px', right: '4px', minWidth: '15px', height: '15px', fontSize: '9px', fontWeight: 'var(--font-semibold)', borderRadius: 'var(--radius-full)', background: 'var(--accent-app)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
          {filteredCount}/{totalCount}
        </span>

        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Filters" testid="filter-sheet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ ...sheetRow, fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>
              Type
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ ...sheetSelect, textTransform: 'capitalize' }}>
                {TYPE_OPTIONS.map((t) => (<option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>))}
              </select>
            </label>
            <label style={{ ...sheetRow, fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>
              Priority
              <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} style={sheetSelect}>
                {PRIORITY_OPTIONS.map((p) => (<option key={p.value} value={p.value}>{p.value === 'all' ? 'All priority' : p.label}</option>))}
              </select>
            </label>
            {toggleRow(filterAssignee === 'mine', () => setFilterAssignee(filterAssignee === 'mine' ? 'all' : 'mine'), <UserCircle2 className="w-4 h-4" />, 'Mine')}
            {toggleRow(filterToday, () => setFilterToday((v) => !v), <Clock className="w-4 h-4" />, 'Today')}
            {toggleRow(filterStale, () => setFilterStale((v) => !v), <AlertCircle className="w-4 h-4" />, 'Stale', 'var(--apple-orange)')}
            {toggleRow(filterShellActive, () => setFilterShellActive((v) => !v), <Terminal className="w-4 h-4" />, 'Active shells')}
            {activeFilterCount > 0 && (
              <Button variant="danger" pill={false} size="sm" onClick={() => { resetAllFilters(); setSheetOpen(false) }} style={{ minHeight: '44px', marginTop: 'var(--space-1)' }}>
                <X className="w-3.5 h-3.5" />
                Reset all ({activeFilterCount})
              </Button>
            )}
          </div>
        </BottomSheet>
      </div>
    )
  }

  return (
    <div
      // nowrap + horizontal scroll instead of flex-wrap: the bar lives in a
      // fixed 40px grid row, so wrapped pills were CLIPPED below ~900px
      // (ui-mobile-appshell-001). Scrolling keeps every filter reachable at
      // any width; desktop is visually unchanged.
      className="shrink-0 flex items-center flex-nowrap overflow-x-auto mobile-scroll-hidden"
      data-testid="filter-bar"
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
      <div className="relative shrink-0" style={{ minWidth: '160px', flex: '1 1 240px', maxWidth: '360px' }}>
        <Search
          className="absolute w-3.5 h-3.5"
          style={{ left: 'var(--space-2)', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }}
        />
        <input
          type="text"
          data-testid="filter-search"
          placeholder="Search tasks…"
          value={searchQuery || ''}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="facelift-pill shrink-0"
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
        className="facelift-pill shrink-0"
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
        className="facelift-pill shrink-0"
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
        className="facelift-pill shrink-0"
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
        className="facelift-pill shrink-0"
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
        className="facelift-pill shrink-0"
        onClick={() => setFilterStale((v) => !v)}
        style={{
          color: filterStale ? 'var(--apple-orange)' : undefined,
          background: filterStale ? 'color-mix(in srgb, var(--apple-orange) 10%, transparent)' : undefined,
        }}
      >
        <AlertCircle className="w-3.5 h-3.5" />
        Stale
      </Button>

      {/* Active shells */}
      <Button
        variant={filterShellActive ? 'secondary' : 'ghost'}
        pill={false}
        size="sm"
        className="facelift-pill shrink-0"
        onClick={() => setFilterShellActive((v) => !v)}
        title="Show only tasks with an alive shell session"
        style={{
          color: filterShellActive ? 'var(--accent-app)' : undefined,
          background: filterShellActive ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : undefined,
        }}
      >
        <Terminal className="w-3.5 h-3.5" />
        Active shells
      </Button>

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Button variant="danger" pill={false} size="sm" className="facelift-pill shrink-0" onClick={resetAllFilters}>
          <X className="w-3 h-3" />
          Reset ({activeFilterCount})
        </Button>
      )}

      <div className="flex-1" />

      {/* Count */}
      <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
        {filteredCount} of {totalCount}
      </span>
    </div>
  )
}
