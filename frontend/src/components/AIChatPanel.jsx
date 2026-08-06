import { useState, useEffect, useRef } from 'react'
import { Send, Trash2, Loader2, Sparkles, Wrench, X, Lock, Square } from 'lucide-react'
import AIChatMessage from './AIChatMessage'
import { API_BASE, apiFetch } from '../config'
import { IconButton } from './ui'
import { useAuth } from '../contexts/AuthContext'

// Streaming (feat-ai-chat-stream-001): POST /api/ai/chat returns 202 and the
// response arrives as ai_chat_chunk / ai_chat_done / ai_chat_error events on
// the thread's socket room. The in-flight text lives in `streamText`, separate
// from `messages`, so completed AIChatMessage rows (memoized) keep stable
// props and skip re-rendering on every chunk. The ai_chat_join ack returns a
// server-side snapshot of any generation already running, which is what makes
// a refresh re-attach instead of losing the response.
export default function AIChatPanel({ user, task, compact, onClose, noHeader, aiChatEnabled = true }) {
  const { socketRef } = useAuth()
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamText, setStreamText] = useState(null)
  const [toolActivity, setToolActivity] = useState(null)
  const messagesEndRef = useRef(null)

  const threadKey = task ? `task:${task.id}` : `user:${user?.username}`
  const joinPayload = task ? { taskId: task.id } : { username: user?.username }

  const scrollToBottom = (behavior = 'smooth') => { messagesEndRef.current?.scrollIntoView({ behavior }) }

  useEffect(() => {
    let disposed = false
    const socket = socketRef?.current

    const attachSnapshot = (session) => {
      if (!session || session.status !== 'running') return
      // The pending user message isn't in history until the stream finishes —
      // surface it so the re-attached view reads as a normal exchange.
      if (session.userMessage) {
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'user' && last.content === session.userMessage) return prev
          return [...prev, { role: 'user', content: session.userMessage }]
        })
      }
      setStreamText(session.buffer || '')
      setLoading(true)
      setTimeout(() => scrollToBottom('auto'), 50)
    }

    const join = () => {
      socket?.emit('ai_chat_join', joinPayload, (ack) => {
        if (!disposed && ack?.session) attachSnapshot(ack.session)
      })
    }

    const onChunk = (payload) => {
      if (payload?.key !== threadKey) return
      setStreamText(prev => (payload.replace !== undefined ? payload.replace : (prev || '') + payload.text))
      setLoading(true)
    }
    const onDone = (payload) => {
      if (payload?.key !== threadKey) return
      setMessages(prev => [...prev, { role: 'assistant', content: payload.response, ...(payload.cancelled ? { cancelled: true } : {}) }])
      setStreamText(null)
      setLoading(false)
      setTimeout(() => scrollToBottom(), 50)
    }
    const onError = (payload) => {
      if (payload?.key !== threadKey) return
      setMessages(prev => [...prev, { role: 'assistant', content: `**Error:** ${payload.error || 'AI generation failed.'}` }])
      setStreamText(null)
      setLoading(false)
    }

    socket?.on('ai_chat_chunk', onChunk)
    socket?.on('ai_chat_done', onDone)
    socket?.on('ai_chat_error', onError)
    // Rooms don't survive a reconnect — re-join (and re-sync) when it happens.
    socket?.on('connect', join)

    // Load history first, then join: the join ack may append the pending user
    // message, which a later history overwrite would drop.
    const params = task ? `type=task&taskId=${task.id}` : `type=user&username=${user?.username}`
    apiFetch(`${API_BASE}/api/ai/history?${params}`)
      .then(res => res.json())
      .then(data => {
        if (disposed) return
        if (Array.isArray(data)) setMessages(data)
        setTimeout(() => scrollToBottom('auto'), 100)
        join()
      })
      .catch((err) => { console.error(err); join() })

    return () => {
      disposed = true
      socket?.emit('ai_chat_leave', joinPayload)
      socket?.off('ai_chat_chunk', onChunk)
      socket?.off('ai_chat_done', onDone)
      socket?.off('ai_chat_error', onError)
      socket?.off('connect', join)
    }
  }, [task?.id, user?.username])

  // Keep the streaming message in view as chunks land.
  useEffect(() => {
    if (streamText !== null) scrollToBottom('auto')
  }, [streamText])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setLoading(true)
    setToolActivity(null)
    setTimeout(() => scrollToBottom(), 50)
    try {
      const body = { message: trimmed, username: user?.username, role: user?.role }
      if (task) { body.taskId = task.id; body.taskContext = task }
      const res = await apiFetch(`${API_BASE}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (res.status === 409 && data.session) {
        // A generation is already running for this thread — attach to it.
        setStreamText(data.session.buffer || '')
      } else if (res.ok && data.streaming) {
        // 202 accepted — chunks arrive via the socket room.
      } else if (res.ok && data.response) {
        // Non-streaming fallback shape.
        if (data.toolResults?.length > 0) setToolActivity(data.toolResults)
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
        setLoading(false)
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `**Error:** ${data.error}` }])
        setLoading(false)
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '**Error:** Failed to connect to AI service.' }])
      setStreamText(null)
      setLoading(false)
    } finally {
      setTimeout(() => scrollToBottom(), 50)
    }
  }

  const handleStop = async () => {
    try {
      await apiFetch(`${API_BASE}/api/ai/chat/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(joinPayload),
      })
      // ai_chat_done (cancelled) finalizes the UI state.
    } catch (err) { console.error(err) }
  }

  const handleClear = async () => {
    const params = task ? `type=task&taskId=${task.id}` : `type=user&username=${user?.username}`
    try { await apiFetch(`${API_BASE}/api/ai/history?${params}`, { method: 'DELETE' }); setMessages([]); setToolActivity(null) } catch (err) { console.error(err) }
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  const userCanUseAiChat = user?.can_use_ai_chat !== false
  const isDisabled = !aiChatEnabled || !userCanUseAiChat

  if (isDisabled) {
    const reason = !aiChatEnabled ? 'AI Chat is disabled by an administrator.' : 'You don\'t have permission to use AI Chat.'
    return (
      <div className={`overflow-hidden flex flex-col ${noHeader ? 'h-full' : ''}`}>
        {!noHeader && (
          <div className="flex items-center justify-between shrink-0" style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>AI Chat</span>
            </div>
            {onClose && (
              <IconButton size="sm" onClick={onClose} color="var(--text-tertiary)" title="Close" aria-label="Close">
                <X className="w-4 h-4" />
              </IconButton>
            )}
          </div>
        )}
        <div className="flex-1 flex items-center justify-center" style={{ padding: 'var(--space-8)' }}>
          <div className="text-center">
            <Lock className="w-8 h-8 mx-auto" style={{ color: 'var(--text-tertiary)', opacity: 0.3, marginBottom: 'var(--space-3)' }} />
            <p style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-muted)', fontWeight: 'var(--font-medium)' }}>{reason}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`overflow-hidden flex flex-col ${noHeader ? 'h-full' : ''}`}>
      {/* Header */}
      {!noHeader && (
        <div className="flex items-center justify-between shrink-0" style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
            <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
              {task ? 'AI Assistant' : 'AI Chat'}
            </span>
            {task && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>({task.id})</span>}
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <IconButton size="sm" onClick={handleClear} color="var(--text-tertiary)" title="Clear" aria-label="Clear">
                <Trash2 className="w-3.5 h-3.5" />
              </IconButton>
            )}
            {onClose && (
              <IconButton size="sm" onClick={onClose} color="var(--text-tertiary)" title="Close" aria-label="Close">
                <X className="w-3.5 h-3.5" />
              </IconButton>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-3) var(--space-4)' }}>
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full gap-3" style={{ padding: 'var(--space-8)' }}>
            <Sparkles className="w-10 h-10" style={{ color: 'var(--text-tertiary)', opacity: 0.2 }} />
            <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', textAlign: 'center', maxWidth: '240px' }}>
              {task ? 'Ask about this task, request changes, or create subtasks.' : 'Ask me to create tasks, plan work, or help with your project.'}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <AIChatMessage key={i} message={msg} currentUser={user?.username} />
        ))}
        {streamText !== null && streamText !== '' && (
          <AIChatMessage message={{ role: 'assistant', content: streamText }} currentUser={user?.username} />
        )}
        {loading && !streamText && (
          <div className="flex items-start" style={{ marginBottom: 'var(--space-2)' }}>
            <div className="flex items-center gap-2" style={{ background: 'var(--fill-secondary)', padding: 'var(--space-2) var(--space-3)', borderRadius: '18px', borderBottomLeftRadius: '6px' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-app)' }} />
              <span style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>Thinking...</span>
            </div>
          </div>
        )}
        {toolActivity && toolActivity.length > 0 && (
          <div style={{ marginBottom: 'var(--space-2)' }} className="flex flex-wrap gap-1.5">
            {toolActivity.map((t, i) => (
              <span key={i} className="flex items-center gap-1" style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--accent-app)', background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)' }}>
                <Wrench className="w-3 h-3" />
                {t.tool}
                {t.result?.success && <span style={{ color: 'var(--apple-green)' }}>done</span>}
              </span>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 chat-input-safe" style={{ padding: 'var(--space-2) var(--space-3) var(--space-3)', borderTop: '0.5px solid var(--separator)' }}>
        <div className="flex items-center gap-1" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-full)', padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-4)' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={task ? "Ask about this task..." : "Ask the AI assistant..."}
            disabled={loading}
            className="flex-1 bg-transparent focus:outline-none disabled:opacity-50"
            style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', padding: 'var(--space-2) 0' }}
          />
          {loading && (
            <IconButton
              onClick={handleStop}
              style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--fill-secondary)' }}
              color="var(--apple-red, #ff453a)"
              title="Stop generating"
              aria-label="Stop generating"
            >
              <Square className="w-4 h-4" fill="currentColor" />
            </IconButton>
          )}
          {!loading && input.trim() && (
            <IconButton
              onClick={handleSend}
              className="text-white"
              style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-app)', color: 'white' }}
              title="Send"
              aria-label="Send message"
            >
              <Send className="w-[18px] h-[18px]" />
            </IconButton>
          )}
          {!loading && !input.trim() && messages.length > 0 && (
            <IconButton
              onClick={() => { if (window.confirm('Clear AI chat history?')) handleClear() }}
              style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--fill-secondary)' }}
              color="var(--text-tertiary)"
              title="Clear chat"
              aria-label="Clear chat"
            >
              <Trash2 className="w-[18px] h-[18px]" />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )
}
