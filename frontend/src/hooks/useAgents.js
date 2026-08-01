import { useState, useEffect, useCallback } from 'react'
import { API_BASE, apiFetch } from '../config'

export default function useAgents(user, socketRef, fetchData) {
  const [activeAgents, setActiveAgents] = useState([])
  const [agentsEnabled, setAgentsEnabled] = useState(true)
  const [aiChatEnabled, setAiChatEnabled] = useState(true)
  const [taskViewers, setTaskViewers] = useState({})

  // Fetch initial state
  useEffect(() => {
    if (!user) return

    apiFetch(`${API_BASE}/api/agents/active`)
      .then(res => res.json())
      // Guard the shape: consumers .filter/.some over this, so a non-array
      // response (error object, proxy page) must not white-screen the board.
      .then(data => setActiveAgents(Array.isArray(data) ? data : []))
      .catch(console.error)

    apiFetch(`${API_BASE}/api/presence`)
      .then(res => res.json())
      .then(data => setTaskViewers(data))
      .catch(console.error)

    apiFetch(`${API_BASE}/api/settings`)
      .then(res => res.json())
      .then(data => {
        setAgentsEnabled(data.agents_enabled !== false)
        setAiChatEnabled(data.ai_chat_enabled !== false)
      })
      .catch(console.error)
  }, [user])

  // Socket events
  useEffect(() => {
    const socket = socketRef.current
    if (!socket) return

    const onAgentComplete = (data) => {
      setActiveAgents(prev => prev.filter(a => a.taskId !== data.taskId))
    }

    const onAgentError = (data) => {
      setActiveAgents(prev => prev.filter(a => a.taskId !== data.taskId))
    }

    const onTaskViewers = (data) => {
      setTaskViewers(prev => {
        const next = { ...prev }
        if (data.viewers.length === 0) {
          delete next[data.taskId]
        } else {
          next[data.taskId] = data.viewers
        }
        return next
      })
    }

    socket.on('agent_complete', onAgentComplete)
    socket.on('agent_error', onAgentError)
    socket.on('task_viewers', onTaskViewers)

    return () => {
      socket.off('agent_complete', onAgentComplete)
      socket.off('agent_error', onAgentError)
      socket.off('task_viewers', onTaskViewers)
    }
  }, [socketRef.current])

  const handleStartAgent = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/agents/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, startedBy: user?.username })
      })
      if (res.ok) {
        const data = await res.json()
        setActiveAgents(prev => [...prev, { taskId, startedAt: data.startedAt, startedBy: user?.username }])
        fetchData()
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to start agent')
      }
    } catch (error) {
      console.error('Failed to start agent:', error)
    }
  }, [user?.username, fetchData])

  const handleStopAgent = useCallback(async (taskId) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/agents/${taskId}/stop`, { method: 'POST' })
      if (res.ok) {
        setActiveAgents(prev => prev.filter(a => a.taskId !== taskId))
      }
    } catch (error) {
      console.error('Failed to stop agent:', error)
    }
  }, [])

  return {
    activeAgents,
    agentsEnabled,
    aiChatEnabled,
    taskViewers,
    handleStartAgent,
    handleStopAgent,
  }
}
