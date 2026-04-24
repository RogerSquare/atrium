// Facelift initiative feature flags (see tasks/Atrium/ui-facelift-*).
//
// Phase 1 ships new tokens + libraries but gates the new shell, detail pane,
// palette, and motion layer behind FACELIFT_SHELL_ENABLED. Every subsequent
// phase adds code behind this flag until Phase 10 flips the default to true.
//
// Dev toggle: run `localStorage.atriumFacelift = 'true'` in the browser console
// and reload. Run `localStorage.removeItem('atriumFacelift')` to turn off.

const DEFAULT_ENABLED = false

function readLocalStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null
  try {
    return window.localStorage.getItem('atriumFacelift')
  } catch {
    return null
  }
}

export function faceliftShellEnabled() {
  const stored = readLocalStorage()
  if (stored === 'true') return true
  if (stored === 'false') return false
  return DEFAULT_ENABLED
}

// Eager-read snapshot for modules that only need the initial value.
// Consumers that want to react to localStorage changes should call
// faceliftShellEnabled() on each render.
export const FACELIFT_SHELL_ENABLED = faceliftShellEnabled()
