import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import { API_BASE } from '../config'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('taskBoardTheme')
    const validThemes = ['dark', 'light', 'oled', 'paper']
    return saved && validThemes.includes(saved) ? saved : 'dark'
  })
  const socketRef = useRef(null)

  // Restore user from localStorage
  useEffect(() => {
    const savedUser = localStorage.getItem('taskBoardUser')
    if (savedUser) setUser(JSON.parse(savedUser))
  }, [])

  // Theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('taskBoardTheme', theme)
  }, [theme])

  // Socket connection
  useEffect(() => {
    if (!user) return
    const socket = io(API_BASE || window.location.origin)
    socketRef.current = socket
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [user])

  const handleLogin = useCallback((userData) => {
    setUser(userData)
    localStorage.setItem('taskBoardUser', JSON.stringify(userData))
  }, [])

  const handleLogout = useCallback(() => {
    setUser(null)
    localStorage.removeItem('taskBoardUser')
  }, [])

  const updateUser = useCallback((updated) => {
    setUser(updated)
    localStorage.setItem('taskBoardUser', JSON.stringify(updated))
  }, [])

  return (
    <AuthContext.Provider value={{ user, theme, setTheme, socketRef, handleLogin, handleLogout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
