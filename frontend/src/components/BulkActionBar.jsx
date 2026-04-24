import { useState } from 'react'
import { Trash2, X, CheckSquare, Square, AlertTriangle, Loader2 } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_OPTIONS } from '../constants'
import { Button, IconButton, Select } from './ui'

export default function BulkActionBar({ selectedIds, totalVisible, onSelectAll, onDeselectAll, onExit, onBatchUpdate, onBatchDelete, uniqueAssignees, currentUser, loading }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const count = selectedIds.length
  const disabled = loading || count === 0

  return (
    <div
      className="sticky top-0 z-30 vibrancy-regular animate-slide-up"
      style={{
        padding: '10px 16px',
        marginBottom: 'var(--space-4)',
        borderRadius: 'var(--radius-md)',
        background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)',
        border: 'var(--border-hairline)',
      }}
    >
      <div className="flex items-center gap-3 flex-wrap">
        {/* Selection info */}
        <div className="flex items-center gap-2">
          <span aria-live="polite" aria-atomic="true" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)' }}>{count} selected</span>
          <Button variant="ghost" size="sm" onClick={count < totalVisible ? onSelectAll : onDeselectAll}>
            {count < totalVisible ? <><CheckSquare className="w-3.5 h-3.5" /> All ({totalVisible})</> : <><Square className="w-3.5 h-3.5" /> Deselect</>}
          </Button>
        </div>

        <div className="divider-v hidden sm:block" />

        {/* Status */}
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-app)' }} />}
          <span className="hidden sm:inline text-caption2 font-medium" style={{ color: 'var(--text-tertiary)', marginRight: '4px' }}>Move to</span>
          {STATUS_OPTIONS.map(s => (
            <Button key={s.id} variant="ghost" size="sm" disabled={disabled} onClick={() => onBatchUpdate({ status: s.id })}>
              {s.label}
            </Button>
          ))}
        </div>

        <div className="divider-v hidden sm:block" />

        <Select onChange={(e) => { if (e.target.value) onBatchUpdate({ priority: e.target.value }); e.target.value = '' }} defaultValue="" disabled={disabled} style={{ background: 'var(--bg-card)' }}>
          <option value="" disabled>Priority</option>
          {PRIORITY_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>

        <Select onChange={(e) => { if (e.target.value) onBatchUpdate({ assignee: e.target.value === '__unassign__' ? null : e.target.value }); e.target.value = '' }} defaultValue="" disabled={disabled} style={{ background: 'var(--bg-card)' }}>
          <option value="" disabled>Assign to</option>
          <option value={currentUser}>Me ({currentUser})</option>
          <option value="__unassign__">Unassign</option>
          {uniqueAssignees.filter(a => a !== currentUser).map(a => <option key={a} value={a}>{a}</option>)}
        </Select>

        <div className="flex-1" />

        {/* Delete */}
        {!showDeleteConfirm ? (
          <Button variant="danger" disabled={disabled} onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </Button>
        ) : (
          <div className="flex items-center gap-2" style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--apple-red) 10%, transparent)' }}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--apple-red)' }} /> : <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--apple-red)' }} />}
            <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-red)' }}>{loading ? 'Deleting...' : `Delete ${count}?`}</span>
            <Button variant="danger-filled" size="sm" pill={false} disabled={loading} onClick={() => { setShowDeleteConfirm(false); onBatchDelete() }}>Confirm</Button>
            <Button variant="danger" size="sm" disabled={loading} onClick={() => setShowDeleteConfirm(false)}>Cancel</Button>
          </div>
        )}

        <IconButton onClick={onExit} aria-label="Exit selection mode" title="Exit (Escape)">
          <X className="w-4 h-4" />
        </IconButton>
      </div>
    </div>
  )
}
