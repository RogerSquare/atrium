import Avatar from '../Avatar'
import { User } from 'lucide-react'

export default {
  title: 'UI/Avatar',
  component: Avatar,
  argTypes: {
    size: { control: 'select', options: ['xs', 'sm', 'md'] },
  },
}

export const Initials = { args: { alt: 'Roger Square', size: 'sm' } }
export const FromAgent = { args: { alt: 'agent:claude-opus-4-7', size: 'sm' } }
export const Image = { args: { src: 'https://i.pravatar.cc/64?u=atrium', alt: 'Roger', size: 'md' } }
export const Icon = { args: { icon: <User className="w-3 h-3" />, size: 'sm' } }
export const Xs = { args: { alt: 'Roger Square', size: 'xs' } }

export const AllSizes = () => (
  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
    <Avatar size="xs" alt="Roger Square" />
    <Avatar size="sm" alt="Roger Square" />
    <Avatar size="md" alt="Roger Square" />
    <Avatar size="sm" alt="agent:claude-opus-4-7" />
    <Avatar size="sm" icon={<User className="w-3 h-3" />} />
  </div>
)
