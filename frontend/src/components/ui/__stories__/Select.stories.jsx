import Select from '../Select'

export default {
  title: 'UI/Select',
  component: Select,
  argTypes: {
    pill: { control: 'boolean' },
    active: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
}

export const Default = () => (
  <Select defaultValue="medium">
    <option value="low">Low</option>
    <option value="medium">Medium</option>
    <option value="high">High</option>
  </Select>
)

export const Pill = () => (
  <Select pill defaultValue="none">
    <option value="none">No swimlanes</option>
    <option value="assignee">Assignee</option>
    <option value="type">Type</option>
  </Select>
)

export const Active = () => (
  <Select pill active defaultValue="assignee">
    <option value="none">No swimlanes</option>
    <option value="assignee">Assignee</option>
  </Select>
)

export const Disabled = () => (
  <Select disabled defaultValue="">
    <option value="" disabled>Priority</option>
    <option value="low">Low</option>
  </Select>
)
