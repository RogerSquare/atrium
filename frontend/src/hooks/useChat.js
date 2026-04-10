import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, apiFetch } from '../config'

export default function useChat(user, socketRef) {
  const [showChat, setShowChat] = useState(() => localStorage.getItem('taskBoardChatOpen') === 'true')
  const [chatMinimized, setChatMinimized] = useState(false)
  const [chatUnread, setChatUnread] = useState(0)
  const [chatMessages, setChatMessages] = useState([])
  const [chatOnlineUsers, setChatOnlineUsers] = useState([])
  const [chatTypingUsers, setChatTypingUsers] = useState([])
  const [chatSoundEnabled, setChatSoundEnabled] = useState(() => localStorage.getItem('taskBoardChatSound') !== 'false')
  const [toastQueue, setToastQueue] = useState([])

  const chatJoinedRef = useRef(false)
  const showChatRef = useRef(showChat)
  const chatMinimizedRef = useRef(chatMinimized)

  // Keep refs in sync for use inside socket callbacks
  useEffect(() => { showChatRef.current = showChat }, [showChat])
  useEffect(() => { chatMinimizedRef.current = chatMinimized }, [chatMinimized])

  useEffect(() => {
    localStorage.setItem('taskBoardChatOpen', showChat)
  }, [showChat])

  useEffect(() => {
    localStorage.setItem('taskBoardChatSound', chatSoundEnabled)
  }, [chatSoundEnabled])

  const playNotificationSound = useCallback(() => {
    if (!chatSoundEnabled) return
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.setValueAtTime(800, ctx.currentTime)
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1)
      gain.gain.setValueAtTime(0.08, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    } catch (e) { /* ignore audio errors */ }
  }, [chatSoundEnabled])

  const sendBrowserNotification = useCallback((title, body) => {
    if (document.hasFocus()) return
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.svg' })
    }
  }, [])

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const handleToggleChat = useCallback(() => {
    setShowChat(prev => {
      if (!prev) setChatUnread(0)
      return !prev
    })
    setChatMinimized(false)
  }, [])

  const dismissToast = useCallback((msgId) => {
    setToastQueue(prev => prev.filter(m => m.id !== msgId))
  }, [])

  const openChat = useCallback(() => {
    setShowChat(true)
    setChatMinimized(false)
    setChatUnread(0)
  }, [])

  // Load chat history and register socket listeners
  useEffect(() => {
    if (!user) return
    const socket = socketRef.current
    if (!socket) return

    // Load message history
    apiFetch(`${API_BASE}/api/chat/messages`)
      .then(res => res.json())
      .then(data => setChatMessages(data))
      .catch(console.error)

    if (!chatJoinedRef.current) {
      socket.emit('chat_join', { username: user.username })
      chatJoinedRef.current = true
    }

    const onMessage = (msg) => {
      setChatMessages(prev => [...prev, msg])
      const isFromOther = msg.type === 'user' && msg.username !== user.username
      if (isFromOther) {
        const chatVisible = showChatRef.current && !chatMinimizedRef.current
        if (!chatVisible) {
          setChatUnread(prev => prev + 1)
          setToastQueue(prev => [...prev, msg])
          playNotificationSound()
          sendBrowserNotification(`${msg.username}`, msg.content)
        }
      }
    }

    const onReaction = (data) => {
      setChatMessages(prev => prev.map(m =>
        m.id === data.messageId ? { ...m, reactions: data.reactions } : m
      ))
    }

    const onUsers = (users) => setChatOnlineUsers(users)

    const onTyping = (data) => {
      setChatTypingUsers(prev => {
        if (!prev.includes(data.username)) return [...prev, data.username]
        return prev
      })
    }

    const onStopTyping = (data) => {
      setChatTypingUsers(prev => prev.filter(u => u !== data.username))
    }

    socket.on('chat_message', onMessage)
    socket.on('chat_reaction', onReaction)
    socket.on('chat_users', onUsers)
    socket.on('chat_typing', onTyping)
    socket.on('chat_stop_typing', onStopTyping)

    return () => {
      socket.off('chat_message', onMessage)
      socket.off('chat_reaction', onReaction)
      socket.off('chat_users', onUsers)
      socket.off('chat_typing', onTyping)
      socket.off('chat_stop_typing', onStopTyping)
      chatJoinedRef.current = false
    }
  }, [user, socketRef.current, playNotificationSound, sendBrowserNotification])

  return {
    showChat,
    setShowChat,
    chatMinimized,
    setChatMinimized,
    chatUnread,
    setChatUnread,
    chatMessages,
    chatOnlineUsers,
    chatTypingUsers,
    chatSoundEnabled,
    setChatSoundEnabled,
    toastQueue,
    handleToggleChat,
    dismissToast,
    openChat,
  }
}
