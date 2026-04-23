import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

const SIZES = {
  sm: { width: '28px', height: '28px', padding: '4px', spinner: 'w-3.5 h-3.5' },
  md: { width: '34px', height: '34px', padding: '6px', spinner: 'w-4 h-4' },
}

const IconButton = forwardRef(({ size = 'md', color, loading, disabled, 'aria-label': ariaLabel, children, className = '', style, ...props }, ref) => {
  const s = SIZES[size] || SIZES.md
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={`apple-press flex items-center justify-center shrink-0 ${className}`}
      style={{
        width: s.width,
        height: s.height,
        padding: s.padding,
        borderRadius: 'var(--radius-sm)',
        color: color || 'var(--text-muted)',
        background: 'transparent',
        border: 'none',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.5 : 1,
        transition: `all var(--duration-fast) var(--ease-default)`,
        ...style,
      }}
      {...props}
    >
      {loading ? <Loader2 className={`${s.spinner} animate-spin`} /> : children}
    </button>
  )
})

IconButton.displayName = 'IconButton'
export default IconButton
