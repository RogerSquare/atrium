import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'

const SIZES = {
  sm: { padding: '4px 8px', fontSize: 'var(--text-caption1)' },
  md: { padding: '8px 12px', fontSize: 'var(--text-body)' },
  lg: { padding: '12px 16px', fontSize: 'var(--text-body)' },
}

const Input = forwardRef(({ variant = 'default', size = 'md', loading, disabled, error, className = '', style, ...props }, ref) => {
  const s = SIZES[size] || SIZES.md
  const isDisabled = disabled || loading
  const hasError = variant === 'error' || Boolean(error)
  const borderColor = hasError ? 'var(--apple-red)' : 'var(--border-app)'

  return (
    <div className={`relative flex items-center ${className}`} style={style}>
      <input
        ref={ref}
        disabled={isDisabled}
        aria-invalid={hasError || undefined}
        aria-describedby={error ? `${props.id || ''}-error` : undefined}
        style={{
          ...s,
          width: '100%',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${borderColor}`,
          color: 'var(--text-app)',
          background: 'var(--bg-card)',
          fontWeight: 'var(--font-medium)',
          opacity: isDisabled ? 0.5 : 1,
          cursor: isDisabled ? 'not-allowed' : 'text',
          transition: `border-color var(--duration-fast) var(--ease-default)`,
          paddingRight: loading ? '32px' : undefined,
        }}
        {...props}
      />
      {loading && (
        <Loader2
          className="w-4 h-4 animate-spin absolute right-3"
          style={{ color: 'var(--text-muted)', pointerEvents: 'none' }}
        />
      )}
    </div>
  )
})

Input.displayName = 'Input'
export default Input
