import Checkbox from '../Checkbox'
import { useState } from 'react'

export default {
  title: 'UI/Checkbox',
  component: Checkbox,
  argTypes: {
    checked: { control: 'boolean' },
    indeterminate: { control: 'boolean' },
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
  },
}

export const Unchecked = { args: { checked: false } }
export const Checked = { args: { checked: true } }
export const Indeterminate = { args: { indeterminate: true } }
export const DisabledChecked = { args: { checked: true, disabled: true } }
export const Error = { args: { checked: true, error: true } }

export const Interactive = () => {
  const [checked, setChecked] = useState(false)
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
      <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} />
      <span style={{ fontSize: 'var(--text-body)', color: 'var(--text-app)' }}>Toggle me</span>
    </label>
  )
}

export const AllStates = () => (
  <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
    <Checkbox />
    <Checkbox checked />
    <Checkbox indeterminate />
    <Checkbox checked disabled />
    <Checkbox checked error />
  </div>
)
