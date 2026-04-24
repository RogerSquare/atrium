import { useState } from 'react'
import { X, Folder } from 'lucide-react'
import ModalOverlay from './ModalOverlay'

export default function CreateProjectModal({ onClose, onCreateProject }) {
  const [name, setName] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!name.trim() || name === 'Root') return
    onCreateProject(name.trim())
    onClose()
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="w-full h-full sm:h-auto sm:max-w-md flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-card)', borderRadius: '0', boxShadow: 'var(--shadow-popover)' }}
        ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-md)' }}
      >
        <header className="shrink-0 flex justify-between items-center" style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '0.5px solid var(--separator)' }}>
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5" style={{ color: 'var(--accent-app)' }} />
            <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>New Project</h2>
          </div>
          <button onClick={onClose} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
            <X className="w-[18px] h-[18px]" />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-5) var(--space-6)' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>Project Name</label>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. Website Redesign"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full focus:outline-none"
              style={{
                background: 'var(--fill-secondary)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                fontSize: 'var(--text-body)',
                color: 'var(--text-app)',
              }}
              onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 25%, transparent)'}
              onBlur={e => e.target.style.boxShadow = 'none'}
            />
            <p style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)' }}>
              Creates a new directory to group tasks.
            </p>
          </div>
        </form>

        <footer className="shrink-0 flex justify-end gap-3" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '0.5px solid var(--separator)' }}>
          <button type="button" onClick={onClose} className="apple-press" style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!name.trim() || name.toLowerCase() === 'root'} className="apple-press text-white" style={{ padding: '10px 24px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)', border: 'none', cursor: 'pointer', opacity: (name.trim() && name.toLowerCase() !== 'root') ? 1 : 0.4 }}>
            Create Project
          </button>
        </footer>
      </div>
    </ModalOverlay>
  )
}
