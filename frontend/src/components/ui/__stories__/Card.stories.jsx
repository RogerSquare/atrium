import Card from '../Card'

export default {
  title: 'UI/Card',
  component: Card,
  argTypes: {
    variant: { control: 'select', options: ['surface', 'compact', 'column', 'flat'] },
    selected: { control: 'boolean' },
    elevated: { control: 'boolean' },
  },
}

export const Surface = () => (
  <Card variant="surface">
    <h3 style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Surface Card</h3>
    <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', marginTop: '8px' }}>Default card with shadow and rounded corners.</p>
  </Card>
)

export const WithAccent = () => (
  <Card variant="surface" accent="var(--apple-red)">
    <h3 style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>High Priority Task</h3>
    <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', marginTop: '8px' }}>Card with left accent stripe.</p>
  </Card>
)

export const Selected = () => (
  <Card variant="surface" selected accent="var(--apple-blue)">
    <h3 style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Selected Card</h3>
    <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', marginTop: '8px' }}>Shows selection ring.</p>
  </Card>
)

export const Compact = () => (
  <Card variant="compact" accent="var(--apple-orange)">
    <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>Compact single-line card</span>
  </Card>
)

export const Column = () => (
  <Card variant="column" style={{ minWidth: '280px' }}>
    <h4 style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Column Container</h4>
    <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', marginTop: '8px' }}>Used for kanban columns.</p>
  </Card>
)

export const AllVariants = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '400px' }}>
    <Card variant="surface" accent="var(--apple-red)"><span>Surface with accent</span></Card>
    <Card variant="compact" accent="var(--apple-orange)"><span>Compact</span></Card>
    <Card variant="surface" selected><span>Selected</span></Card>
    <Card variant="surface" elevated><span>Elevated</span></Card>
    <Card variant="column"><span>Column</span></Card>
    <Card variant="flat"><span>Flat</span></Card>
  </div>
)
