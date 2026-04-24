import { forwardRef, useEffect, useRef } from 'react'
import { Check, Minus } from 'lucide-react'

const Checkbox = forwardRef(({ checked, indeterminate, disabled, error, onChange, className = '', style, 'aria-label': ariaLabel, ...props }, ref) => {
  const localRef = useRef(null)
  const setRefs = (node) => {
    localRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }

  useEffect(() => {
    if (localRef.current) localRef.current.indeterminate = Boolean(indeterminate)
  }, [indeterminate])

  const active = checked || indeterminate
  const borderColor = error ? 'var(--apple-red)' : active ? 'var(--accent-app)' : 'var(--border-app)'
  const bg = error && active ? 'var(--apple-red)' : active ? 'var(--accent-app)' : 'var(--bg-card)'

  return (
    <label
      className={`inline-flex items-center justify-center shrink-0 relative ${className}`}
      style={{
        width: '16px',
        height: '16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <input
        ref={setRefs}
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={onChange}
        aria-label={ariaLabel}
        aria-invalid={error || undefined}
        className="absolute inset-0 opacity-0 cursor-[inherit]"
        style={{ margin: 0 }}
        {...props}
      />
      <span
        aria-hidden="true"
        className="flex items-center justify-center"
        style={{
          width: '16px',
          height: '16px',
          borderRadius: 'var(--radius-sm)',
          border: `1px solid ${borderColor}`,
          background: bg,
          transition: `background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)`,
        }}
      >
        {indeterminate ? (
          <Minus style={{ width: '12px', height: '12px', color: 'white', strokeWidth: 3 }} />
        ) : checked ? (
          <Check style={{ width: '12px', height: '12px', color: 'white', strokeWidth: 3 }} />
        ) : null}
      </span>
    </label>
  )
})

Checkbox.displayName = 'Checkbox'
export default Checkbox
