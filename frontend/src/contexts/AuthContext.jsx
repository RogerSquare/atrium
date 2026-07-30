import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import { API_BASE, SESSION_EXPIRED_EVENT, resetSessionExpiryLatch } from '../config'
import { loadStoredSession, msUntilExpiry } from '../lib/session'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // Surfaced on the login screen so an automatic logout reads as "your
  // session ended" rather than as the app randomly forgetting you.
  const [sessionExpired, setSessionExpired] = useState(false)
  const [theme, setTheme] = useState(() => {
    const validThemes = ['dark', 'light', 'oled', 'paper']
    // One-time hard-flip migration: every existing browser gets bumped to
    // OLED on next load. After the flag is set, future picks from the
    // AvatarPopover stick (the migration only runs once per browser).
    if (localStorage.getItem('taskBoardThemeMigratedToOled') !== '1') {
      localStorage.setItem('taskBoardTheme', 'oled')
      localStorage.setItem('taskBoardThemeMigratedToOled', '1')
      return 'oled'
    }
    const saved = localStorage.getItem('taskBoardTheme')
    return saved && validThemes.includes(saved) ? saved : 'oled'
  })
  const socketRef = useRef(null)

  // Restore user from localStorage — but VALIDATE the token first.
  //
  // This previously parsed and trusted whatever was stored, so a 24-hour-old
  // token looked identical to a fresh one and the board rendered against a
  // dead session until some request happened to fail.
  useEffect(() => {
    const { user: stored, expired, drop } = loadStoredSession(window.localStorage)
    if (drop) {
      try { localStorage.removeItem('taskBoardUser') } catch { /* storage disabled */ }
    }
    if (stored) setUser(stored)
    if (expired) setSessionExpired(true)
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
    setSessionExpired(false)
    // Re-arm the one-shot latch in apiFetch, or the next genuine expiry in
    // this tab would be swallowed as already-announced.
    resetSessionExpiryLatch()
    localStorage.setItem('taskBoardUser', JSON.stringify(userData))
  }, [])

  const handleLogout = useCallback(() => {
    setUser(null)
    setSessionExpired(false)
    localStorage.removeItem('taskBoardUser')
  }, [])

  // Session ended server-side: clear it and say so. Separate from
  // handleLogout because an expiry is not a user action and needs the notice.
  const handleSessionExpired = useCallback(() => {
    setUser((current) => {
      if (!current) return current
      try { localStorage.removeItem('taskBoardUser') } catch { /* storage disabled */ }
      return null
    })
    setSessionExpired(true)
  }, [])

  // React to a 401 observed by apiFetch anywhere in the app.
  useEffect(() => {
    const onExpired = () => handleSessionExpired()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [handleSessionExpired])

  // Pre-empt expiry from the token's own exp, so a board left open overnight
  // returns to the login screen by itself instead of waiting for the user to
  // click something and watch it fail. Fires slightly EARLY so an in-flight
  // request does not race the expiry.
  useEffect(() => {
    if (!user?.token) return
    const remaining = msUntilExpiry(user.token)
    if (remaining === Infinity) return
    // setTimeout clamps above ~24.8 days; nothing here comes close, but a
    // 0-delay for an already-dead token is handled by firing immediately.
    const delay = Math.max(0, remaining - 5000)
    const timer = setTimeout(() => handleSessionExpired(), delay)
    return () => clearTimeout(timer)
  }, [user, handleSessionExpired])

  const updateUser = useCallback((updated) => {
    setUser(updated)
    localStorage.setItem('taskBoardUser', JSON.stringify(updated))
  }, [])

  return (
    <AuthContext.Provider value={{ user, theme, setTheme, socketRef, handleLogin, handleLogout, updateUser, sessionExpired }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
