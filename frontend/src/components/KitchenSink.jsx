import { useState } from 'react'
import { Plus, Trash2, CheckSquare, Square, X, Clock, Loader2, CalendarClock, AlertCircle, Circle } from 'lucide-react'
import { Button, IconButton, Badge, Select, Card } from './ui'
import TaskCard from './TaskCard'
import BulkActionBar from './BulkActionBar'
import ErrorToast from './ErrorToast'
import UndoToast from './UndoToast'
import ModalOverlay from './ModalOverlay'

const THEMES = ['dark', 'light', 'oled', 'paper']

const MOCK_TASK = {
  id: 'feat-demo-001', title: 'Implement User Authentication', status: 'in_progress',
  priority: 'high', assignee: 'Alice', type: 'fullstack', component: 'Auth Service',
  tags: ['react', 'jwt'], parent_task: 'feature-user-management',
  files_affected: ['src/auth.js'], created_at: '2026-03-01', activity_log: [],
  content: '### Description\nDemo task for kitchen sink.\n\n### Comments',
  due_date: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
}

const MOCK_TASKS_VARIANTS = [
  { ...MOCK_TASK, id: 'demo-high', priority: 'high', status: 'in_progress', title: 'High Priority — In Progress' },
  { ...MOCK_TASK, id: 'demo-med', priority: 'medium', status: 'review', title: 'Medium Priority — Review', assignee: 'Bob' },
  { ...MOCK_TASK, id: 'demo-low', priority: 'low', status: 'todo', title: 'Low Priority — To Do', assignee: null, due_date: null },
  { ...MOCK_TASK, id: 'demo-done', priority: 'medium', status: 'done', title: 'Done Task', type: 'frontend' },
  { ...MOCK_TASK, id: 'demo-overdue', priority: 'high', status: 'review', title: 'Overdue Task', due_date: '2026-03-01' },
]

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '32px' }}>
      <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-bold)', color: 'var(--text-app)', marginBottom: '12px', borderBottom: '1px solid var(--separator)', paddingBottom: '8px' }}>{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ marginBottom: '12px' }}>
      {label && <div style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)', marginBottom: '6px' }}>{label}</div>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export default function KitchenSink({ onClose, currentTheme, onSetTheme }) {
  const [showErrorToast, setShowErrorToast] = useState(false)
  const [showUndoToast, setShowUndoToast] = useState(false)
  const noop = () => {}

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="custom-scrollbar"
        style={{
          width: '90vw', maxWidth: '1000px', maxHeight: '90vh', overflow: 'auto',
          background: 'var(--bg-app)', borderRadius: 'var(--radius-lg)',
          padding: '24px', position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h1 style={{ fontSize: 'var(--text-title2)', fontWeight: 'var(--font-bold)', color: 'var(--text-app)' }}>Kitchen Sink</h1>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {THEMES.map(t => (
              <Button key={t} variant={currentTheme === t ? 'primary' : 'ghost'} size="sm" onClick={() => onSetTheme(t)}>
                {t}
              </Button>
            ))}
            <IconButton onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></IconButton>
          </div>
        </div>

        {/* Buttons */}
        <Section title="Button">
          <Row label="Variants">
            <Button variant="primary"><Plus className="w-4 h-4" /> Primary</Button>
            <Button variant="secondary"><CheckSquare className="w-3.5 h-3.5" /> Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger"><Trash2 className="w-3.5 h-3.5" /> Danger</Button>
            <Button variant="danger-filled" size="sm">Confirm</Button>
          </Row>
          <Row label="States">
            <Button variant="primary" loading>Loading</Button>
            <Button variant="ghost" disabled>Disabled</Button>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="primary" pill={false}>Rounded</Button>
          </Row>
        </Section>

        {/* IconButton */}
        <Section title="IconButton">
          <Row>
            <IconButton aria-label="Close"><X className="w-4 h-4" /></IconButton>
            <IconButton aria-label="Delete" color="var(--apple-red)"><Trash2 className="w-4 h-4" /></IconButton>
            <IconButton size="sm" aria-label="Select"><CheckSquare className="w-3.5 h-3.5" /></IconButton>
            <IconButton disabled aria-label="Disabled"><Square className="w-4 h-4" /></IconButton>
          </Row>
        </Section>

        {/* Badge */}
        <Section title="Badge">
          <Row label="Priority">
            <Badge preset="priority" value="high">High</Badge>
            <Badge preset="priority" value="medium">Medium</Badge>
            <Badge preset="priority" value="low">Low</Badge>
          </Row>
          <Row label="Status">
            <Badge preset="status" value="todo">To Do</Badge>
            <Badge preset="status" value="in_progress">In Progress</Badge>
            <Badge preset="status" value="review">Review</Badge>
            <Badge preset="status" value="done">Done</Badge>
          </Row>
          <Row label="Type">
            <Badge preset="type" value="frontend">frontend</Badge>
            <Badge preset="type" value="backend">backend</Badge>
            <Badge preset="type" value="fullstack">fullstack</Badge>
            <Badge preset="type" value="devops">devops</Badge>
          </Row>
          <Row label="Special">
            <Badge preset="accent">12</Badge>
            <Badge preset="muted">unassigned</Badge>
            <Badge color="var(--apple-orange)" bg="color-mix(in srgb, var(--apple-orange) 10%, transparent)" className="flex items-center gap-1" style={{ padding: '3px 8px' }}>
              <Clock className="w-3 h-3" />Stale
            </Badge>
            <Badge color="var(--accent-app)" bg="color-mix(in srgb, var(--accent-app) 10%, transparent)" className="flex items-center gap-1" style={{ padding: '3px 8px' }}>
              <Loader2 className="w-3 h-3 animate-spin" />Agent
            </Badge>
          </Row>
        </Section>

        {/* Select */}
        <Section title="Select">
          <Row>
            <Select defaultValue="medium">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
            <Select pill active defaultValue="assignee">
              <option value="none">No swimlanes</option>
              <option value="assignee">Assignee</option>
            </Select>
            <Select disabled defaultValue="">
              <option value="" disabled>Disabled</option>
            </Select>
          </Row>
        </Section>

        {/* Card */}
        <Section title="Card">
          <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            <Card variant="surface" accent="var(--apple-red)"><span style={{ color: 'var(--text-app)' }}>Surface + accent</span></Card>
            <Card variant="compact" accent="var(--apple-orange)"><span style={{ color: 'var(--text-app)' }}>Compact</span></Card>
            <Card variant="surface" selected><span style={{ color: 'var(--text-app)' }}>Selected</span></Card>
            <Card variant="column"><span style={{ color: 'var(--text-muted)' }}>Column container</span></Card>
          </div>
        </Section>

        {/* TaskCard */}
        <Section title="TaskCard">
          <Row label="Full cards">
            <div style={{ display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', width: '100%' }}>
              {MOCK_TASKS_VARIANTS.map(t => (
                <TaskCard key={t.id} task={t} onUpdateTask={noop} onClick={noop} viewers={t.id === 'demo-high' ? ['Bob', 'Carol'] : []} agentRunning={t.id === 'demo-high'} isStale={t.id === 'demo-med'} />
              ))}
            </div>
          </Row>
          <Row label="Compact cards">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '500px' }}>
              {MOCK_TASKS_VARIANTS.slice(0, 3).map(t => (
                <TaskCard key={t.id} task={t} onUpdateTask={noop} onClick={noop} compact />
              ))}
            </div>
          </Row>
          <Row label="Selected state">
            <div style={{ width: '320px' }}>
              <TaskCard task={MOCK_TASKS_VARIANTS[0]} onUpdateTask={noop} onClick={noop} selectable selected onToggleSelect={noop} />
            </div>
          </Row>
        </Section>

        {/* BulkActionBar */}
        <Section title="BulkActionBar">
          <Row label="Normal">
            <div style={{ width: '100%' }}>
              <BulkActionBar selectedIds={['a','b','c']} totalVisible={10} onSelectAll={noop} onDeselectAll={noop} onExit={noop} onBatchUpdate={noop} onBatchDelete={noop} uniqueAssignees={['Alice','Bob']} currentUser="Alice" />
            </div>
          </Row>
          <Row label="Loading">
            <div style={{ width: '100%' }}>
              <BulkActionBar selectedIds={['a','b']} totalVisible={10} onSelectAll={noop} onDeselectAll={noop} onExit={noop} onBatchUpdate={noop} onBatchDelete={noop} uniqueAssignees={[]} currentUser="Alice" loading />
            </div>
          </Row>
        </Section>

        {/* Toasts */}
        <Section title="Toasts">
          <Row>
            <Button variant="danger" onClick={() => setShowErrorToast(true)}>Show Error Toast</Button>
            <Button variant="secondary" onClick={() => setShowUndoToast(true)}>Show Undo Toast</Button>
          </Row>
        </Section>

        {showErrorToast && <ErrorToast message="Batch update failed (500)" onDismiss={() => setShowErrorToast(false)} />}
        {showUndoToast && <UndoToast message="Moved 5 tasks to review" canUndo canRedo onUndo={() => setShowUndoToast(false)} onRedo={noop} onDismiss={() => setShowUndoToast(false)} />}
      </div>
    </ModalOverlay>
  )
}
