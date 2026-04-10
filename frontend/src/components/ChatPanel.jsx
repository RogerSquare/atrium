import { useState, useEffect, useRef } from 'react'
import { X, Send, Users, Minus, Volume2, VolumeX, MessageCircle, Sparkles, ImageIcon } from 'lucide-react'
import ChatMessage from './ChatMessage'
import AIChatPanel from './AIChatPanel'
import GifPicker from './GifPicker'

export default function ChatPanel({ user, socket, messages, onlineUsers, typingUsers, minimized, onMinimize, soundEnabled, onToggleSound, onClose, onUnreadChange, onUpdateMessage, aiChatEnabled }) {
  const [input, setInput] = useState('')
  const [showUsers, setShowUsers] = useState(false)
  const [showGifPicker, setShowGifPicker] = useState(false)
  const [activeTab, setActiveTab] = useState('team')
  const messagesEndRef = useRef(null)
  const typingTimeoutRef = useRef(null)
  const prevMessageCountRef = useRef(messages.length)

  const scrollToBottom = () => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }

  useEffect(() => {
    if (messages.length > prevMessageCountRef.current && activeTab === 'team') setTimeout(scrollToBottom, 50)
    prevMessageCountRef.current = messages.length
  }, [messages.length, activeTab])

  useEffect(() => { if (activeTab === 'team') setTimeout(scrollToBottom, 100) }, [activeTab])
  useEffect(() => { if (!minimized && onUnreadChange) onUnreadChange(0) }, [minimized, onUnreadChange])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || !socket) return
    socket.emit('chat_send', { content: trimmed })
    socket.emit('chat_stop_typing')
    setInput('')
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  const handleInputChange = (e) => {
    setInput(e.target.value)
    if (socket) {
      socket.emit('chat_typing', { username: user.username })
      clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = setTimeout(() => { socket?.emit('chat_stop_typing') }, 2000)
    }
  }

  const handleReact = (messageId, emoji) => { if (socket) socket.emit('chat_react', { messageId, emoji, username: user.username }) }
  const handleSendGif = (url) => { if (socket) socket.emit('chat_send_gif', { url, username: user.username }); setShowGifPicker(false) }

  const typingText = typingUsers.filter(u => u !== user.username)
  const typingDisplay = typingText.length > 0 ? `${typingText.join(', ')} ${typingText.length === 1 ? 'is' : 'are'} typing...` : null

  // Minimized pill
  if (minimized) {
    return (
      <div
        className="fixed bottom-4 right-4 z-50 cursor-pointer apple-press apple-hover hidden sm:block"
        onClick={() => onMinimize(false)}
        style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-md)', padding: '10px 16px' }}
      >
        <div className="flex items-center gap-2">
          <span className="animate-gentle-pulse" style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--apple-green)' }} />
          <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>Chat</span>
          <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>({onlineUsers.length})</span>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 sm:inset-auto sm:bottom-4 sm:right-4 z-50 w-full h-full sm:w-[380px] sm:h-[540px] flex flex-col overflow-hidden"
      style={{ background: 'var(--bg-card)', borderRadius: '0', boxShadow: 'var(--shadow-xl)' }}
      ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-xl)' }}
    >
      {/* Header */}
      <div className="shrink-0 vibrancy-thin flex items-center justify-between" style={{ padding: '10px 12px', borderBottom: '0.5px solid var(--separator)', background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)' }}>
        {/* Tabs — segmented control (touch-friendly) */}
        <div className="flex items-center gap-0.5" style={{ padding: '3px', borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
          <button
            onClick={() => setActiveTab('team')}
            className="apple-segment apple-press flex items-center gap-1.5"
            style={{
              padding: '8px 16px', borderRadius: 'var(--radius-sm)', minHeight: '36px',
              fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)',
              color: activeTab === 'team' ? 'var(--text-app)' : 'var(--text-muted)',
              background: activeTab === 'team' ? 'var(--bg-card)' : 'transparent',
              boxShadow: activeTab === 'team' ? 'var(--shadow-sm)' : 'none',
            }}
          >
            <MessageCircle className="w-4 h-4" /> Team
            {activeTab !== 'team' && onlineUsers.length > 0 && (
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>({onlineUsers.length})</span>
            )}
          </button>
          {aiChatEnabled && (
            <button
              onClick={() => setActiveTab('ai')}
              className="apple-segment apple-press flex items-center gap-1.5"
              style={{
                padding: '8px 16px', borderRadius: 'var(--radius-sm)', minHeight: '36px',
                fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)',
                color: activeTab === 'ai' ? 'var(--text-app)' : 'var(--text-muted)',
                background: activeTab === 'ai' ? 'var(--bg-card)' : 'transparent',
                boxShadow: activeTab === 'ai' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <Sparkles className="w-4 h-4" /> AI
            </button>
          )}
        </div>

        {/* Controls (44px touch targets) */}
        <div className="flex items-center gap-1">
          {activeTab === 'team' && (
            <>
              <button onClick={() => setShowUsers(!showUsers)} className="apple-press" style={{ padding: '10px', borderRadius: 'var(--radius-sm)', color: showUsers ? 'var(--accent-app)' : 'var(--text-muted)', transition: `all var(--duration-fast)` }} title="Online users">
                <Users className="w-5 h-5" />
              </button>
              <button onClick={onToggleSound} className="apple-press" style={{ padding: '10px', borderRadius: 'var(--radius-sm)', color: soundEnabled ? 'var(--text-muted)' : 'var(--apple-red)', transition: `all var(--duration-fast)` }} title={soundEnabled ? 'Mute' : 'Unmute'}>
                {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </button>
            </>
          )}
          <button onClick={() => onMinimize(true)} className="hidden sm:block apple-press" style={{ padding: '10px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Minimize">
            <Minus className="w-5 h-5" />
          </button>
          <button onClick={onClose} className="apple-press" style={{ padding: '10px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }} title="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Team Chat */}
      {activeTab === 'team' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {showUsers && (
            <div style={{ padding: '8px 16px', borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
              <p style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Online</p>
              {onlineUsers.map((u, i) => (
                <div key={i} className="flex items-center gap-2" style={{ padding: '3px 0' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)' }} />
                  <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>{u.username}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: '12px 16px' }}>
            {messages.length === 0 && (
              <div className="text-center" style={{ marginTop: '32px', fontSize: 'var(--text-subhead)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No messages yet. Say hello!</div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} currentUser={user.username} onReact={handleReact} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {typingDisplay && (
            <div style={{ padding: '0 16px 4px' }}>
              <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{typingDisplay}</span>
            </div>
          )}

          <div className="relative chat-input-safe" style={{ padding: '8px 12px 12px', borderTop: '0.5px solid var(--separator)' }}>
            {showGifPicker && <GifPicker onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />}
            <div className="flex items-center gap-1" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-full)', padding: '4px 4px 4px 16px' }}>
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-transparent focus:outline-none"
                style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', padding: '6px 0' }}
              />
              <button onClick={() => setShowGifPicker(!showGifPicker)} className="apple-press" style={{ padding: '10px', borderRadius: '50%', color: showGifPicker ? 'var(--accent-app)' : 'var(--text-tertiary)', transition: `color var(--duration-fast)` }} title="GIF">
                <ImageIcon className="w-5 h-5" />
              </button>
              {input.trim() && (
                <button onClick={handleSend} className="apple-press flex items-center justify-center text-white" style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'var(--accent-app)', transition: `all var(--duration-fast)`, flexShrink: 0 }}>
                  <Send className="w-[18px] h-[18px]" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Chat Tab */}
      {activeTab === 'ai' && (
        <div className="flex-1 overflow-hidden">
          <AIChatPanel user={user} compact noHeader aiChatEnabled={aiChatEnabled} />
        </div>
      )}
    </div>
  )
}
