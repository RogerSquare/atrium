import Input from '../Input'

export default {
  title: 'UI/Input',
  component: Input,
  argTypes: {
    variant: { control: 'select', options: ['default', 'error'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
}

export const Default = { args: { placeholder: 'Task title…' } }
export const Small = { args: { size: 'sm', placeholder: 'Small input' } }
export const Large = { args: { size: 'lg', placeholder: 'Large input' } }
export const Error = { args: { variant: 'error', defaultValue: 'invalid-id-format' } }
export const Loading = { args: { loading: true, defaultValue: 'Saving…' } }
export const Disabled = { args: { disabled: true, defaultValue: 'locked' } }

export const AllSizes = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '320px' }}>
    <Input size="sm" placeholder="Small" />
    <Input size="md" placeholder="Medium (default)" />
    <Input size="lg" placeholder="Large" />
    <Input variant="error" defaultValue="invalid" />
    <Input loading defaultValue="Saving…" />
    <Input disabled defaultValue="locked" />
  </div>
)
