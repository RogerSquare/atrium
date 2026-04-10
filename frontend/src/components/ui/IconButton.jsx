import { forwardRef } from 'react'

const SIZES = {
  sm: { width: '28px', height: '28px', padding: '4px' },
  md: { width: '34px', height: '34px', padding: '6px' },
}

const IconButton = forwardRef(({ size = 'md', color, disabled, 'aria-label': ariaLabel, children, className = '', style, ...props }, ref) => {
  const s = SIZES[size] || SIZES.md

  return (
    <button
      ref={ref}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`apple-press flex items-center justify-center shrink-0 ${className}`}
      style={{
        ...s,
        borderRadius: 'var(--radius-sm)',
        color: color || 'var(--text-muted)',
        background: 'transparent',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `all var(--duration-fast) var(--ease-default)`,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  )
})

IconButton.displayName = 'IconButton'
export default IconButton
