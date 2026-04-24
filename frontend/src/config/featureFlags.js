// Facelift initiative feature flags (see tasks/Atrium/ui-facelift-*).
//
// Phase 10 (2026-04-24) flipped DEFAULT_ENABLED to true — the facelift shell
// is now the default experience. Users who want the legacy sidebar+board
// can opt out via `localStorage.atriumFacelift = 'false'`.
//
// Dev toggles:
//   localStorage.atriumFacelift = 'true'   → force facelift on (rarely needed)
//   localStorage.atriumFacelift = 'false'  → force legacy shell
//   localStorage.removeItem('atriumFacelift')  → use the default (true)

const DEFAULT_ENABLED = true

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
