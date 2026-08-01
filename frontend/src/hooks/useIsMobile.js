import { useState, useEffect } from 'react'

// THE mobile breakpoint (ui-mobile-appshell-001). One token instead of the
// old 639/768 mix: Board's tabbed view, AppShell's narrow mode, and the
// index.css media queries all key off 768 — below it the shell runs the
// single-column mobile layout (bottom tab bar, full-screen detail overlay).
export const MOBILE_BREAKPOINT = 768
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT}px)`

export default function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_MEDIA_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY)
    const handler = (e) => setMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return mobile
}
