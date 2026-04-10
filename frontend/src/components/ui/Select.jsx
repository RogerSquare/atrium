import { forwardRef } from 'react'

const Select = forwardRef(({ pill = false, active, disabled, className = '', style, children, ...props }, ref) => {
  return (
    <select
      ref={ref}
      disabled={disabled}
      className={`cursor-pointer focus:outline-none ${className}`}
      style={{
        padding: pill ? '5px 10px' : '6px 10px',
        borderRadius: pill ? 'var(--radius-full)' : 'var(--radius-sm)',
        fontSize: 'var(--text-caption1)',
        fontWeight: 'var(--font-medium)',
        border: 'none',
        color: active ? 'var(--accent-app)' : 'var(--text-muted)',
        background: active ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'var(--fill-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        outline: 'none',
        transition: `all var(--duration-fast) var(--ease-default)`,
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  )
})

Select.displayName = 'Select'
export default Select
