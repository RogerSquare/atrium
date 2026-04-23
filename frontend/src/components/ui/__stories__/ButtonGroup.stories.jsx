import ButtonGroup from '../ButtonGroup'
import Button from '../Button'
import { useState } from 'react'
import { Columns3, List, GitCommitHorizontal } from 'lucide-react'

export default {
  title: 'UI/ButtonGroup',
  component: ButtonGroup,
}

export const Segmented = () => {
  const [active, setActive] = useState('board')
  return (
    <ButtonGroup>
      <Button variant={active === 'board' ? 'primary' : 'ghost'} size="sm" onClick={() => setActive('board')}>Board</Button>
      <Button variant={active === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setActive('list')}>List</Button>
      <Button variant={active === 'changes' ? 'primary' : 'ghost'} size="sm" onClick={() => setActive('changes')}>Changes</Button>
    </ButtonGroup>
  )
}

export const WithIcons = () => {
  const [view, setView] = useState('board')
  return (
    <ButtonGroup>
      <Button variant={view === 'board' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('board')}><Columns3 className="w-3.5 h-3.5" /></Button>
      <Button variant={view === 'list' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('list')}><List className="w-3.5 h-3.5" /></Button>
      <Button variant={view === 'changes' ? 'primary' : 'ghost'} size="sm" onClick={() => setView('changes')}><GitCommitHorizontal className="w-3.5 h-3.5" /></Button>
    </ButtonGroup>
  )
}

export const TwoOptions = () => (
  <ButtonGroup>
    <Button variant="primary" size="sm">Chat</Button>
    <Button variant="ghost" size="sm">Logs</Button>
  </ButtonGroup>
)
