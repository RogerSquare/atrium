import { useState, useEffect, useRef } from 'react'
import { X, Send, Users, Minus, Volume2, VolumeX, MessageCircle, Sparkles, ImageIcon } from 'lucide-react'
import ChatMessage from './ChatMessage'
import AIChatPanel from './AIChatPanel'
import GifPicker from './GifPicker'
import { Button, IconButton, ButtonGroup } from './ui'

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
        style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)', padding: 'var(--space-2) var(--space-4)' }}
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
      style={{ background: 'var(--bg-card)', borderRadius: '0', boxShadow: 'var(--shadow-popover)' }}
      ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-xl)' }}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between" style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: 'var(--border-hairline)', background: 'var(--bg-card)' }}>
        {/* Tabs — segmented control (touch-friendly) */}
        <ButtonGroup>
          <Button
            variant={activeTab === 'team' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('team')}
          >
            <MessageCircle className="w-4 h-4" /> Team
            {activeTab !== 'team' && onlineUsers.length > 0 && (
              <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>({onlineUsers.length})</span>
            )}
          </Button>
          {aiChatEnabled && (
            <Button
              variant={activeTab === 'ai' ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('ai')}
            >
              <Sparkles className="w-4 h-4" /> AI
            </Button>
          )}
        </ButtonGroup>

        {/* Controls (44px touch targets) */}
        <div className="flex items-center gap-1">
          {activeTab === 'team' && (
            <>
              <IconButton
                onClick={() => setShowUsers(!showUsers)}
                color={showUsers ? 'var(--accent-app)' : 'var(--text-muted)'}
                title="Online users"
                aria-label="Online users"
              >
                <Users className="w-5 h-5" />
              </IconButton>
              <IconButton
                onClick={onToggleSound}
                color={soundEnabled ? 'var(--text-muted)' : 'var(--apple-red)'}
                title={soundEnabled ? 'Mute' : 'Unmute'}
                aria-label={soundEnabled ? 'Mute' : 'Unmute'}
              >
                {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </IconButton>
            </>
          )}
          <IconButton
            onClick={() => onMinimize(true)}
            className="hidden sm:flex"
            title="Minimize"
            aria-label="Minimize"
          >
            <Minus className="w-5 h-5" />
          </IconButton>
          <IconButton onClick={onClose} title="Close" aria-label="Close">
            <X className="w-5 h-5" />
          </IconButton>
        </div>
      </div>

      {/* Team Chat */}
      {activeTab === 'team' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {showUsers && (
            <div style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
              <p style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Online</p>
              {onlineUsers.map((u, i) => (
                <div key={i} className="flex items-center gap-2" style={{ padding: 'var(--space-1) 0' }}>
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)' }} />
                  <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>{u.username}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-3) var(--space-4)' }}>
            {messages.length === 0 && (
              <div className="text-center" style={{ marginTop: 'var(--space-8)', fontSize: 'var(--text-subhead)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No messages yet. Say hello!</div>
            )}
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} currentUser={user.username} onReact={handleReact} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {typingDisplay && (
            <div style={{ padding: '0 var(--space-4) var(--space-1)' }}>
              <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>{typingDisplay}</span>
            </div>
          )}

          <div className="relative chat-input-safe" style={{ padding: 'var(--space-2) var(--space-3) var(--space-3)', borderTop: '0.5px solid var(--separator)' }}>
            {showGifPicker && <GifPicker onSelect={handleSendGif} onClose={() => setShowGifPicker(false)} />}
            <div className="flex items-center gap-1" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-full)', padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-4)' }}>
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                className="flex-1 bg-transparent focus:outline-none"
                style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', padding: 'var(--space-2) 0' }}
              />
              <IconButton
                onClick={() => setShowGifPicker(!showGifPicker)}
                color={showGifPicker ? 'var(--accent-app)' : 'var(--text-tertiary)'}
                style={{ borderRadius: '50%' }}
                title="GIF"
                aria-label="GIF"
              >
                <ImageIcon className="w-5 h-5" />
              </IconButton>
              {input.trim() && (
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
