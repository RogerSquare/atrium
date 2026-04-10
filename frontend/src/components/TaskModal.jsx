import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Send, Folder, Pencil, Check, UserCircle2, Trash2, Clock, Calendar, History, RotateCcw, FileText, Copy, Link, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { API_URL, apiFetch } from '../config'
import AgentLogPanel from './AgentLogPanel'
import AIChatPanel from './AIChatPanel'
import ModalOverlay from './ModalOverlay'

const VIEWER_COLORS = ['#06b6d4', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#fbbf24', '#60a5fa']

export default function TaskModal({ task, projects, onClose, onUpdateTask, onDeleteTask, currentUser, activeAgents = [], onStartAgent, onStopAgent, socket, taskViewers = [], agentsEnabled = true, canRunAgents = true, aiChatEnabled = true }) {
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
    <ModalOverlay onClose={onClose}>
      <div
        className="w-full h-full sm:w-[900px] sm:h-[85vh] sm:max-w-[95vw] flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg-card)',
          borderRadius: '0',
          boxShadow: 'var(--shadow-xl)',
        }}
        // Desktop: rounded sheet
        ref={el => { if (el && window.innerWidth >= 640) el.style.borderRadius = 'var(--radius-xl)' }}
      >
        {/* Header */}
        <header className="shrink-0 vibrancy-thin" style={{ padding: 'var(--space-4) var(--space-5)', borderBottom: '0.5px solid var(--separator)', background: 'color-mix(in srgb, var(--bg-card) 85%, transparent)' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '3px 10px', borderRadius: 'var(--radius-sm)' }}>
                {task.id}
              </span>
              <button onClick={handleCopyId} className="apple-press p-1.5" style={{ borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Copy ID">
                {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button onClick={handleCopyLink} className="apple-press p-1.5 flex items-center gap-1" style={{ borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Copy link">
                {linkCopied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Link className="w-3.5 h-3.5" />}
                {linkCopied && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--apple-green)', fontWeight: 'var(--font-medium)' }}>Copied</span>}
              </button>
              {saving && <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--accent-app)', fontWeight: 'var(--font-medium)' }} className="animate-gentle-pulse">Saving...</span>}

              {taskViewers.filter(u => u !== currentUser?.username).length > 0 && (
                <div className="flex items-center gap-1.5 ml-1" style={{ paddingLeft: 'var(--space-2)', borderLeft: '1px solid var(--separator)' }}>
                  <div className="flex -space-x-1">
                    {taskViewers.filter(u => u !== currentUser?.username).map((name, i) => (
                      <div key={name} className="w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ fontSize: '9px', fontWeight: 'var(--font-bold)', backgroundColor: VIEWER_COLORS[i % VIEWER_COLORS.length], border: '2px solid var(--bg-card)' }} title={name}>
                        {name.charAt(0).toUpperCase()}
                      </div>
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
                <button onClick={() => { setModalTab(modalTab === 'ai' ? 'content' : 'ai'); setShowHistory(false) }} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: modalTab === 'ai' ? 'var(--accent-app)' : activeAgents.some(a => a.taskId === task.id) ? 'var(--apple-green)' : 'var(--text-muted)', background: modalTab === 'ai' ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : activeAgents.some(a => a.taskId === task.id) ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)' : 'transparent', transition: `all var(--duration-fast) var(--ease-default)` }} title="AI & Agent">
                  <Sparkles className="w-[18px] h-[18px]" />
                  {activeAgents.some(a => a.taskId === task.id) && modalTab !== 'ai' && (
                    <span style={{ position: 'absolute', top: '4px', right: '4px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', boxShadow: '0 0 6px var(--apple-green)' }} className="animate-gentle-pulse" />
                  )}
                </button>
              )}
              {!isEditing && (
                <button onClick={() => { setShowHistory(!showHistory); setIsEditing(false); setModalTab('content') }} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: showHistory ? 'var(--accent-app)' : 'var(--text-muted)', background: showHistory ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'transparent', transition: `all var(--duration-fast) var(--ease-default)` }} title="History">
                  <History className="w-[18px] h-[18px]" />
                </button>
              )}
              <button onClick={() => onDeleteTask(task.id)} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', transition: `all var(--duration-fast)` }} title="Delete">
                <Trash2 className="w-[18px] h-[18px]" />
              </button>
              <button onClick={() => { if (isEditing) handleSaveEdit(); else { setIsEditing(true); setShowHistory(false) } }} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: isEditing ? 'var(--apple-green)' : 'var(--text-muted)', background: isEditing ? 'color-mix(in srgb, var(--apple-green) 12%, transparent)' : 'transparent', transition: `all var(--duration-fast)` }} title={isEditing ? "Save" : "Edit"}>
                {isEditing ? <Check className="w-[18px] h-[18px]" /> : <Pencil className="w-[18px] h-[18px]" />}
              </button>
              <button onClick={onClose} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)', transition: `all var(--duration-fast)` }}>
                <X className="w-[18px] h-[18px]" />
              </button>
            </div>
          </div>

          <h2 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', lineHeight: 'var(--leading-tight)', marginBottom: 'var(--space-3)' }}>{task.title}</h2>

          {/* Metadata — grouped list style */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex items-center gap-1.5" style={{ padding: '5px 12px', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: STATUS_COLOR[task.status] || 'var(--gray-1)' }} />
              {task.status.replace('_', ' ')}
            </div>
            <div style={{ padding: '5px 12px', borderRadius: 'var(--radius-full)', background: `color-mix(in srgb, ${PRIORITY_COLOR[task.priority] || 'var(--apple-orange)'} 10%, transparent)`, fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: PRIORITY_COLOR[task.priority] || 'var(--apple-orange)', textTransform: 'capitalize' }}>
              {task.priority}
            </div>
            <div className="flex items-center gap-1.5 overflow-hidden" style={{ padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <Folder className="w-3.5 h-3.5 shrink-0" />
              <select value={task.project || 'Root'} onChange={handleProjectChange} disabled={showHistory} className="pill-input bg-transparent cursor-pointer outline-none border-none" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0 }}>
                {projects.map(p => <option key={p} value={p}>{p === 'Root' ? 'Unassigned' : p}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5 overflow-hidden" style={{ padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <UserCircle2 className="w-3.5 h-3.5 shrink-0" />
              <input type="text" placeholder="Unassigned" value={localAssignee} onChange={(e) => { setLocalAssignee(e.target.value); debouncedUpdate('assignee', e.target.value) }} disabled={showHistory} className="pill-input bg-transparent outline-none border-none w-24" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0 }} />
              {task.assignee && task.status === 'in_progress' && <span className="animate-gentle-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', boxShadow: '0 0 6px var(--apple-green)' }} />}
            </div>
            <div className="overflow-hidden" style={{ padding: '3px 10px', borderRadius: 'var(--radius-full)', background: 'var(--fill-secondary)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              <select value={task.type || 'fullstack'} onChange={(e) => onUpdateTask(task.id, { type: e.target.value })} disabled={showHistory} className="pill-input bg-transparent cursor-pointer outline-none border-none" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', padding: 0, textTransform: 'capitalize' }}>
                <option value="frontend">Frontend</option>
                <option value="backend">Backend</option>
                <option value="fullstack">Fullstack</option>
                <option value="devops">DevOps</option>
              </select>
            </div>
          </div>
        </header>

        {/* Content area */}
        <div ref={contentRef} className={`flex-1 min-h-0 flex flex-col ${modalTab === 'content' && !showHistory && !isEditing ? 'overflow-y-auto custom-scrollbar' : 'overflow-hidden'}`} style={{ padding: (modalTab !== 'content' || showHistory || isEditing) ? '0' : 'var(--space-5) var(--space-6)', background: 'var(--bg-card)' }}>
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
            <div className="flex flex-col flex-1 overflow-hidden" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)' }}>
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
                                        {v.author && <span style={{ opacity: 0.5, marginLeft: '4px' }}>{v.author}</span>}
                                     </span>
                                    <span style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '2px 6px', borderRadius: 'var(--radius-xs)' }}>
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
                              <button onClick={() => handleRestore(selectedVersion.filename)} className="apple-press text-white flex items-center gap-1.5" style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)', boxShadow: 'var(--shadow-sm)' }}>
                                 <RotateCcw className="w-3.5 h-3.5" /> Restore
                              </button>
                           </div>
                           <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-5)' }}>
                              <div className="flex flex-wrap gap-2 mb-4">
                                 {['status', 'priority', 'assignee'].map(field => (
                                   <span key={field} style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', background: 'var(--fill-secondary)', padding: '3px 10px', borderRadius: 'var(--radius-sm)', textTransform: 'capitalize' }}>
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
              {/* Dev Meta — grouped list */}
              <div className="grid grid-cols-2 gap-4 mb-6" style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--fill-secondary)' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Component</label>
                  <input type="text" placeholder="e.g. Auth Service" value={localComponent} onChange={(e) => { setLocalComponent(e.target.value); debouncedUpdate('component', e.target.value) }} disabled={showHistory} className="w-full outline-none bg-transparent disabled:opacity-50" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', border: 'none', padding: 0 }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>Tags</label>
                  <input type="text" placeholder="react, express" value={localTags} onChange={(e) => { setLocalTags(e.target.value); debouncedUpdate('tags', e.target.value, v => v.split(',').map(t => t.trim())) }} disabled={showHistory} className="w-full outline-none bg-transparent disabled:opacity-50" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)', border: 'none', padding: 0 }} />
                </div>
              </div>

              {isEditing ? (
                <div className="flex-1 flex flex-col" style={{ padding: 'var(--space-5) var(--space-6)' }}>
                  <textarea
                    value={editedContent}
                    onChange={(e) => setEditedContent(e.target.value)}
                    className="w-full flex-1 resize-none focus:outline-none"
                    style={{ background: 'var(--fill-secondary)', color: 'var(--text-app)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-subhead)', border: 'none', boxShadow: '0 0 0 3px color-mix(in srgb, var(--accent-app) 20%, transparent)', minHeight: '200px' }}
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
                          <input type="text" placeholder="e.g. task-123" value={localParentTask} onChange={(e) => { setLocalParentTask(e.target.value); debouncedUpdate('parent_task', e.target.value) }} disabled={showHistory} className="w-full focus:outline-none disabled:opacity-50" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-md)', padding: '8px var(--space-3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', border: 'none' }} />
                        </div>
                        <div className="flex-1">
                          <label style={{ display: 'block', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>Due Date</label>
                          <div className="flex gap-2">
                            <input type="date" value={localDueDate ? localDueDate.split('T')[0] : ''} onChange={(e) => { const val = e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : ''; setLocalDueDate(val); debouncedUpdate('due_date', val || null) }} disabled={showHistory} className="flex-1 focus:outline-none disabled:opacity-50" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-md)', padding: '8px var(--space-3)', fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', border: 'none' }} />
                            {localDueDate && (
                              <button onClick={() => { setLocalDueDate(''); debouncedUpdate('due_date', null) }} disabled={showHistory} className="apple-press disabled:opacity-50" style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-red)' }}>Clear</button>
                            )}
                          </div>
                          {localDueDate && (() => {
                            const diff = Math.ceil((new Date(localDueDate) - new Date()) / (1000 * 60 * 60 * 24))
                            const label = diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Due today' : diff === 1 ? 'Due tomorrow' : `${diff}d remaining`
                            const c = diff < 0 ? 'var(--apple-red)' : diff <= 3 ? 'var(--apple-orange)' : 'var(--apple-green)'
                            return <p style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)', color: c, marginTop: '4px' }}>{label}</p>
                          })()}
                        </div>
                      </div>

                      {/* Lifecycle */}
                      <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--fill-secondary)' }}>
                        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-3)' }}>
                          <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Lifecycle</span>
                          {getLeadTime() && <span style={{ fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)', padding: '3px 10px', borderRadius: 'var(--radius-full)' }}>Lead: {getLeadTime()}</span>}
                        </div>
                        <div className="grid grid-cols-2 gap-y-3 gap-x-6">
                          {[
                            { label: 'Created', icon: Calendar, ts: task.created_at },
                            { label: 'Started', icon: Clock, ts: task.started_at },
                            { label: 'Reviewed', icon: Check, ts: task.reviewed_at },
                            { label: 'Completed', icon: Check, ts: task.done_at },
                          ].map(({ label, icon: Icon, ts }) => (
                            <div key={label} className="flex items-center gap-3">
                              <div style={{ padding: '6px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-card)' }}>
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
                        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--fill-secondary)' }}>
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
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a comment..."
                className="flex-1 focus:outline-none"
                style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-full)', padding: '10px 18px', fontSize: 'var(--text-subhead)', color: 'var(--text-app)', border: 'none' }}
                onFocus={e => e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-app) 25%, transparent)'}
                onBlur={e => e.target.style.boxShadow = 'none'}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment() }}
              />
              <button
                onClick={handleAddComment}
                disabled={!newComment.trim()}
                className="apple-press text-white disabled:opacity-40 flex items-center justify-center"
                style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'var(--accent-app)', boxShadow: 'var(--shadow-sm)', transition: `all var(--duration-fast) var(--ease-default)` }}
              >
                <Send className="w-[18px] h-[18px]" />
              </button>
            </div>
          </footer>
        )}
        {isEditing && !showHistory && (
          <footer className="shrink-0 flex justify-end gap-3 safe-bottom" style={{ padding: 'var(--space-4) var(--space-5)', borderTop: '0.5px solid var(--separator)', background: 'var(--bg-card)' }}>
            <button onClick={() => { setIsEditing(false); setEditedContent(task.content || '') }} className="apple-press" style={{ padding: '10px 20px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>
              Cancel
            </button>
            <button onClick={handleSaveEdit} className="apple-press text-white" style={{ padding: '10px 24px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)', boxShadow: 'var(--shadow-sm)' }}>
              Save Changes
            </button>
          </footer>
        )}
      </div>
    </ModalOverlay>
  )
}
