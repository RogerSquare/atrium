import { useEffect, useRef, useCallback } from 'react'

export default function ModalOverlay({ onClose, children, titleId, ariaLabel }) {
  const overlayRef = useRef(null)
  const contentRef = useRef(null)

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.body.classList.add('modal-open')
    return () => {
      document.body.style.overflow = original
      document.body.classList.remove('modal-open')
    }
  }, [])

  useEffect(() => {
    const node = contentRef.current
    if (!node) return

    const getFocusable = () => node.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )

    const handleTab = (e) => {
      if (e.key !== 'Tab') return
      const focusable = getFocusable()
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus({ preventScroll: true })
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus({ preventScroll: true })
        }
      }
    }

    document.addEventListener('keydown', handleTab)
    return () => document.removeEventListener('keydown', handleTab)
  }, [])

  const handleOverlayClick = useCallback((e) => {
    if (e.target === overlayRef.current || e.target === contentRef.current) onClose()
  }, [onClose])

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId || undefined}
      aria-label={!titleId ? (ariaLabel || 'Dialog') : undefined}
      className="fixed inset-0 flex justify-center items-end sm:items-center z-50 p-0 sm:p-6 animate-fade-in"
      style={{
        background: 'rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <div
        ref={contentRef}
        className="w-full h-full sm:h-auto flex justify-center sm:items-center animate-slide-up"
        onClick={handleOverlayClick}
      >
        {children}
      </div>
    </div>
  )
}
