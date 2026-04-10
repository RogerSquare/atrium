import Badge from '../Badge'
import { Clock, Loader2, CalendarClock } from 'lucide-react'

export default {
  title: 'UI/Badge',
  component: Badge,
  argTypes: {
    preset: { control: 'select', options: ['priority', 'status', 'type', 'muted', 'accent'] },
    value: { control: 'text' },
  },
}

export const Priority = () => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <Badge preset="priority" value="high">High</Badge>
    <Badge preset="priority" value="medium">Medium</Badge>
    <Badge preset="priority" value="low">Low</Badge>
  </div>
)

export const Status = () => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <Badge preset="status" value="todo">To Do</Badge>
    <Badge preset="status" value="in_progress">In Progress</Badge>
    <Badge preset="status" value="review">Review</Badge>
    <Badge preset="status" value="done">Done</Badge>
  </div>
)

export const Type = () => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <Badge preset="type" value="frontend">frontend</Badge>
    <Badge preset="type" value="backend">backend</Badge>
    <Badge preset="type" value="fullstack">fullstack</Badge>
    <Badge preset="type" value="devops">devops</Badge>
  </div>
)

export const WithIcons = () => (
  <div style={{ display: 'flex', gap: '8px' }}>
    <Badge color="var(--apple-orange)" bg="color-mix(in srgb, var(--apple-orange) 10%, transparent)" className="flex items-center gap-1" style={{ padding: '3px 8px' }}>
      <Clock className="w-3 h-3" />Stale
    </Badge>
    <Badge color="var(--accent-app)" bg="color-mix(in srgb, var(--accent-app) 10%, transparent)" className="flex items-center gap-1" style={{ padding: '3px 8px' }}>
      <Loader2 className="w-3 h-3 animate-spin" />Agent
    </Badge>
    <Badge color="var(--apple-green)" bg="color-mix(in srgb, var(--apple-green) 10%, transparent)" className="flex items-center gap-1" style={{ padding: '3px 8px' }}>
      <CalendarClock className="w-3 h-3" />3d
    </Badge>
  </div>
)

export const Accent = { args: { preset: 'accent', children: '12' } }
export const Muted = { args: { preset: 'muted', children: 'fullstack' } }
