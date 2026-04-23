import { forwardRef } from 'react'

const SIZES = {
  xs: { width: '20px', height: '20px', fontSize: 'var(--text-caption2)' },
  sm: { width: '28px', height: '28px', fontSize: 'var(--text-caption1)' },
  md: { width: '36px', height: '36px', fontSize: 'var(--text-footnote)' },
}

function deriveInitials(value) {
  if (!value) return ''
  const cleaned = String(value).replace(/^agent:/i, '').trim()
  const parts = cleaned.split(/[\s_-]+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const Avatar = forwardRef(({ size = 'sm', src, alt, initials, icon, color, background, className = '', style, ...props }, ref) => {
  const s = SIZES[size] || SIZES.sm
  const resolvedInitials = initials || deriveInitials(alt)

  return (
    <span
      ref={ref}
      aria-label={alt || undefined}
      className={`inline-flex items-center justify-center shrink-0 overflow-hidden ${className}`}
      style={{
        ...s,
        borderRadius: 'var(--radius-full)',
        color: color || 'var(--text-muted)',
        background: background || 'var(--fill-secondary)',
        fontWeight: 'var(--font-semibold)',
        lineHeight: 1,
        ...style,
      }}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt || ''} className="w-full h-full object-cover" />
      ) : icon ? (
        icon
      ) : (
        resolvedInitials
      )}
    </span>
  )
})

Avatar.displayName = 'Avatar'
export default Avatar
