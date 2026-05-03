import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, Folder, Pencil, Check, UserCircle2, Trash2, Clock, Calendar, History, RotateCcw, FileText, Copy, Link, Sparkles, ChevronDown, ChevronRight, GitBranch, FlaskConical } from 'lucide-react'
import TestsTab from './TestsTab'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_URL, apiFetch } from '../config'
import { MERGE_STATUS } from '../constants'
import AgentLogPanel from './AgentLogPanel'
import AIChatPanel from './AIChatPanel'
import ApprovalPanel from './ApprovalPanel'
import ContinueButton from './ContinueButton'
import ModalOverlay from './ModalOverlay'
import { Button, IconButton, Select, Input, Avatar } from './ui'

const VIEWER_COLORS = ['#06b6d4', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#fbbf24', '#60a5fa']

const CATEGORIES = [
  { id: 'feat',   label: 'feat',   color: 'var(--apple-blue)'   },
  { id: 'bug',    label: 'bug',    color: 'var(--apple-red)'    },
  { id: 'ui',     label: 'ui',     color: 'var(--apple-teal)'   },
  { id: 'opt',    label: 'opt',    color: 'var(--apple-orange)' },
  { id: 'comp',   label: 'comp',   color: 'var(--gray-1)'       },
  { id: 'devops', label: 'devops', color: 'var(--apple-purple)' },
  { id: 'mobile', label: 'mobile', color: 'var(--apple-pink)'   },
]
const TASK_ID_REGEX = /^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$/
function parseTaskIdParts(id) {
  if (!id) return null
  const match = id.match(/^(feat|bug|ui|opt|comp|devops|mobile)(-.+)$/)
  if (!match) return null
  return { category: match[1], rest: match[2] }
}

export default function TaskModal({ task, projects, onClose, onUpdateTask, onDeleteTask, currentUser, activeAgents = [], onStartAgent, onStopAgent, socket, taskViewers = [], agentsEnabled = true, canRunAgents = true, aiChatEnabled = true, githubLinks = {} }) {
  const [newComment, setNewComment] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState(task.content || '')
  const [showHistory, setShowHistory] = useState(false)
  const [historyItems, setHistoryItems] = useState([])
  const [selectedVersion, setSelectedVersion] = useState(null)
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [modalTab, setModalTab] = useState('content')

  // Debounced field state — local values that only fire API after 500ms idle
  const [localAssignee, setLocalAssignee] = useState(task.assignee || '')
  const [localComponent, setLocalComponent] = useState(task.component || '')
  const [localTags, setLocalTags] = useState(Array.isArray(task.tags) ? task.tags.join(', ') : task.tags || '')
  const [localFiles, setLocalFiles] = useState(Array.isArray(task.files_affected) ? task.files_affected.join('\n') : '')
  const [localParentTask, setLocalParentTask] = useState(task.parent_task || '')
  const [localDueDate, setLocalDueDate] = useState(task.due_date || '')
  const [saving, setSaving] = useState(false)
  const debounceTimers = useRef({})
  const pendingUpdates = useRef({})
  const contentRef = useRef(null)
  const mountedRef = useRef(true)
  // Refs for current values so flush always uses the latest task.id/onUpdateTask
  const taskIdRef = useRef(task.id)
  const onUpdateTaskRef = useRef(onUpdateTask)
  taskIdRef.current = task.id
  onUpdateTaskRef.current = onUpdateTask

  // Reset scroll to top and tab when modal opens
  useEffect(() => {
    setModalTab('content')
    setShowHistory(false)
    setIsEditing(false)
    const reset = () => { if (contentRef.current) contentRef.current.scrollTop = 0 }
    // Multiple attempts to ensure scroll resets after renders
    reset()
    requestAnimationFrame(reset)
    const t1 = setTimeout(reset, 50)
    const t2 = setTimeout(reset, 150)
    const t3 = setTimeout(reset, 300)
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3) }
  }, [task.id])

  // Sync local state when task changes from outside (e.g. socket update)
  useEffect(() => {
    if (!debounceTimers.current.assignee) setLocalAssignee(task.assignee || '')
    if (!debounceTimers.current.component) setLocalComponent(task.component || '')
    if (!debounceTimers.current.tags) setLocalTags(Array.isArray(task.tags) ? task.tags.join(', ') : task.tags || '')
    if (!debounceTimers.current.files) setLocalFiles(Array.isArray(task.files_affected) ? task.files_affected.join('\n') : '')
    if (!debounceTimers.current.parentTask) setLocalParentTask(task.parent_task || '')
    if (!debounceTimers.current.dueDate) setLocalDueDate(task.due_date || '')
  }, [task.assignee, task.component, task.tags, task.files_affected, task.parent_task, task.due_date])

  const debouncedUpdate = useCallback((field, value, transform) => {
    const update = transform ? transform(value) : value
    pendingUpdates.current[field] = update

    clearTimeout(debounceTimers.current[field])
    setSaving(true)
    debounceTimers.current[field] = setTimeout(() => {
      onUpdateTaskRef.current(taskIdRef.current, { [field]: update })
      delete pendingUpdates.current[field]
      delete debounceTimers.current[field]
      if (mountedRef.current) setSaving(false)
    }, 500)
  }, [])

  // Flush all pending debounced updates (called on close/blur)
  const flushPending = useCallback(() => {
    Object.keys(debounceTimers.current).forEach(field => {
      clearTimeout(debounceTimers.current[field])
      delete debounceTimers.current[field]
    })
    if (Object.keys(pendingUpdates.current).length > 0) {
      onUpdateTaskRef.current(taskIdRef.current, { ...pendingUpdates.current })
      pendingUpdates.current = {}
    }
    if (mountedRef.current) setSaving(false)
  }, [])

  // Flush on unmount only (no deps — runs cleanup once on true unmount)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      // Flush pending with current refs — guaranteed to use latest task.id
      Object.keys(debounceTimers.current).forEach(field => {
        clearTimeout(debounceTimers.current[field])
        delete debounceTimers.current[field]
      })
      if (Object.keys(pendingUpdates.current).length > 0) {
        onUpdateTaskRef.current(taskIdRef.current, { ...pendingUpdates.current })
        pendingUpdates.current = {}
      }
    }
  }, [])

  // --- Rename ---
  const [showCategoryMenu, setShowCategoryMenu] = useState(false)
  const [editingId, setEditingId] = useState(false)
  const [editIdValue, setEditIdValue] = useState('')
  const [renameError, setRenameError] = useState(null)

  const handleRename = useCallback(async (newId) => {
    if (!newId || newId === task.id) { setEditingId(false); return }
    setRenameError(null)
    try {
      const res = await apiFetch(`${API_URL}/tasks/${encodeURIComponent(task.id)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_id: newId, renamed_by: currentUser?.username }),
      })
      const data = await res.json()
      if (!res.ok) { setRenameError(data.error || 'Rename failed'); return }
      // Refresh: close + reopen will pick up the new task via socket events
      onClose()
    } catch (e) {
      setRenameError(e.message)
    }
  }, [task.id, currentUser, onClose])

  const handleCategorySwap = useCallback((newCat) => {
    const parts = parseTaskIdParts(task.id)
    if (!parts || parts.category === newCat) { setShowCategoryMenu(false); return }
    const newId = newCat + parts.rest
    setShowCategoryMenu(false)
    handleRename(newId)
  }, [task.id, handleRename])

  const handleCopyId = () => {
    navigator.clipboard.writeText(task.id)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyLink = () => {
    const url = new URL(window.location)
    url.searchParams.set('task', task.id)
    navigator.clipboard.writeText(url.toString())
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const fetchHistory = async () => {
    setIsLoadingHistory(true)
    try {
      const res = await apiFetch(`${API_URL}/tasks/${task.id}/history`)
      const data = await res.json()
      setHistoryItems(data)
    } catch (err) {
      console.error('Failed to fetch history:', err)
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const fetchVersionContent = async (version) => {
    try {
      const res = await apiFetch(`${API_URL}/tasks/${task.id}/history/${version.filename}`)
      const data = await res.json()
      setSelectedVersion({ ...version, ...data })
    } catch (err) {
      console.error('Failed to fetch version content:', err)
    }
  }

  const handleRestore = async (filename) => {
    if (!window.confirm('Are you sure you want to restore this version? The current state will be backed up.')) return
    
    try {
      const res = await apiFetch(`${API_URL}/tasks/${task.id}/history/${filename}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updated_by: currentUser?.username || 'User' })
      })
      const result = await res.json()
      if (result.success) {
        onUpdateTask(task.id, result.task) // Sync the whole task object
        setShowHistory(false)
        setSelectedVersion(null)
      }
    } catch (err) {
      console.error('Failed to restore task:', err)
    }
  }

  useEffect(() => {
    if (showHistory) {
      fetchHistory()
    }
  }, [showHistory, task.content, task.activity_log])

  const formatTimestamp = (ts) => {
    if (!ts) return 'N/A'
    return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
  }

  const getLeadTime = () => {
    if (!task.created_at || !task.done_at) return null
    const start = new Date(task.created_at)
    const end = new Date(task.done_at)
    const diff = Math.abs(end - start)
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  useEffect(() => {
    // Keep local edit state in sync if task updates in background (unless currently editing)
    if (!isEditing) {
      setEditedContent(task.content || '')
    }
  }, [task.content, isEditing])
  
  const handleAddComment = () => {
    if (!newComment.trim()) return
    
    // Ensure "### Comments" section exists, if not, create it
    let updatedContent = task.content || ''
    if (!updatedContent.includes('### Comments')) {
      updatedContent += '\n\n### Comments\n'
    }
    
    // Append the new comment with the current user's name
    const commentString = `- **[${currentUser?.username || 'User'}]**: ${newComment.trim()}\n`
    updatedContent += `\n${commentString}`
    
    onUpdateTask(task.id, { content: updatedContent })
    setNewComment('')
  }

  const handleSaveEdit = () => {
    onUpdateTask(task.id, { content: editedContent })
    setIsEditing(false)
  }

  const handleProjectChange = (e) => {
    const newProject = e.target.value
    onUpdateTask(task.id, { project: newProject })
  }

  const STATUS_COLOR = { todo: 'var(--gray-1)', in_progress: 'var(--apple-blue)', review: 'var(--apple-orange)', done: 'var(--apple-green)' }
  const PRIORITY_COLOR = { high: 'var(--apple-red)', medium: 'var(--apple-orange)', low: 'var(--apple-green)' }

  return (
    <ModalOverlay onClose={onClose} ariaLabel="Task detail">
      <div
        className="w-full h-full sm:w-[900px] sm:h-[85vh] sm:max-w-[95vw] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          borderRadius: '0',
          boxShadow: 'var(--shadow-popover)',
        }}
        // Desktop: rounded sheet
        ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-md)' }}
      >
        {/* Header */}
        <header className="shrink-0" style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-hairline)', background: 'var(--bg-card)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Category dropdown + editable task id */}
              <div className="flex items-center gap-0 relative">
                {(() => {
                  const parts = parseTaskIdParts(task.id)
                  const cat = parts ? CATEGORIES.find(c => c.id === parts.category) : null
                  return (
                    <>
                      {/* Category chip — click to swap */}
                      <Button
                        onClick={() => setShowCategoryMenu(prev => !prev)}
                        pill={false}
                        size="sm"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-caption2)',
                          fontWeight: 600,
                          color: cat ? cat.color : 'var(--text-tertiary)',
                          background: cat ? `color-mix(in srgb, ${cat.color} 14%, transparent)` : 'var(--fill-secondary)',
                          padding: 'var(--space-1) var(--space-2)',
                          borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
                          border: `1px solid ${cat ? `color-mix(in srgb, ${cat.color} 35%, transparent)` : 'var(--separator)'}`,
                          borderRight: 'none',
                          textTransform: 'uppercase',
                          letterSpacing: '0.03em',
                        }}
                        title="Change category"
                      >
                        {parts?.category || '?'}
                        <ChevronDown className="w-2.5 h-2.5" />
                      </Button>
                      {/* Category dropdown */}
                      {showCategoryMenu && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setShowCategoryMenu(false)} />
                          <div
                            role="menu"
                            className="absolute left-0 z-50 animate-fade-in"
                            style={{
                              top: 'calc(100% + var(--space-1))',
                              minWidth: '140px',
                              padding: 'var(--space-1)',
                              borderRadius: 'var(--radius-md)',
                              background: 'var(--bg-card)',
                              border: '1px solid var(--separator)',
                              boxShadow: 'var(--shadow-popover)',
                            }}
                          >
                            {CATEGORIES.map(c => (
                              <Button
                                key={c.id}
                                variant="ghost"
                                pill={false}
                                role="menuitem"
                                onClick={() => handleCategorySwap(c.id)}
                                className="w-full justify-start"
                                style={{
                                  padding: 'var(--space-2)',
                                  borderRadius: 'var(--radius-sm)',
                                  fontSize: 'var(--text-caption1)',
                                  fontWeight: c.id === parts?.category ? 700 : 500,
                                  color: c.color,
                                  background: c.id === parts?.category ? `color-mix(in srgb, ${c.color} 10%, transparent)` : 'transparent',
                                  fontFamily: 'var(--font-mono)',
                                  textTransform: 'uppercase',
                                }}
                              >
                                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: c.color, flexShrink: 0 }} />
                                {c.label}
                              </Button>
                            ))}
                          </div>
                        </>
                      )}
                      {/* Editable rest-of-id */}
                      {editingId ? (
                        <input
                          autoFocus
                          value={editIdValue}
                          onChange={(e) => setEditIdValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          onBlur={() => {
                            const full = editIdValue
                            if (TASK_ID_REGEX.test(full)) handleRename(full)
                            else setEditingId(false)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.target.blur() }
                            if (e.key === 'Escape') { setEditingId(false) }
                          }}
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-caption2)',
                            fontWeight: 'var(--font-medium)',
                            color: 'var(--text-app)',
                            background: 'var(--fill-secondary)',
                            padding: 'var(--space-1) var(--space-2)',
                            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                            border: '1px solid var(--accent-app)',
                            outline: 'none',
                            minWidth: '120px',
                          }}
                        />
                      ) : (
                        <button
                          onClick={() => { setEditIdValue(task.id); setEditingId(true); setRenameError(null) }}
                          className="apple-press"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: 'var(--text-caption2)',
                            fontWeight: 'var(--font-medium)',
                            color: 'var(--text-tertiary)',
                            background: 'var(--fill-secondary)',
                            padding: 'var(--space-1) var(--space-2)',
                            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                            border: '1px solid var(--separator)',
                            borderLeft: 'none',
                          }}
                          title="Click to rename task id"
                        >
                          {parts?.rest || task.id}
                        </button>
                      )}
                    </>
                  )
                })()}
                {renameError && (
                  <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-red)', marginLeft: 'var(--space-2)' }}>{renameError}</span>
                )}
              </div>
              <IconButton onClick={handleCopyId} size="sm" title="Copy ID" aria-label="Copy ID" style={{ color: 'var(--text-tertiary)' }}>
                {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-3.5 h-3.5" />}
              </IconButton>
              <IconButton onClick={handleCopyLink} size="sm" title="Copy link" aria-label="Copy link" style={{ color: 'var(--text-tertiary)', width: linkCopied ? 'auto' : undefined, padding: linkCopied ? '0 var(--space-2)' : undefined }}>
                {linkCopied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Link className="w-3.5 h-3.5" />}
                {linkCopied && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-green)', fontWeight: 'var(--font-medium)', marginLeft: 'var(--space-1)' }}>Copied</span>}
              </IconButton>
              {saving && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--accent-app)', fontWeight: 'var(--font-medium)' }} className="animate-gentle-pulse">Saving...</span>}
              {(() => {
                const link = githubLinks[task.id]
                const ms = link?.pr_state ? MERGE_STATUS[link.pr_state] : null
                if (!ms) return null
                return (
                  <a
                    href={link.pr_url || link.branch_url || '#'}
                    target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5"
                    style={{
                      padding: 'var(--space-1) var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      background: `color-mix(in srgb, ${ms.color} 14%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${ms.color} 35%, transparent)`,
                      color: ms.color,
                      fontSize: 'var(--text-caption2)',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                    title={`PR #${link.pr_number}: ${link.pr_title || ''} (${ms.label})`}
                  >
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: ms.dotColor }} />
                    {ms.label}{link.pr_number ? ` #${link.pr_number}` : ''}
                  </a>
                )
              })()}

              {taskViewers.filter(u => u !== currentUser?.username).length > 0 && (
                <div className="flex items-center gap-1.5 ml-1" style={{ paddingLeft: 'var(--space-2)', borderLeft: '1px solid var(--separator)' }}>
                  <div className="flex -space-x-1">
                    {taskViewers.filter(u => u !== currentUser?.username).map((name, i) => (
                      <Avatar
                        key={name}
                        size="xs"
                        initials={name.charAt(0).toUpperCase()}
                        alt={name}
                        title={name}
                        color="white"
                        background={VIEWER_COLORS[i % VIEWER_COLORS.length]}
                        style={{ border: '2px solid var(--bg-card)', fontWeight: 'var(--font-semibold)' }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                    {taskViewers.filter(u => u !== currentUser?.username).join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-1 shrink-0">
              {/* AI & Agent panel toggle */}
              {(aiChatEnabled || (agentsEnabled && canRunAgents)) && !isEditing && (
                <IconButton
                  onClick={() => { setModalTab(modalTab === 'ai' ? 'content' : 'ai'); setShowHistory(false) }}
                  title="AI & Agent"
                  aria-label="AI & Agent"
                  style={{
                    color: modalTab === 'ai' ? 'var(--accent-app)' : activeAgents.some(a => a.taskId === task.id) ? 'var(--apple-green)' : 'var(--text-muted)',
                    background: modalTab === 'ai' ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : activeAgents.some(a => a.taskId === task.id) ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)' : 'transparent',
                    position: 'relative',
                  }}
                >
                  <Sparkles className="w-[18px] h-[18px]" />
                  {activeAgents.some(a => a.taskId === task.id) && modalTab !== 'ai' && (
                    <span style={{ position: 'absolute', top: 'var(--space-1)', right: 'var(--space-1)', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', boxShadow: '0 0 6px var(--apple-green)' }} className="animate-gentle-pulse" />
                  )}
                </IconButton>
              )}
              {!isEditing && (
                <IconButton
                  onClick={() => { setModalTab(modalTab === 'tests' ? 'content' : 'tests'); setShowHistory(false) }}
                  title="Tests (e2e)"
                  aria-label="Tests"
                  style={{
                    color: modalTab === 'tests'
                      ? 'var(--accent-app)'
                      : task.e2e_status === 'passing' ? 'var(--apple-green)'
                      : task.e2e_status === 'failing' ? 'var(--apple-red)'
                      : 'var(--text-muted)',
                    background: modalTab === 'tests' ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'transparent',
                  }}
                >
                  <FlaskConical className="w-[18px] h-[18px]" />
                </IconButton>
              )}
              {!isEditing && (
                <IconButton
                  onClick={() => { setShowHistory(!showHistory); setIsEditing(false); setModalTab('content') }}
                  title="History"
                  aria-label="History"
                  style={{
                    color: showHistory ? 'var(--accent-app)' : 'var(--text-muted)',
                    background: showHistory ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'transparent',
                  }}
                >
                  <History className="w-[18px] h-[18px]" />
                </IconButton>
              )}
              <IconButton onClick={() => onDeleteTask(task.id)} title="Delete" aria-label="Delete">
                <Trash2 className="w-[18px] h-[18px]" />
              </IconButton>
              <IconButton
                onClick={() => { if (isEditing) handleSaveEdit(); else { setIsEditing(true); setShowHistory(false) } }}
                title={isEditing ? "Save" : "Edit"}
                aria-label={isEditing ? "Save" : "Edit"}
                style={{
                  color: isEditing ? 'var(--apple-green)' : 'var(--text-muted)',
                  background: isEditing ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)' : 'transparent',
                }}
              >
                {isEditing ? <Check className="w-[18px] h-[18px]" /> : <Pencil className="w-[18px] h-[18px]" />}
              </IconButton>
              <IconButton onClick={onClose} title="Close" aria-label="Close">
                <X className="w-[18px] h-[18px]" />
              </IconButton>
            </div>
          </div>

          <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', lineHeight: 'var(--leading-tight)', marginBottom: 'var(--space-3)' }}>{task.title}</h2>

          {/* Metadata — grouped list style */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5" style={{ padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: STATUS_COLOR[task.status] || 'var(--gray-1)' }} />
              {task.status.replace('_', ' ')}
            </div>
            <div style={{ padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-full)', background: `color-mix(in srgb, ${PRIORITY_COLOR[task.priority] || 'var(--apple-orange)'} 10%, transparent)`, fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: PRIORITY_COLOR[task.priority] || 'var(--apple-orange)', textTransform: 'capitalize' }}>
              {task.priority}
            </div>
            <div className="flex items-center gap-1.5 overflow-hidden" style={{ padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <Folder className="w-3.5 h-3.5 shrink-0" />
              <select value={task.project || 'Root'} onChange={handleProjectChange} disabled={showHistory} className="pill-input bg-transparent cursor-pointer outline-none border-none" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0 }}>
                {projects.map(p => { const f = p.folder || p; const n = p.name || p; const pid = p.id || null; return <option key={f} value={f}>{f === 'Root' ? 'Unassigned' : n}{pid && pid !== 'root' ? ` (${pid})` : ''}</option> })}
              </select>
            </div>
            <div className="flex items-center gap-1.5 overflow-hidden" style={{ padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <UserCircle2 className="w-3.5 h-3.5 shrink-0" />
              <input type="text" placeholder="Unassigned" value={localAssignee} onChange={(e) => { setLocalAssignee(e.target.value); debouncedUpdate('assignee', e.target.value) }} disabled={showHistory} className="pill-input bg-transparent outline-none border-none w-24" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0 }} />
              {task.assignee && task.status === 'in_progress' && <span className="animate-gentle-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', boxShadow: '0 0 6px var(--apple-green)' }} />}
            </div>
            <div className="overflow-hidden" style={{ padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <select value={task.type || 'fullstack'} onChange={(e) => onUpdateTask(task.id, { type: e.target.value })} disabled={showHistory} className="pill-input bg-transparent cursor-pointer outline-none border-none" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0, textTransform: 'capitalize' }}>
                <option value="frontend">Frontend</option>
                <option value="backend">Backend</option>
                <option value="fullstack">Fullstack</option>
                <option value="devops">DevOps</option>
              </select>
            </div>
          </div>
          {/* GitHub branch / PR link overrides */}
          <GitHubLinkFields task={task} onUpdateTask={onUpdateTask} />
        </header>

        {/* Content area */}
        <div ref={contentRef} className={`flex-1 min-h-0 flex flex-col ${modalTab === 'content' && !showHistory && !isEditing ? 'overflow-y-auto custom-scrollbar' : 'overflow-hidden'}`} style={{ padding: (modalTab !== 'content' || showHistory || isEditing) ? '0' : 'var(--space-5) var(--space-6)', background: 'var(--bg-card)' }}>
          {/* Tests panel */}
          {modalTab === 'tests' && !showHistory && (
            <TestsTab task={task} />
          )}

          {/* AI & Agent panel */}
          {modalTab === 'ai' && !showHistory && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Agent controls bar */}
              {(agentsEnabled && canRunAgents) && (
                <div style={{ padding: 'var(--space-3) var(--space-5)', borderBottom: '0.5px solid var(--separator)', flexShrink: 0 }}>
                  <AgentLogPanel task={task} socket={socket} agentRunning={activeAgents.some(a => a.taskId === task.id)} onStartAgent={onStartAgent} onStopAgent={onStopAgent} currentUser={currentUser} agentsEnabled={agentsEnabled} canRunAgents={canRunAgents} />
                </div>
              )}
              {/* AI Chat */}
              <div className="flex-1 min-h-0 flex flex-col">
                <AIChatPanel user={currentUser} task={task} noHeader aiChatEnabled={aiChatEnabled} />
              </div>
            </div>
          )}

          {/* Content / History */}
          {modalTab === 'content' && (showHistory ? (
            <div className="flex flex-col flex-1 overflow-hidden" style={{ borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)' }}>
               <div className="flex flex-1 overflow-hidden">
                  <div className="w-1/3 overflow-y-auto custom-scrollbar" style={{ borderRight: '0.5px solid var(--separator)' }}>
                     <div style={{ padding: 'var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
                        <h4 style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Versions</h4>
                     </div>
                     {isLoadingHistory ? (
                        <div className="p-8 text-center animate-gentle-pulse" style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)' }}>Loading...</div>
                     ) : historyItems.length === 0 ? (
                        <div className="p-8 text-center" style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)' }}>No history found.</div>
                     ) : (
                        <div>
                           {historyItems.map((v, i) => (
                               <button
                                 key={v.filename}
                                 onClick={() => fetchVersionContent(v)}
                                 className="w-full text-left apple-press"
                                 style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '0.5px solid var(--separator)', background: selectedVersion?.filename === v.filename ? 'var(--fill-secondary)' : 'transparent', transition: `background var(--duration-fast) var(--ease-default)` }}
                              >
                                 <div className="flex justify-between items-start mb-1">
                                     <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: selectedVersion?.filename === v.filename ? 'var(--accent-app)' : 'var(--text-app)' }}>
                                        {i === 0 ? 'Latest' : `Version ${historyItems.length - i}`}
                                        {v.author && <span style={{ opacity: 0.5, marginLeft: 'var(--space-1)' }}>{v.author}</span>}
                                     </span>
                                    <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                                       {(v.size / 1024).toFixed(1)} KB
                                    </span>
                                 </div>
                                 <div className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>
                                    <Clock className="w-3 h-3" style={{ opacity: 0.5 }} />
                                    {new Date(v.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                 </div>
                              </button>
                           ))}
                        </div>
                     )}
                  </div>

                  <div className="flex-1 flex flex-col overflow-hidden" style={{ background: 'var(--bg-card)' }}>
                     {selectedVersion ? (
                        <>
                           <div className="flex justify-between items-center" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '0.5px solid var(--separator)' }}>
                              <div className="flex items-center gap-2">
                                 <FileText className="w-4 h-4" style={{ color: 'var(--accent-app)' }} />
                                 <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Preview</span>
                              </div>
                              <Button
                                onClick={() => handleRestore(selectedVersion.filename)}
                                variant="primary"
                                pill={false}
                                style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)' }}
                              >
                                <RotateCcw className="w-3.5 h-3.5" /> Restore
                              </Button>
                           </div>
                           <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-5)' }}>
                              <div className="flex flex-wrap gap-2 mb-4">
                                 {['status', 'priority', 'assignee'].map(field => (
                                   <span key={field} style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)', textTransform: 'capitalize' }}>
                                     {field}: {selectedVersion.data?.[field] || 'None'}
                                   </span>
                                 ))}
                              </div>
                              <div className="prose prose-sm prose-app max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-p:text-app-text prose-li:text-app-text prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-app-text-muted prose-hr:border-app-border">
                                 <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedVersion.content}</ReactMarkdown>
                              </div>
                           </div>
                        </>
                     ) : (
                        <div className="flex-1 flex flex-col items-center justify-center p-12 text-center select-none">
                           <History className="w-10 h-10 mb-3" style={{ color: 'var(--text-tertiary)', opacity: 0.2 }} />
                           <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)' }}>Select a version to preview</p>
                        </div>
                     )}
                  </div>
               </div>
            </div>
          ) : (
            <>
              {/* Approval requests */}
              <ApprovalPanel task={task} socket={socket} />

              {/* Phase continuation */}
              <ContinueButton task={task} onSelectTask={onClose} />

              {/* Dev Meta — grouped list */}
              <div className="grid grid-cols-2 gap-4 mb-6" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--fill-secondary)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Component</label>
                  <input type="text" placeholder="e.g. Auth Service" value={localComponent} onChange={(e) => { setLocalComponent(e.target.value); debouncedUpdate('component', e.target.value) }} disabled={showHistory} className="w-full outline-none bg-transparent disabled:opacity-50" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', border: 'none', padding: 0 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-1)' }}>Tags</label>
                  <input type="text" placeholder="react, express" value={localTags} onChange={(e) => { setLocalTags(e.target.value); debouncedUpdate('tags', e.target.value, v => v.split(',').map(t => t.trim())) }} disabled={showHistory} className="w-full outline-none bg-transparent disabled:opacity-50" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', border: 'none', padding: 0 }} />
                </div>
              </div>

              {isEditing ? (
                <div className="flex-1 flex flex-col" style={{ padding: 'var(--space-5) var(--space-6)' }}>
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full flex-1 resize-none focus:outline-none"
                    style={{ background: 'var(--fill-secondary)', color: 'var(--text-app)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-subhead)', border: 'none', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent-app) 20%, transparent)', minHeight: '200px' }}
                    placeholder="Task description (Markdown)..."
                  />
                </div>
              ) : (
                <>
                  <div className="prose prose-app max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-p:text-app-text prose-li:text-app-text prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent hover:prose-a:text-app-accent-hover prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-app-text-muted prose-hr:border-app-border">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.content}</ReactMarkdown>
                  </div>

                  {/* Dev fields */}
                  <div style={{ marginTop: 'var(--space-8)', paddingTop: 'var(--space-5)', borderTop: '0.5px solid var(--separator)' }}>
                    <div className="space-y-5">
                      <div>
                        <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Files Affected</label>
                        <textarea placeholder="List file paths..." value={localFiles} onChange={(e) => { setLocalFiles(e.target.value); debouncedUpdate('files_affected', e.target.value, v => v.split('\n').filter(f => f.trim())) }} disabled={showHistory} className="w-full resize-none focus:outline-none disabled:opacity-50" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', minHeight: '72px', border: 'none' }} />
                      </div>

                      <div className="flex gap-4 items-start">
                        <div className="flex-1">
                          <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Parent Task</label>
                          <Input
                            type="text"
                            placeholder="e.g. task-123"
                            value={localParentTask}
                            onChange={(e) => { setLocalParentTask(e.target.value); debouncedUpdate('parent_task', e.target.value) }}
                            disabled={showHistory}
                            className="w-full"
                            style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-footnote)' }}
                          />
                        </div>
                        <div className="flex-1">
                          <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Due Date</label>
                          <div className="flex gap-2">
                            <Input
                              type="date"
                              value={localDueDate ? localDueDate.split('T')[0] : ''}
                              onChange={(e) => { const val = e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : ''; setLocalDueDate(val); debouncedUpdate('due_date', val || null) }}
                              disabled={showHistory}
                              className="flex-1"
                              style={{ fontSize: 'var(--text-footnote)' }}
                            />
                            {localDueDate && (
                              <Button
                                onClick={() => { setLocalDueDate(''); debouncedUpdate('due_date', null) }}
                                disabled={showHistory}
                                variant="danger"
                                pill={false}
                                size="sm"
                                style={{ padding: 'var(--space-2) var(--space-2)' }}
                              >
                                Clear
                              </Button>
                            )}
                          </div>
                          {localDueDate && (() => {
                            const diff = Math.ceil((new Date(localDueDate) - new Date()) / (1000 * 60 * 60 * 24))
                            const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Due today' : diff === 1 ? 'Due tomorrow' : `${diff}d remaining`
                            const c = diff < 0 ? 'var(--apple-red)' : diff <= 3 ? 'var(--apple-orange)' : 'var(--apple-green)'
                            return <p style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: c, marginTop: 'var(--space-1)' }}>{label}</p>
                          })()}
                        </div>
                      </div>

                      {/* Lifecycle */}
                      <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--fill-secondary)' }}>
                        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-3)' }}>
                          <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Lifecycle</span>
                          {getLeadTime() && <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-full)' }}>Lead: {getLeadTime()}</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                          {[
                            { label: 'Created', icon: Calendar, ts: task.created_at },
                            { label: 'Started', icon: Clock, ts: task.started_at },
                            { label: 'Reviewed', icon: Check, ts: task.reviewed_at },
                            { label: 'Completed', icon: Check, ts: task.done_at },
                          ].map(({ label, icon: Icon, ts }) => (
                            <div key={label} className="flex items-center gap-3">
                              <div style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
                                <Icon className="w-3.5 h-3.5" style={{ color: 'var(--text-tertiary)' }} />
                              </div>
                              <div>
                                <div style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)' }}>{label}</div>
                                <div style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{formatTimestamp(ts)}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Activity log */}
                      {task.activity_log && task.activity_log.length > 0 && (
                        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--fill-secondary)' }}>
                          <span style={{ display: 'block', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>Activity</span>
                          <div className="space-y-2">
                            {task.activity_log.slice().reverse().map((log, i) => (
                              <div key={i} className="flex gap-3" style={{ fontSize: 'var(--text-caption1)' }}>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', minWidth: '110px', fontSize: 'var(--text-caption2)' }}>
                                  {new Date(log.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                                </span>
                                <span style={{ color: 'var(--text-muted)', borderLeft: '2px solid var(--separator)', paddingLeft: 'var(--space-3)' }}>
                                  {log.action}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          ))}
        </div>

        {/* Footer */}
        {!isEditing && !showHistory && modalTab === 'content' && (
          <footer className="shrink-0 safe-bottom" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '0.5px solid var(--separator)', background: 'var(--bg-card)' }}>
            <div className="flex gap-3">
              <Input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1"
                size="lg"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment() }}
              />
              <IconButton
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                aria-label="Send comment"
                style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'var(--accent-app)', color: 'white' }}
              >
                <Send className="w-[18px] h-[18px]" />
              </IconButton>
            </div>
          </footer>
        )}
        {isEditing && !showHistory && (
          <footer className="shrink-0 flex justify-end gap-3 safe-bottom" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '0.5px solid var(--separator)', background: 'var(--bg-card)' }}>
            <Button
              variant="ghost"
              pill={false}
              onClick={() => { setIsEditing(false); setEditedContent(task.content || '') }}
              style={{ padding: 'var(--space-2) var(--space-5)', fontSize: 'var(--text-subhead)' }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              pill={false}
              onClick={handleSaveEdit}
              style={{ padding: 'var(--space-2) var(--space-6)', fontSize: 'var(--text-subhead)' }}
            >
              Save Changes
            </Button>
          </footer>
        )}
      </div>
    </ModalOverlay>
  )
}

function GitHubLinkFields({ task, onUpdateTask }) {
  const hasBranch = !!task.github_branch
  const hasPr = !!task.github_pr_url
  const hasAny = hasBranch || hasPr
  const [expanded, setExpanded] = useState(hasAny)
  const [branch, setBranch] = useState(task.github_branch || '')
  const [prUrl, setPrUrl] = useState(task.github_pr_url || '')

  useEffect(() => {
    setBranch(task.github_branch || '')
    setPrUrl(task.github_pr_url || '')
    if (task.github_branch || task.github_pr_url) setExpanded(true)
  }, [task.id, task.github_branch, task.github_pr_url])

  const saveBranch = (val) => {
    const trimmed = val.trim()
    const newVal = trimmed || null
    if (newVal !== (task.github_branch || null)) {
      onUpdateTask(task.id, { github_branch: newVal })
    }
  }
  const savePrUrl = (val) => {
    const trimmed = val.trim()
    const newVal = trimmed || null
    if (newVal !== (task.github_pr_url || null)) {
      onUpdateTask(task.id, { github_pr_url: newVal })
    }
  }

  return (
    <div style={{ padding: '0 var(--space-5) var(--space-3)', borderTop: '0.5px solid var(--separator)' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center gap-2 apple-press"
        style={{ padding: 'var(--space-2) 0', fontSize: 'var(--text-caption2)', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.03em', textTransform: 'uppercase' }}
      >
        <GitBranch className="w-3 h-3" />
        <span>GitHub</span>
        {!hasAny && <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 500, color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>auto</span>}
        <span className="flex-1" />
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 pb-1">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label style={{ fontSize: 'var(--text-caption2)', fontWeight: 600, color: 'var(--text-tertiary)' }}>Branch</label>
              {hasBranch && (
                <button
                  onClick={() => { setBranch(''); saveBranch('') }}
                  className="apple-press"
                  style={{ padding: 'var(--space-1)', fontSize: 'var(--text-caption2)', color: 'var(--apple-red)', borderRadius: 'var(--radius-sm)' }}
                  title="Clear override (fall back to convention)"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
            <Input
              type="text"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              onBlur={() => saveBranch(branch)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              placeholder="auto (convention match)"
              className="w-full"
              size="sm"
              style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label style={{ fontSize: 'var(--text-caption2)', fontWeight: 600, color: 'var(--text-tertiary)' }}>PR URL</label>
              {hasPr && (
                <button
                  onClick={() => { setPrUrl(''); savePrUrl('') }}
                  className="apple-press"
                  style={{ padding: 'var(--space-1)', fontSize: 'var(--text-caption2)', color: 'var(--apple-red)', borderRadius: 'var(--radius-sm)' }}
                  title="Clear PR URL"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
            <Input
              type="text"
              value={prUrl}
              onChange={(e) => setPrUrl(e.target.value)}
              onBlur={() => savePrUrl(prUrl)}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
              placeholder="https://github.com/.../pull/N"
              className="w-full"
              size="sm"
              style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
