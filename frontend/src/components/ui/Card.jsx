import { forwardRef } from 'react'

const VARIANTS = {
  surface: {
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
  },
  compact: {
    background: 'var(--bg-card)',
    boxShadow: 'var(--shadow-sm)',
    borderRadius: 'var(--radius-md)',
    padding: '8px 12px',
  },
  column: {
    background: 'var(--bg-secondary)',
    boxShadow: 'var(--shadow-sm)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4)',
  },
  flat: {
    background: 'transparent',
    boxShadow: 'none',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
  },
}

const Card = forwardRef(({ variant = 'surface', accent, selected, elevated, className = '', style, children, ...props }, ref) => {
  const v = VARIANTS[variant] || VARIANTS.surface

  const shadow = elevated ? 'var(--shadow-xl)'
    : selected ? `0 0 0 2px color-mix(in srgb, var(--accent-app) 40%, transparent), var(--shadow-md)`
    : v.boxShadow

  return (
    <div
      ref={ref}
      className={`flex flex-col ${className}`}
      style={{
        ...v,
        boxShadow: shadow,
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        transition: `box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-spring)`,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  )
})

Card.displayName = 'Card'
export default Card
