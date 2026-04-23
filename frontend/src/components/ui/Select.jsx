import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

const Select = forwardRef(({ pill = false, active, loading, disabled, fullWidth, containerClassName = '', className = '', style, children, ...props }, ref) => {
  const isDisabled = disabled || loading

  return (
    <div className={`relative ${fullWidth ? 'flex' : 'inline-flex'} items-center ${containerClassName}`}>
      <select
        ref={ref}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        className={className}
        style={{
          padding: pill ? 'var(--space-1) var(--space-2)' : 'var(--space-1) var(--space-2)',
          paddingRight: loading ? 'var(--space-7)' : undefined,
          borderRadius: pill ? 'var(--radius-full)' : 'var(--radius-sm)',
          fontSize: 'var(--text-caption1)',
          fontWeight: 'var(--font-medium)',
          border: 'none',
          color: active ? 'var(--accent-app)' : 'var(--text-muted)',
          background: active ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'var(--fill-secondary)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
          transition: `all var(--duration-fast) var(--ease-default)`,
          ...style,
        }}
        {...props}
      >
        {children}
      </select>
      {loading && (
        <Loader2 className="w-3.5 h-3.5 animate-spin absolute right-2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      )}
    </div>
  )
})

Select.displayName = 'Select'
export default Select
