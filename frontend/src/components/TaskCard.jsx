import { memo, useState, useCallback } from 'react'
import { AlertCircle, AlignLeft, CheckCircle2, Circle, Copy, Check, UserCircle2, Link, Loader2, CalendarClock, Clock } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_COLOR, TYPE_STYLE, VIEWER_COLORS, MERGE_STATUS } from '../constants'
import { Badge, Select, Checkbox, Avatar } from './ui'

const PRIORITY_ICONS = {
  low: <Circle className="w-3 h-3" />,
  medium: <AlertCircle className="w-3 h-3" />,
  high: <AlertCircle className="w-3 h-3" fill="currentColor" />
}

function TaskCard({ task, onUpdateTask, onClick, isDragging, agentRunning, viewers = [], selectable, selected, onToggleSelect, onShiftSelect, orderedTaskIds, justUpdated, compact, isStale, githubLinks = {} }) {
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const hasComments = task.content && task.content.includes('### Comments') && task.content.split('### Comments')[1].trim().length > 0

  const handleCopyId = useCallback((e) => {
    e.stopPropagation()
    navigator.clipboard.writeText(task.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [task.id])

  const handleCopyLink = useCallback((e) => {
    e.stopPropagation()
    const url = new URL(window.location)
    url.searchParams.set('task', task.id)
    navigator.clipboard.writeText(url.toString())
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }, [task.id])

  const togglePriority = useCallback((e) => {
    e.stopPropagation()
    const next = { low: 'medium', medium: 'high', high: 'low' }[task.priority] || 'medium'
    onUpdateTask(task.id, { priority: next })
  }, [task.id, task.priority, onUpdateTask])

  const handleClick = selectable
    ? (e) => {
        e.stopPropagation()
        e.preventDefault()
        if (e.shiftKey && onShiftSelect && orderedTaskIds) {
          window.getSelection()?.removeAllRanges()
          onShiftSelect(task.id, orderedTaskIds)
        } else {
          onToggleSelect?.(task.id)
        }
      }
    : onClick

  const priorityColor = PRIORITY_COLOR[task.priority] || PRIORITY_COLOR.medium
  const typeStyle = TYPE_STYLE[task.type || 'fullstack'] || TYPE_STYLE.fullstack

  // Compact mode: single-line card
  if (compact) {
    return (
      <div
        onClick={handleClick}
        role="button"
        tabIndex="0"
        aria-label={`${task.title}, ${task.priority} priority, ${task.status}`}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e) } }}
        className="apple-hover apple-press flex items-center gap-2 cursor-pointer"
        style={{
          padding: 'var(--space-2) var(--space-3)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-card)',
          border: 'var(--border-hairline)',
          borderLeft: `3px solid ${priorityColor}`,
          outline: selected || isDragging ? '2px solid var(--accent-app)' : 'none',
          outlineOffset: '-2px',
          transform: isDragging ? 'scale(1.02)' : 'none',
          transition: `outline-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-spring)`,
          opacity: justUpdated ? 0.8 : 1,
        }}
        title={`${task.id} — ${task.title}\nPriority: ${task.priority} | Type: ${task.type || 'fullstack'}`}
      >
        {selectable && (
          <Checkbox
            checked={Boolean(selected)}
            onChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select task ${task.title}`}
          />
        )}
        <span className="truncate flex-1" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{task.title}</span>
        {agentRunning && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent-app)' }} />}
        {isStale && <Clock className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--apple-orange)' }} title="Stale — no recent activity" />}
        {task.assignee && (
          <Avatar
            size="xs"
            alt={task.assignee}
            color="white"
            background="var(--gray-2)"
            title={task.assignee}
          />
        )}
        {task.status === 'done' && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--apple-green)' }} />}
      </div>
    )
  }

  // Full card
  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e) } }}
      tabIndex="0"
      role="button"
      aria-label={`${task.title}, ${task.priority} priority, ${task.status}${selected ? ', selected' : ''}`}
      className="apple-hover cursor-pointer relative flex flex-col focus-visible:outline-none"
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
        border: 'var(--border-hairline)',
        borderLeft: `3px solid ${priorityColor}`,
        outline: selected || isDragging
          ? '2px solid var(--accent-app)'
          : justUpdated
            ? '1px solid color-mix(in srgb, var(--accent-app) 50%, transparent)'
            : 'none',
        outlineOffset: '-2px',
        transform: isDragging ? 'scale(1.02)' : 'none',
        transition: `outline-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-spring)`,
      }}
    >
      {/* Header: ID + Type + Actions */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {selectable && (
          <Checkbox
            checked={Boolean(selected)}
            onChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select task ${task.title}`}
          />
        )}
        <span className="flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }} title={task.id}>
          {(() => {
            const link = githubLinks[task.id]
            const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
            return ms ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ms.dotColor, flexShrink: 0 }} title={`PR ${ms.label}`} /> : null
          })()}
          {task.id}
        </span>
        <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase', color: typeStyle.color, background: typeStyle.bg, padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
          {task.type || 'fullstack'}
        </span>
        {task.component && (
          <span className="truncate max-w-[100px]" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', fontWeight: 'var(--font-medium)' }}>
            {task.component}
          </span>
        )}
      </div>

      {/* Parent task */}
      {task.parent_task && (
        <div className="truncate mb-1" style={{ fontSize: 'var(--text-caption2)', fontFamily: 'var(--font-mono)', color: 'color-mix(in srgb, var(--accent-app) 60%, transparent)' }}>
          ↑ {task.parent_task}
        </div>
      )}

      {/* Title */}
      <h3 className="break-words line-clamp-2 mb-1" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', lineHeight: 'var(--leading-tight)' }}>
        {task.title}
      </h3>

      {/* Summary — one-line digest of recent state */}
      {task.summary && (
        <div className="truncate mb-3" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', fontStyle: 'italic' }} title={task.summary}>
          {task.summary}
        </div>
      )}

      {/* Meta: viewers */}
      {viewers.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3">
          <div className="flex -space-x-1.5">
            {viewers.slice(0, 3).map((name, i) => (
              <Avatar
                key={name}
                size="xs"
                alt={name}
                color="white"
                background={VIEWER_COLORS[i % VIEWER_COLORS.length]}
                style={{ border: '2px solid var(--bg-card)' }}
                title={`${name} is viewing`}
              />
            ))}
            {viewers.length > 3 && (
              <Avatar
                size="xs"
                initials={`+${viewers.length - 3}`}
                color="var(--text-muted)"
                background="var(--fill-primary)"
                style={{ border: '2px solid var(--bg-card)' }}
              />
            )}
          </div>
          <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>viewing</span>
        </div>
      )}

      {/* Footer: priority + assignee + due date + status indicators */}
      <div className="flex items-center flex-wrap mt-auto pt-2 gap-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
        <Badge
          preset="priority" value={task.priority || 'medium'}
          onClick={togglePriority}
          aria-label={`Priority: ${task.priority || 'medium'}. Click to cycle.`}
          className="apple-press cursor-pointer flex items-center gap-1.5"
          role="button"
        >
          {PRIORITY_ICONS[task.priority || 'medium']}
          {task.priority || 'Medium'}
        </Badge>
        {task.assignee && (
          <Badge
            preset="muted"
            className="flex items-center gap-1"
            style={{ padding: '2px 8px', color: 'var(--text-app)' }}
          >
            <Avatar
              size="xs"
              alt={task.assignee}
              color="white"
              background="var(--gray-2)"
              style={{ width: '14px', height: '14px', fontSize: '8px' }}
            />
            <span className="truncate max-w-[80px]">{task.assignee}</span>
            {task.status === 'in_progress' && (
              <span className="animate-gentle-pulse" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--apple-green)' }} />
            )}
          </Badge>
        )}

        {task.due_date && (() => {
          const diff = Math.ceil((new Date(task.due_date) - new Date()) / (1000 * 60 * 60 * 24))
          const c = diff < 0 ? 'var(--apple-red)' : diff <= 3 ? 'var(--apple-orange)' : 'var(--apple-green)'
          const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Today' : `${diff}d`
          return (
            <Badge color={c} bg={`color-mix(in srgb, ${c} 10%, transparent)`} className="flex items-center gap-1" style={{ padding: 'var(--space-1) var(--space-2)' }}>
              <CalendarClock className="w-3 h-3" />{label}
            </Badge>
          )
        })()}
        {agentRunning && (
          <Badge color="var(--accent-app)" bg="color-mix(in srgb, var(--accent-app) 10%, transparent)" className="flex items-center gap-1 animate-gentle-pulse" style={{ padding: 'var(--space-1) var(--space-2)' }}>
            <Loader2 className="w-3 h-3 animate-spin" />Agent
          </Badge>
        )}
        {isStale && (
          <Badge color="var(--apple-orange)" bg="var(--fill-secondary)" className="flex items-center gap-1" style={{ padding: 'var(--space-1) var(--space-2)' }}>
            <Clock className="w-3 h-3" />Stale
          </Badge>
        )}
        <div className="flex-1" />
        {hasComments && <AlignLeft className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
        {task.status === 'done' && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--apple-green)' }} />}
        {/* Mobile status selector */}
        <Select
          value={task.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => { e.stopPropagation(); onUpdateTask(task.id, { status: e.target.value }) }}
          className="sm:hidden ml-auto"
          style={{ padding: 'var(--space-1) var(--space-2)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)' }}
        >
          {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
      </div>
    </div>
  )
}

function taskCardPropsAreEqual(prev, next) {
  if (prev.isDragging !== next.isDragging) return false
  if (prev.agentRunning !== next.agentRunning) return false
  if (prev.onClick !== next.onClick) return false
  if (prev.onUpdateTask !== next.onUpdateTask) return false
  if (prev.selectable !== next.selectable) return false
  if (prev.selected !== next.selected) return false
  if (prev.onToggleSelect !== next.onToggleSelect) return false
  if (prev.onShiftSelect !== next.onShiftSelect) return false
  if (prev.orderedTaskIds !== next.orderedTaskIds) return false
  if (prev.justUpdated !== next.justUpdated) return false
  if (prev.compact !== next.compact) return false
  if (prev.isStale !== next.isStale) return false
  const pt = prev.task, nt = next.task
  if (pt.id !== nt.id || pt.title !== nt.title || pt.status !== nt.status ||
      pt.priority !== nt.priority || pt.type !== nt.type || pt.component !== nt.component ||
      pt.project !== nt.project || pt.assignee !== nt.assignee || pt.content !== nt.content ||
      pt.parent_task !== nt.parent_task || pt.due_date !== nt.due_date) return false
  const pv = prev.viewers, nv = next.viewers
  if (pv.length !== nv.length) return false
  for (let i = 0; i < pv.length; i++) { if (pv[i] !== nv[i]) return false }
  return true
}

export default memo(TaskCard, taskCardPropsAreEqual)
