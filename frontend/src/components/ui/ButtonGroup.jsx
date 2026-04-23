import { Children, cloneElement, isValidElement } from 'react'

export default function ButtonGroup({ children, className = '', style, ...props }) {
  const items = Children.toArray(children).filter(isValidElement)
  const last = items.length - 1

  return (
    <div
      role="group"
      className={`inline-flex items-stretch ${className}`}
      style={{
        background: 'var(--fill-secondary)',
        borderRadius: 'var(--radius-sm)',
        padding: '2px',
        gap: '2px',
        ...style,
      }}
      {...props}
    >
      {items.map((child, i) => {
        const childStyle = {
          borderRadius: i === 0
            ? 'var(--radius-xs) 0 0 var(--radius-xs)'
            : i === last
            ? '0 var(--radius-xs) var(--radius-xs) 0'
            : 0,
          ...(child.props.style || {}),
        }
        return cloneElement(child, {
          key: child.key ?? i,
          pill: false,
          style: childStyle,
        })
      })}
    </div>
  )
}
