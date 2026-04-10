import Button from '../Button'
import { Trash2, Plus, CheckSquare } from 'lucide-react'

export default {
  title: 'UI/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger', 'danger-filled'] },
    size: { control: 'select', options: ['sm', 'md'] },
    pill: { control: 'boolean' },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
}

export const Primary = { args: { variant: 'primary', children: 'New Task' } }
export const Secondary = { args: { variant: 'secondary', children: 'Select' } }
export const Ghost = { args: { variant: 'ghost', children: 'Compact' } }
export const Danger = { args: { variant: 'danger', children: [<Trash2 key="i" className="w-3.5 h-3.5" />, 'Delete'] } }
export const DangerFilled = { args: { variant: 'danger-filled', size: 'sm', children: 'Confirm' } }
export const Loading = { args: { variant: 'primary', loading: true, children: 'Saving...' } }
export const Small = { args: { variant: 'ghost', size: 'sm', children: 'To Do' } }
export const WithIcon = { args: { variant: 'primary', children: [<Plus key="i" className="w-4 h-4" />, 'New Task'] } }

export const AllVariants = () => (
  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
    <Button variant="primary"><Plus className="w-4 h-4" /> Primary</Button>
    <Button variant="secondary"><CheckSquare className="w-3.5 h-3.5" /> Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger"><Trash2 className="w-3.5 h-3.5" /> Danger</Button>
    <Button variant="danger-filled" size="sm">Confirm</Button>
    <Button variant="primary" loading>Loading</Button>
    <Button variant="ghost" disabled>Disabled</Button>
  </div>
)
