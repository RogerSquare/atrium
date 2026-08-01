// App root (ui-shell-consolidation-001).
//
// Atrium used to ship TWO complete shells: the legacy sidebar+board
// `AppContent` (defined here, ~430 LOC) and the facelift `AppShell`, switched
// by the `atriumFacelift` localStorage flag. Every UI change doubled. The
// legacy path was deleted once AppShell reached feature parity (topbar
// create/help, approvals inbox, de-jargoned creation, chat dock, preview,
// bulk bar, undo/redo, archive) — AppShell is the only shell now.
//
// This file is deliberately thin: providers + the login gate.

import AppShell from './components/shell/AppShell'
import Login from './components/Login'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { TaskProvider } from './contexts/TaskContext'

function AppInner() {
  const { user, handleLogin, socketRef, sessionExpired } = useAuth()
  // sessionExpired tells Login to explain the automatic logout, so it does not
  // look like the app forgot the user for no reason.
  if (!user) return <Login onLogin={handleLogin} sessionExpired={sessionExpired} />
  return (
    <TaskProvider user={user} socketRef={socketRef}>
      <AppShell />
    </TaskProvider>
  )
}

export default function AppRoot() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
