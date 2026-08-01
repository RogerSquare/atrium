// Feature flags (ui-shell-consolidation-001).
//
// The facelift shell flag (`atriumFacelift`) is GONE: AppShell is the only
// shell now — the legacy AppContent path it gated was deleted after the
// 4a-4c parity work landed. Any stored atriumFacelift value is simply ignored.
//
// Design Studio is PARKED per accepted default Q9: not ported to a nav entry,
// but still mountable for the occasional session that needs it:
//   localStorage.atriumDesignStudio = 'true'   (then reload)
//   localStorage.removeItem('atriumDesignStudio')  → parked again

export function designStudioEnabled() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    return window.localStorage.getItem('atriumDesignStudio') === 'true'
  } catch {
    return false
  }
}
