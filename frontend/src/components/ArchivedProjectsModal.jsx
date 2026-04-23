import { memo } from 'react'
import { Archive, ArchiveRestore, X } from 'lucide-react'
import ModalOverlay from './ModalOverlay'

function formatDate(iso) {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch { return null }
}

function ArchivedProjectsModal({ archivedProjects, onClose, onUnarchiveProject }) {
  const sorted = [...archivedProjects].sort((a, b) => (a.name || a).localeCompare(b.name || b))
  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[540px] sm:max-w-[92vw] sm:max-h-[80vh] h-full sm:h-auto flex flex-col"
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-popover)',
          overflow: 'hidden',
        }}
      >
        <div
          className="flex items-center gap-3 shrink-0"
          style={{ padding: '16px 20px', borderBottom: '0.5px solid var(--separator)' }}
        >
          <Archive className="w-5 h-5" style={{ color: 'var(--text-tertiary)' }} />
          <div className="flex-1 min-w-0">
            <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>
              Archived Projects
            </h2>
            <p style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
              {sorted.length === 0
                ? 'No archived projects.'
                : `${sorted.length} ${sorted.length === 1 ? 'project' : 'projects'} archived — click Restore to bring one back.`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="apple-press shrink-0"
            style={{ padding: '6px', borderRadius: '50%', color: 'var(--text-tertiary)' }}
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto" style={{ padding: sorted.length === 0 ? '40px 20px' : '8px' }}>
          {sorted.length === 0 ? (
            <div className="text-center" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-subhead)' }}>
              Archive a project from its <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>•••</span> menu in the sidebar to see it here.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sorted.map(proj => {
                const folder = proj.folder || proj
                const projName = proj.name || proj
                const archivedDate = formatDate(proj.archived_at)
                return (
                  <div
                    key={`archived-modal-${folder}`}
                    className="flex items-center gap-3"
                    style={{
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--fill-secondary)',
                    }}
                  >
                    <Archive className="w-4 h-4 shrink-0" style={{ color: 'var(--text-tertiary)', opacity: 0.7 }} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ fontSize: 'var(--text-subhead)', color: 'var(--text-app)', fontWeight: 'var(--font-medium)' }}>
                        {projName}
                      </div>
                      {archivedDate && (
                        <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                          Archived {archivedDate}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onUnarchiveProject?.(folder, projName)}
                      className="apple-press flex items-center gap-1.5 shrink-0"
                      style={{
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-md)',
                        background: 'color-mix(in srgb, var(--apple-green) 14%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--apple-green) 35%, transparent)',
                        color: 'var(--apple-green)',
                        fontSize: 'var(--text-caption1)',
                        fontWeight: 'var(--font-semibold)',
                        minHeight: '32px',
                      }}
                      title={`Restore ${projName}`}
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      Restore
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}

export default memo(ArchivedProjectsModal)
