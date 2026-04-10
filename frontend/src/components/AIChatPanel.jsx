import { useState, useEffect, useRef } from 'react'
import { Send, Trash2, Loader2, Sparkles, Wrench, X, Lock } from 'lucide-react'
import AIChatMessage from './AIChatMessage'
import { API_BASE, apiFetch } from '../config'

export default function AIChatPanel({ user, task, compact, onClose, noHeader, aiChatEnabled = true }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [toolActivity, setToolActivity] = useState(null)
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }

  useEffect(() => {
    const params = task ? `type=task&taskId=${task.id}` : `type=user&username=${user?.username}`
    apiFetch(`${API_BASE}/api/ai/history?${params}`)
      .then(res => res.json())
      .then(data => { if (Array.isArray(data)) setMessages(data); setTimeout(scrollToBottom, 100) })
      .catch(console.error)
  }, [task?.id, user?.username])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return
    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setLoading(true)
    setToolActivity(null)
    setTimeout(scrollToBottom, 50)
    try {
      const body = { message: trimmed, username: user?.username, role: user?.role }
      if (task) { body.taskId = task.id; body.taskContext = task }
      const res = await apiFetch(`${API_BASE}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (res.ok) {
        if (data.toolResults?.length > 0) setToolActivity(data.toolResults)
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }])
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `**Error:** ${data.error}` }])
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: '**Error:** Failed to connect to AI service.' }])
    } finally {
      setLoading(false)
      setTimeout(scrollToBottom, 50)
    }
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
          <div className="flex items-center justify-between shrink-0" style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--separator)' }}>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4" style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>AI Chat</span>
            </div>
            {onClose && <button onClick={onClose} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }}><X className="w-4 h-4" /></button>}
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
        <div className="flex items-center justify-between shrink-0" style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--separator)' }}>
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
            <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
              {task ? 'AI Assistant' : 'AI Chat'}
            </span>
            {task && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>({task.id})</span>}
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button onClick={handleClear} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Clear">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {onClose && (
              <button onClick={onClose} className="apple-press" style={{ padding: '6px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Close">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: '12px 16px' }}>
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
        {loading && (
          <div className="flex items-start" style={{ marginBottom: '10px' }}>
            <div className="flex items-center gap-2" style={{ background: 'var(--fill-secondary)', padding: '10px 14px', borderRadius: '18px', borderBottomLeftRadius: '6px' }}>
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-app)' }} />
              <span style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>Thinking...</span>
            </div>
          </div>
        )}
        {toolActivity && toolActivity.length > 0 && (
          <div style={{ marginBottom: '10px' }} className="flex flex-wrap gap-1.5">
            {toolActivity.map((t, i) => (
              <span key={i} className="flex items-center gap-1" style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--accent-app)', background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)', padding: '3px 10px', borderRadius: 'var(--radius-full)' }}>
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
      <div className="shrink-0 chat-input-safe" style={{ padding: '8px 12px 12px', borderTop: '0.5px solid var(--separator)' }}>
        <div className="flex items-center gap-1" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-full)', padding: '4px 4px 4px 16px' }}>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={task ? "Ask about this task..." : "Ask the AI assistant..."}
            disabled={loading}
            className="flex-1 bg-transparent focus:outline-none disabled:opacity-50"
            style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', padding: '6px 0' }}
          />
          {input.trim() && (
            <button onClick={handleSend} disabled={loading} className="apple-press flex items-center justify-center text-white disabled:opacity-40" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-app)', flexShrink: 0 }}>
              <Send className="w-[18px] h-[18px]" />
            </button>
          )}
          {!input.trim() && messages.length > 0 && (
            <button onClick={() => { if (window.confirm('Clear AI chat history?')) handleClear() }} className="apple-press flex items-center justify-center" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--fill-secondary)', flexShrink: 0, color: 'var(--text-tertiary)' }} title="Clear chat">
              <Trash2 className="w-[18px] h-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
