import { useState, useEffect } from 'react'
import { API_BASE, apiFetch } from '../config'

// Live map of alive web-shell PTY sessions, keyed by taskId. Backed by
// `feat-shell-lifecycle-001` Slice 2 (REST + broadcast) and Slice 3
// (processing throttle).
//
// Initial state comes from GET /api/shell/sessions; subsequent updates
// stream over two socket events:
//   shell_sessions_changed { sessions: [...] }   — full snapshot, fired on
//                                                  every spawn / exit /
//                                                  attach / detach / kill /
//                                                  GC eviction
//   webshell:processing { taskId, active }       — fast-path toggle for the
//                                                  per-entry processing
//                                                  flag (state-change-only
//                                                  emit; no flood)
//
// Shape per entry (mirrors backend getSessionsSnapshot):
//   { taskId, spawnId, sessionId, pid, attached, detachedAt,
//     lastActivityTs, spawnAt, bytesEmitted, processing }
export default function useShellSessions(user, socketRef) {
  const [shellSessions, setShellSessions] = useState({})

  useEffect(() => {
    if (!user) return
    apiFetch(`${API_BASE}/api/shell/sessions`)
      .then(res => res.json())
      .then(data => {
        const next = {}
        for (const s of data.sessions || []) next[s.taskId] = s
        setShellSessions(next)
      })
      .catch(err => console.error('useShellSessions: initial fetch failed', err))
  }, [user])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    const onChanged = ({ sessions }) => {
      const next = {}
      for (const s of sessions || []) next[s.taskId] = s
      setShellSessions(next)
    }

    const onProcessing = ({ taskId, active }) => {
      setShellSessions(prev => {
        // The processing event can race ahead of shell_sessions_changed
        // when a freshly-spawned PTY emits onData almost immediately.
        // If the entry isn't in the map yet, ignore — the snapshot will
        // arrive within milliseconds and carry processing:true anyway.
        const entry = prev[taskId]
        if (!entry) return prev
        if (entry.processing === active) return prev
        return { ...prev, [taskId]: { ...entry, processing: active } }
      })
    }

    socket.on('shell_sessions_changed', onChanged)
    socket.on('webshell:processing', onProcessing)

    return () => {
      socket.off('shell_sessions_changed', onChanged)
      socket.off('webshell:processing', onProcessing)
    }
  }, [socketRef.current])

  return { shellSessions }
}
