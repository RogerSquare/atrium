// Task summary generator — produces a one-line digest of the task's recent state.
// Heuristic only (v1). Upgrade to LLM in v2 if the output feels too thin.
//
// Design: the summary does NOT restate what's already on the card (status, priority,
// assignee). It adds temporal context ("what just happened, how long ago") and the
// latest notable action, which is the information the raw activity_log was providing.

function relativeTime(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

function lastActivity(data) {
  const log = Array.isArray(data?.activity_log) ? data.activity_log : [];
  if (log.length === 0) return null;
  return log[log.length - 1];
}

// Strip the long-form "... by X" suffix from activity actions; the summary is tight.
function tightenAction(action) {
  if (!action) return '';
  return action
    .replace(/\s+by\s+[\w@.-]+$/i, '')
    .replace(/^Status changed from \S+ to (\S+)$/i, (_, s) => `Moved to ${s}`)
    .replace(/^Task marked as DONE$/i, 'Marked done')
    .replace(/^Description or Comments updated$/i, 'Content updated');
}

function generateSummary(data) {
  if (!data || typeof data !== 'object') return '';
  const status = data.status || 'todo';

  if (status === 'draft') return 'Draft — being composed.';
  if (status === 'done') return `Done${data.done_at ? ` · ${relativeTime(data.done_at)}` : ''}.`;

  const last = lastActivity(data);
  const when = last?.timestamp ? relativeTime(last.timestamp) : (data.created_at ? relativeTime(data.created_at) : '');
  const what = last?.action ? tightenAction(last.action) : 'Created';

  if (status === 'waiting_input') {
    // Surface the approval prompt if the last activity was an approval request.
    if (last?.action?.toLowerCase().startsWith('approval requested')) {
      return `${tightenAction(last.action)} · ${when}`;
    }
    return `Awaiting input · last: ${what}${when ? ` · ${when}` : ''}`;
  }

  if (status === 'review') {
    return `In review${data.reviewed_at ? ` · ${relativeTime(data.reviewed_at)}` : (when ? ` · ${when}` : '')}`;
  }

  if (status === 'in_progress') {
    return `Working · ${what}${when ? ` · ${when}` : ''}`;
  }

  // todo
  if (when) return `${what} · ${when}`;
  return 'Ready to start.';
}

module.exports = { generateSummary, relativeTime };
