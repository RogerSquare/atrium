import { useState, useEffect } from 'react'

// The visible box above the on-screen keyboard (mobile-ui-rework-impl-001).
//
// iOS Safari does NOT shrink the layout viewport when the keyboard opens —
// a fixed inset-0 overlay keeps its full height and everything in the
// covered strip (the terminal's cursor line, most painfully) renders
// invisibly behind the keyboard. iOS also ignores the
// `interactive-widget=resizes-content` viewport hint, so the only fix is
// tracking window.visualViewport and sizing the overlay to it.
//
// Returns `{ top, height }` while something big (the keyboard) covers the
// viewport, `null` otherwise — the >80px threshold ignores URL-bar jitter,
// which 100dvh already handles. Callers fall back to their normal
// full-screen geometry on null, so desktop and keyboard-closed mobile are
// completely unaffected.
export default function useVisualViewport(enabled = true) {
  const [box, setBox] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    const vv = window.visualViewport
    if (!vv) return undefined
    const update = () => {
      const covered = window.innerHeight - vv.height - vv.offsetTop
      setBox(covered > 80 ? { top: Math.round(vv.offsetTop), height: Math.round(vv.height) } : null)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [enabled])
  return box
}
