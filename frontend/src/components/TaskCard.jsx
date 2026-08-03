import { memo, useState, useCallback } from 'react'
import { AlertCircle, AlignLeft, CheckCircle2, Circle, Copy, Check, CornerDownRight, Loader2, CalendarClock, Clock, Terminal, HelpCircle } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_COLOR, TYPE_STYLE, VIEWER_COLORS, MERGE_STATUS } from '../constants'
import { Badge, Select, Checkbox, Avatar } from './ui'

const PRIORITY_ICONS = {
  low: <Circle className="w-3 h-3" />,
  medium: <AlertCircle className="w-3 h-3" />,
  high: <AlertCircle className="w-3 h-3" fill="currentColor" />
}

// Signal dash — the card's compact state indicator (user feedback on the
// first cut of ui-card-redesign-impl-001: labeled chips + icons in the
// identity row OVERFLOWED narrow board columns). Resting state is a
// color-coded 12x4 bar; HOVER morphs it into its icon + word (styles in
// index.css .signal-dash) so meaning is one hover away, not tooltip-only.
// The agent spinner and the owner badge stay as-is, per the user's call.
function SignalDash({ color, label, short, icon: Icon, pulse = false, testid }) {
  return (
    <span
      data-testid={testid}
      role="img"
      aria-label={label}
      title={label}
      className={`signal-dash shrink-0 ${pulse ? 'animate-gentle-pulse' : ''}`}
      style={{ color }}
    >
      <span className="dash-bar" style={{ background: color }} />
      <span className="dash-reveal">
        {Icon && <Icon className="w-3 h-3 shrink-0" />}
        {short}
      </span>
    </span>
  )
}

function TaskCard({ task, onUpdateTask, onClick, isDragging, agentRunning, viewers = [], shellSession, selectable, selected, onToggleSelect, onShiftSelect, orderedTaskIds, justUpdated, compact, isStale, githubLinks = {}, projectHasSuites = false }) {
  const [copied, setCopied] = useState(false)
  const hasComments = task.content && task.content.includes('### Comments') && task.content.split('### Comments')[1].trim().length > 0

  // The catch matters: clipboard writes reject on unfocused pages and
  // non-secure contexts, and an unhandled rejection trips vite's dev error
  // overlay (same bug class fixed in ListView, ui-list-redesign-impl-001).
  const handleCopyId = useCallback((e) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(task.id).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        {task.status === 'waiting_input' && (
          <HelpCircle className="w-3.5 h-3.5 shrink-0 animate-gentle-pulse" style={{ color: 'var(--apple-yellow)' }} title="Waiting on your response" />
        )}
        {agentRunning && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent-app)' }} />}
        {shellSession && (
          <Terminal
            className={`w-3.5 h-3.5 shrink-0 ${shellSession.processing ? 'animate-gentle-pulse' : ''}`}
            style={{
              color: shellSession.processing
                ? 'var(--apple-green)'
                : (shellSession.attached ? 'var(--accent-app)' : 'var(--text-muted)'),
              opacity: shellSession.attached ? 1 : 0.6,
            }}
            title={
              shellSession.processing
                ? 'Shell processing'
                : (shellSession.attached ? 'Shell attached' : 'Shell detached — alive in background')
            }
          />
        )}
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

  // Full card — three zones (ui-card-redesign-impl-001):
  //   1. identity line: id + type on the left, ONE signal cluster on the
  //      right (needs-you / agent / shell / stale / done)
  //   2. the focal block: title (the card's only bright element) + summary
  //   3. one calm metadata footer
  // Same information as the old six-zone layout — plus the shell indicator
  // and copyable id the full card previously lacked. Pulse is reserved for
  // "Needs you" alone.
  return (
    <div
      onClick={handleClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e) } }}
      tabIndex="0"
      role="button"
      aria-label={`${task.title}, ${task.priority} priority, ${task.status}${task.status === 'waiting_input' ? ', needs your response' : ''}${agentRunning ? ', agent running' : ''}${selected ? ', selected' : ''}`}
      className="apple-hover cursor-pointer relative flex flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
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
      {/* Zone 1: identity + signal dashes. The id chip is the only element
          allowed to shrink (min-w-0 + truncate); everything on the right is
          a fixed handful of 12px dashes, so this row can NEVER overflow a
          narrow board column — the failure the first cut shipped. */}
      <div className="flex items-center gap-2 mb-2 min-w-0">
        {selectable && (
          <Checkbox
            checked={Boolean(selected)}
            onChange={() => onToggleSelect?.(task.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Select task ${task.title}`}
          />
        )}
        <button
          onClick={handleCopyId}
          className="apple-press flex items-center gap-1.5 min-w-0"
          title={`Copy task id ${task.id}`}
          aria-label={`Copy task id ${task.id}`}
          data-testid="card-id-copy"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer' }}
        >
          {(() => {
            const link = githubLinks[task.id]
            const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
            return ms ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ms.dotColor, flexShrink: 0 }} title={`PR ${ms.label}`} /> : null
          })()}
          {copied ? <Check className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-2.5 h-2.5 shrink-0" />}
          <span className="truncate">{task.id}</span>
        </button>
        <div className="flex-1" style={{ minWidth: 'var(--space-2)' }} />
        {/* Signal dashes — color-coded state strips (word in tooltip).
            Only the agent keeps its spinner, per the user's exception. */}
        <div className="flex items-center gap-1 shrink-0" data-testid="card-signal-cluster">
          <SignalDash
            color={(TYPE_STYLE[task.type || 'fullstack'] || TYPE_STYLE.fullstack).color}
            label={`Type: ${task.type || 'fullstack'}`}
            short={task.type || 'fullstack'}
            testid="card-type-dash"
          />
          {/* Waiting-on-human (ui-approvals-inbox-001) — still the ONLY
              pulsing element on the card. */}
          {task.status === 'waiting_input' && (
            <SignalDash
              color="var(--apple-yellow)"
              label="Needs you — an agent is waiting on your response"
              short="Needs you"
              icon={HelpCircle}
              pulse
              testid="card-waiting-indicator"
            />
          )}
          {shellSession && (
            <SignalDash
              testid="card-shell-indicator"
              icon={Terminal}
              color={shellSession.processing
                ? 'var(--apple-green)'
                : (shellSession.attached ? 'var(--accent-app)' : 'var(--text-muted)')}
              short={shellSession.processing ? 'shell busy' : (shellSession.attached ? 'shell' : 'shell (bg)')}
              label={shellSession.processing
                ? 'Shell processing'
                : (shellSession.attached ? 'Shell attached' : 'Shell detached — alive in background')}
            />
          )}
          {isStale && <SignalDash color="var(--apple-orange)" label="Stale — no recent activity" short="stale" icon={Clock} />}
          {task.status === 'done' && <SignalDash color="var(--apple-green)" label="Done" short="done" icon={CheckCircle2} />}
          {agentRunning && (
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: 'var(--accent-app)' }} title="Agent running" />
          )}
        </div>
      </div>

      {/* Zone 2: the focal block */}
      <h3 className="break-words line-clamp-2 mb-1" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', lineHeight: 'var(--leading-tight)' }}>
        {task.title}
      </h3>
      {task.summary && (
        <div className="truncate mb-3" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', fontStyle: 'italic' }} title={task.summary}>
          {task.summary}
        </div>
      )}

      {/* Zone 3: one metadata footer — reworked per live feedback: the
          glyph-only priority read as a mystery red circle, so it carries its
          word again; "subtask" says what the mono parent id only implied. */}
      <div className="flex items-center flex-wrap mt-auto pt-2 gap-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
        <Badge
          preset="priority" value={task.priority || 'medium'}
          onClick={togglePriority}
          role="button"
          aria-label={`Priority: ${task.priority || 'medium'}. Click to cycle.`}
          title="Click to cycle priority"
          data-testid="card-priority-cycle"
          className="apple-press cursor-pointer flex items-center gap-1"
        >
          {PRIORITY_ICONS[task.priority || 'medium']}
          {task.priority || 'medium'}
        </Badge>
        {task.assignee && (
          <Badge
            preset="muted"
            className="flex items-center gap-1"
            style={{ color: 'var(--text-app)' }}
            title={`Assigned to ${task.assignee}`}
          >
            <span className="truncate max-w-[100px]">{task.assignee}</span>
            {task.status === 'in_progress' && (
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--apple-green)' }} title="In progress" />
            )}
          </Badge>
        )}
        {task.parent_task && (
          <Badge
            preset="muted"
            className="flex items-center gap-1"
            title={`Subtask of ${task.parent_task}`}
            data-testid="card-subtask-chip"
          >
            <CornerDownRight className="w-3 h-3" />
            subtask
          </Badge>
        )}
        {hasComments && (
          <Badge preset="muted" className="flex items-center" title="Has comments" aria-label="Has comments">
            <AlignLeft className="w-3 h-3" />
          </Badge>
        )}
        {task.due_date && (() => {
          const diff = Math.ceil((new Date(task.due_date) - new Date()) / (1000 * 60 * 60 * 24))
          const c = diff < 0 ? 'var(--apple-red)' : diff <= 3 ? 'var(--apple-orange)' : 'var(--apple-green)'
          const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Today' : `${diff}d`
          return (
            <Badge color={c} bg={`color-mix(in srgb, ${c} 10%, transparent)`} className="flex items-center gap-1">
              <CalendarClock className="w-3 h-3" />{label}
            </Badge>
          )
        })()}
        {/* Test badge (ui-tests-tab-generic-001, P1-13): rendered only when
            the task HAS run data or its project declares suites. */}
        {(task.e2e_status || projectHasSuites) && (
          <Badge
            preset="e2e"
            value={task.e2e_status || 'pending'}
            className="flex items-center gap-1"
            aria-label={`tests: ${task.e2e_status || 'pending'}`}
          >
            tests: {task.e2e_status || 'pending'}
          </Badge>
        )}
        {task.component && (
          <Badge preset="muted" className="truncate" style={{ maxWidth: '110px' }} title={task.component}>
            {task.component}
          </Badge>
        )}
        {viewers.length > 0 && (
          <div className="flex -space-x-1.5 shrink-0" title={`${viewers.join(', ')} viewing`}>
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
        )}
        <div className="flex-1" />
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
  // shellSession identity changes whenever the broadcast snapshot replaces
  // the entry, OR when webshell:processing toggles and we shallow-clone
  // it. Cheap reference check is enough; field-level diff would only
  // help if the hook over-rendered, which it doesn't.
  if (prev.shellSession !== next.shellSession) return false
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
  if (prev.projectHasSuites !== next.projectHasSuites) return false
  const pt = prev.task, nt = next.task
  if (pt.id !== nt.id || pt.title !== nt.title || pt.status !== nt.status ||
      pt.priority !== nt.priority || pt.type !== nt.type || pt.component !== nt.component ||
      pt.project !== nt.project || pt.assignee !== nt.assignee || pt.content !== nt.content ||
      pt.parent_task !== nt.parent_task || pt.due_date !== nt.due_date ||
      // The tests badge reads e2e_status — without this a finished run
      // wouldn't repaint the card (pre-existing gap, surfaced by making the
      // badge conditional).
      pt.e2e_status !== nt.e2e_status ||
      // The summary line is RENDERED but was never compared — activity that
      // changes only the summary (a comment, an assignee event) left stale
      // text on screen until some other field moved (ui-card-redesign-impl-001,
      // same failure shape as the e2e_status gap above).
      pt.summary !== nt.summary) return false
  const pv = prev.viewers, nv = next.viewers
  if (pv.length !== nv.length) return false
  for (let i = 0; i < pv.length; i++) { if (pv[i] !== nv[i]) return false }
  return true
}

export default memo(TaskCard, taskCardPropsAreEqual)
