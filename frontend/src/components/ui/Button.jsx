import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary: {
    color: 'white',
    background: 'var(--accent-app)',
  },
  secondary: {
    color: 'var(--accent-app)',
    background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)',
  },
  ghost: {
    color: 'var(--text-muted)',
    background: 'var(--fill-secondary)',
  },
  danger: {
    color: 'var(--apple-red)',
    background: 'transparent',
  },
  'danger-filled': {
    color: 'white',
    background: 'var(--apple-red)',
  },
}

const SIZES = {
  sm: {
    padding: '4px 10px',
    fontSize: 'var(--text-caption2)',
  },
  md: {
    padding: '6px 12px',
    fontSize: 'var(--text-caption1)',
  },
}

const Button = forwardRef(({ variant = 'ghost', size = 'md', pill = true, loading, disabled, children, className = '', style, ...props }, ref) => {
  const v = VARIANTS[variant] || VARIANTS.ghost
  const s = SIZES[size] || SIZES.md
  const isDisabled = disabled || loading

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={`apple-press flex items-center gap-1.5 ${className}`}
      style={{
        ...s,
        borderRadius: pill ? 'var(--radius-full)' : 'var(--radius-sm)',
        fontWeight: 'var(--font-semibold)',
        color: v.color,
        background: v.background,
        opacity: isDisabled ? 0.5 : 1,
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        border: 'none',
        transition: `all var(--duration-fast) var(--ease-default)`,
        ...style,
      }}
      {...props}
    >
      {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {children}
    </button>
  )
})

Button.displayName = 'Button'
export default Button
