// Facelift Phase 5 — TimelineEntry.
//
// Extracted from ChangesView's per-row message column. Renders the
// status icon + title + category id badge + branch badge + PR badge
// with review/blocker indicators.
//
// The parent still owns lane tint, label column, SVG overlay, and
// visibility transitions — this primitive only renders the data body
// of a single timeline row.

import { Circle, Loader2, Eye, CheckCircle2, GitBranch, GitPullRequest, GitPullRequestDraft, AlertCircle, AlertTriangle, XCircle, Clock, Check } from 'lucide-react'
import { STATUS_COLOR } from '../../constants'

const STATUS_ICON = {
  todo: Circle,
  in_progress: Loader2,
  review: Eye,
  done: CheckCircle2,
  waiting_input: Circle,
  draft: Circle,
}

const PR_STATE_STYLE = {
  OPEN:   { color: 'var(--apple-green)',  label: 'open'   },
  MERGED: { color: 'var(--apple-purple)', label: 'merged' },
  CLOSED: { color: 'var(--apple-red)',    label: 'closed' },
}

const REVIEW_INDICATOR = {
  APPROVED: { icon: Check,       color: 'var(--apple-green)',  label: 'Approved' },
  BLOCKED:  { icon: AlertCircle, color: 'var(--apple-red)',    label: 'Changes requested' },
  PENDING:  { icon: Clock,       color: 'var(--apple-yellow)', label: 'Pending merge' },
  DRAFT:    { icon: Clock,       color: 'var(--text-tertiary)', label: 'Draft — not yet ready for review', hollow: true },
}

function reviewStyleFor(decision, { isDraft = false } = {}) {
  if (isDraft) return REVIEW_INDICATOR.DRAFT
  if (decision === 'APPROVED') return REVIEW_INDICATOR.APPROVED
  if (decision === 'CHANGES_REQUESTED') return REVIEW_INDICATOR.BLOCKED
  return REVIEW_INDICATOR.PENDING
}

function blockerStyleFor({ merge_state, ci_status, pr_state, is_draft }) {
  if (pr_state !== 'OPEN' || is_draft) return null
  if (merge_state === 'DIRTY')   return { icon: AlertTriangle, color: 'var(--apple-red)',    label: 'Conflicts — needs rebase' }
  if (merge_state === 'BEHIND')  return { icon: AlertTriangle, color: 'var(--apple-orange)', label: 'Behind base — needs rebase' }
  if (ci_status === 'FAILURE')   return { icon: XCircle,       color: 'var(--apple-red)',    label: 'CI failing' }
  if (ci_status === 'PENDING')   return { icon: Loader2,       color: 'var(--apple-yellow)', label: 'CI running', spin: true }
  if (ci_status === 'SUCCESS')   return { icon: Check,         color: 'var(--apple-green)',  label: 'CI passing' }
  return null
}

export default function TimelineEntry({ task, link, categoryStyle }) {
  const StatusIcon = STATUS_ICON[task.status] || Circle
  const prStyle = link?.pr_state ? PR_STATE_STYLE[link.pr_state] : null

  return (
    <>
      <StatusIcon
        className={`w-3.5 h-3.5 shrink-0 ${task.status === 'in_progress' ? 'animate-spin' : ''}`}
        style={{ color: STATUS_COLOR[task.status] || 'var(--gray-1)' }}
      />
      <span
        className="truncate"
        style={{
          fontSize: 'var(--text-subhead)',
          color: task.status === 'done' ? 'var(--text-muted)' : 'var(--text-app)',
          flex: '1 1 auto',
          minWidth: 0,
          textDecoration: task.status === 'done' ? 'line-through' : 'none',
        }}
        title={task.title}
      >
        {task.title}
      </span>
      <span
        className="shrink-0"
        style={{
          padding: categoryStyle ? '2px 6px' : 0,
          borderRadius: '4px',
          background: categoryStyle ? `color-mix(in srgb, ${categoryStyle.color} 14%, transparent)` : 'transparent',
          border: categoryStyle ? `1px solid color-mix(in srgb, ${categoryStyle.color} 35%, transparent)` : 'none',
          color: categoryStyle ? categoryStyle.color : 'var(--text-muted)',
          fontSize: '10px',
          fontWeight: categoryStyle ? 600 : 400,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
        }}
        title={categoryStyle ? `Category: ${categoryStyle.label}` : undefined}
      >
        {task.id}
      </span>
      {link?.branch && (() => {
        const hasPr = !!link.pr_url
        const href = hasPr ? link.pr_url : (link.branch_url || '#')
        const tooltip = hasPr
          ? `Open PR #${link.pr_number}: ${link.pr_title || link.branch}`
          : `Open branch ${link.branch}`
        return (
          <a
            href={href}
            target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center gap-1"
            style={{
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'var(--fill-secondary)',
              color: 'var(--text-tertiary)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              maxWidth: '180px',
            }}
            title={tooltip}
          >
            <GitBranch className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{link.branch}</span>
          </a>
        )
      })()}
      {link?.pr_number && prStyle && (() => {
        const isDraft = link.is_draft === true
        const reviewStyle = link.pr_state === 'OPEN' ? reviewStyleFor(link.review_decision, { isDraft }) : null
        const blockerStyle = blockerStyleFor(link)
        const ReviewIcon = reviewStyle?.icon
        const BlockerIcon = blockerStyle?.icon
        const PrIcon = isDraft ? GitPullRequestDraft : GitPullRequest
        const prBadgeBg = isDraft ? 'var(--fill-secondary)' : `color-mix(in srgb, ${prStyle.color} 14%, transparent)`
        const prBadgeBorder = isDraft
          ? '1px dashed color-mix(in srgb, var(--text-tertiary) 55%, transparent)'
          : `1px solid color-mix(in srgb, ${prStyle.color} 35%, transparent)`
        const prBadgeColor = isDraft ? 'var(--text-tertiary)' : prStyle.color
        const stateLabel = isDraft ? 'draft' : prStyle.label
        const tooltipSuffix = [reviewStyle?.label, blockerStyle?.label].filter(Boolean).map(s => s.toLowerCase()).join(' · ')
        return (
          <>
            {reviewStyle && (
              <span
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: reviewStyle.hollow ? 'transparent' : `color-mix(in srgb, ${reviewStyle.color} 18%, transparent)`,
                  border: reviewStyle.hollow ? `1px dashed ${reviewStyle.color}` : 'none',
                  color: reviewStyle.color,
                }}
                title={reviewStyle.label}
              >
                <ReviewIcon className="w-3 h-3" />
              </span>
            )}
            {blockerStyle && (
              <span
                className="shrink-0 flex items-center justify-center"
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: `color-mix(in srgb, ${blockerStyle.color} 18%, transparent)`,
                  color: blockerStyle.color,
                }}
                title={blockerStyle.label}
              >
                <BlockerIcon className={`w-3 h-3 ${blockerStyle.spin ? 'animate-spin' : ''}`} />
              </span>
            )}
            <a
              href={link.pr_url}
              target="_blank" rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 flex items-center gap-1"
              style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: prBadgeBg,
                border: prBadgeBorder,
                color: prBadgeColor,
                fontSize: '10px',
                fontWeight: 600,
              }}
              title={`PR #${link.pr_number}: ${link.pr_title} (${stateLabel}${tooltipSuffix ? ` · ${tooltipSuffix}` : ''})`}
            >
              <PrIcon className="w-2.5 h-2.5" />
              #{link.pr_number}
            </a>
          </>
        )
      })()}
    </>
  )
}
