import { PRIORITY_COLOR, STATUS_COLOR, TYPE_STYLE, E2E_STATUS_COLOR } from '../../constants'

const PRESETS = {
  priority: (value) => ({
    color: PRIORITY_COLOR[value] || PRIORITY_COLOR.medium,
    background: `color-mix(in srgb, ${PRIORITY_COLOR[value] || PRIORITY_COLOR.medium} 10%, transparent)`,
    textTransform: 'capitalize',
  }),
  status: (value) => ({
    color: STATUS_COLOR[value] || 'var(--text-muted)',
    background: `color-mix(in srgb, ${STATUS_COLOR[value] || 'var(--gray-1)'} 12%, transparent)`,
  }),
  type: (value) => {
    const t = TYPE_STYLE[value] || TYPE_STYLE.fullstack
    return { color: t.color, background: t.bg, textTransform: 'uppercase' }
  },
  e2e: (value) => {
    const c = E2E_STATUS_COLOR[value] || E2E_STATUS_COLOR.pending
    return {
      color: c,
      background: `color-mix(in srgb, ${c} 12%, transparent)`,
    }
  },
  muted: () => ({
    color: 'var(--text-tertiary)',
    background: 'var(--fill-secondary)',
  }),
  accent: () => ({
    color: 'white',
    background: 'var(--accent-app)',
  }),
}

export default function Badge({ preset, value, color, bg, children, className = '', style, ...props }) {
  const presetStyle = preset && PRESETS[preset] ? PRESETS[preset](value) : {}

  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--text-caption2)',
        fontWeight: 'var(--font-semibold)',
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
        ...presetStyle,
        ...(color ? { color } : {}),
        ...(bg ? { background: bg } : {}),
        ...style,
      }}
      {...props}
    >
      {children || value}
    </span>
  )
}
