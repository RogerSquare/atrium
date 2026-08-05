// Files — read-only project file explorer (feat-project-hub-impl-001).
//
// Browses each project's linked source folder through the jailed
// /api/files endpoints. Lazy by construction: one directory listed per
// request, nothing recursive — the workspace contains repos whose caches
// run to gigabytes, and the ignore list (mirrored server-side) keeps them
// out of sight unless asked. Scopes to activeProject like every view.
//
// Downloads go through fetch+blob so the Authorization header rides along —
// a bare <a href> would either leak a token in the URL or arrive anonymous.

import { useEffect, useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { languageForPath } from './files/languageMap'

// Lazy: the highlighter + grammars are their own chunk, fetched only when a
// code file is actually previewed. The plain <pre> serves as the fallback.
const CodePreview = lazy(() => import('./files/CodePreview'))
import { FolderOpen, Folder, ChevronRight, ChevronDown, FileText, Download, Archive, Copy, Check, Eye, EyeOff, Unlink, RefreshCw, Code, History, AlertTriangle, X, GitPullRequest, Undo2 } from 'lucide-react'
import { apiFetch } from '../config'
import { useTaskData } from '../contexts/TaskContext'
import { buildFileTaskIndex } from '../lib/fileTaskIndex'
import { STATUS_COLOR } from '../constants'
import { Button } from './ui'

function relTime(ts) {
  if (!ts) return ''
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const isMarkdownPath = (p) => /\.(md|markdown|mdx)$/i.test(p || '')

const prNumberFromUrl = (url) => {
  const m = /\/pull\/(\d+)/.exec(url || '')
  return m ? Number(m[1]) : null
}

// Same prose treatment the task-description tab uses — READMEs read like docs,
// not like source dumps.
const PROSE_CLASSES = 'prose prose-app max-w-none prose-p:text-app-text prose-li:text-app-text prose-headings:text-app-text prose-strong:text-app-text prose-a:text-app-accent hover:prose-a:text-app-accent-hover prose-code:text-app-accent prose-code:bg-app-bg prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-blockquote:border-app-accent prose-blockquote:bg-app-bg/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:text-app-text-muted prose-hr:border-app-border'

async function blobDownload(url, filename) {
  const res = await apiFetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(href)
}

// Honest history: files_affected entries the server checked and could NOT
// find in the tree (renames/deletions). Collapsed to one line; expands to
// task → path pairs that still click through to the task. Dismissible per
// project (ui-files-unmatched-dismiss-001) — the parent keys the dismissal
// by entry count, so a CHANGED situation brings the note back.
function UnmatchedNote({ items, onSelectTask, onDismiss }) {
  const [open, setOpen] = useState(false)
  return (
    <div data-testid="files-unmatched-note" className="flex items-start gap-1" style={{ margin: '0 var(--space-2) var(--space-1)', paddingLeft: 22 }}>
      <div className="flex-1 min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="apple-press flex items-center gap-1.5"
        aria-expanded={open}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}
      >
        <AlertTriangle className="w-3 h-3 shrink-0" style={{ color: 'var(--apple-orange)', opacity: 0.7 }} />
        {items.length} history entr{items.length === 1 ? 'y' : 'ies'} reference paths not in the tree
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && (
        <div style={{ paddingLeft: 18 }}>
          {items.slice(0, 30).map(({ task, raw }, i) => (
            <button
              key={`${task.id}:${raw}:${i}`}
              onClick={() => onSelectTask?.(task)}
              className="apple-press w-full flex items-center gap-2 text-left"
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0', minWidth: 0 }}
              title={`${task.id} — ${task.title}`}
            >
              <span className="shrink-0" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>{task.id}</span>
              <span className="truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{raw}</span>
            </button>
          ))}
          {items.length > 30 && (
            <div style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)', padding: '2px 0' }}>…and {items.length - 30} more</div>
          )}
        </div>
      )}
      </div>
      <button
        data-testid="files-unmatched-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss this warning"
        title="Dismiss (returns if the entries change)"
        className="apple-press shrink-0"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px' }}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  )
}

// `tasks` + `onSelectTask` (feat-files-tasks-impl-001): power the task↔file
// join — count badges on the tree, the "Touched by" panel beside previews,
// and per-project stale-history notes. Wired from FocalZone like DemosView.
// `selectedTask` (feat-files-highlight-001): the open task's files light up
// in the tree — the reverse affordance of the touched-by panel.
export default function FilesView({ tasks = [], onSelectTask, selectedTask = null }) {
  const { activeProject, allProjects, activeWorkspace } = useTaskData()
  const [info, setInfo] = useState(null)          // { configured, projects } | null
  const [error, setError] = useState(null)
  const [showIgnored, setShowIgnored] = useState(false)
  const [expanded, setExpanded] = useState({})    // `${project}:${path}` -> true
  const [listings, setListings] = useState({})    // `${project}:${path}` -> entries | 'loading' | { error }
  const [preview, setPreview] = useState(null)    // { project, path, state, text?, error? }
  const [copied, setCopied] = useState(false)
  const [zipBusy, setZipBusy] = useState(null)
  const [rawMd, setRawMd] = useState(false)       // markdown files: raw source instead of rendered
  const [touchedOpen, setTouchedOpen] = useState(false) // touched-by panel: minimized by default
  const [highlightLine, setHighlightLine] = useState(null) // clicked line in the code preview
  // Tree width (ui-files-tree-lines-001): smaller default, drag-resizable,
  // persisted so it sticks where you left it across reloads.
  const TREE_DEFAULT = 320, TREE_MIN = 220, TREE_MAX = 560
  const clampTree = (w) => Math.min(TREE_MAX, Math.max(TREE_MIN, w))
  const [treeWidth, setTreeWidth] = useState(() => {
    const stored = Number.parseInt(localStorage.getItem('taskBoardFilesTreeWidth'), 10)
    return Number.isFinite(stored) ? clampTree(stored) : TREE_DEFAULT
  })
  const persistTreeWidth = (w) => { try { localStorage.setItem('taskBoardFilesTreeWidth', String(w)) } catch { /* full */ } }
  const onTreeResizeStart = (e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = treeWidth
    let latest = startWidth
    const onMove = (ev) => { latest = clampTree(startWidth + (ev.clientX - startX)); setTreeWidth(latest) }
    const onUp = () => {
      persistTreeWidth(latest)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const resetTreeWidth = () => { setTreeWidth(TREE_DEFAULT); persistTreeWidth(TREE_DEFAULT) }
  // PR diff mode (feat-files-pr-diff-001): when set, the preview shows what a
  // task's PR changed in THIS file instead of the current content.
  const [diff, setDiff] = useState(null) // { state, pr, prUrl, taskId, patch?, additions?, deletions?, error? }
  const loadDiff = useCallback(async (task) => {
    const pr = prNumberFromUrl(task.github_pr_url)
    if (!pr || !preview) return
    const base = { pr, prUrl: task.github_pr_url, taskId: task.id }
    setDiff({ ...base, state: 'loading' })
    try {
      const res = await apiFetch(`/api/files/pr-diff?${new URLSearchParams({ project: preview.project, pr: String(pr), path: preview.path })}`)
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
      setDiff({ ...base, state: 'ok', ...body })
    } catch (e) {
      setDiff({ ...base, state: 'error', error: e.message })
    }
  }, [preview])
  // Dismissed not-in-tree warnings, keyed folder -> entry count. Count as
  // signature: if the stale set grows or shrinks, the note honestly returns.
  const [unmatchedDismissed, setUnmatchedDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('taskBoardFilesUnmatchedDismissed')) || {} } catch { return {} }
  })
  const dismissUnmatched = useCallback((folder, count) => {
    setUnmatchedDismissed((prev) => {
      const next = { ...prev, [folder]: count }
      try { localStorage.setItem('taskBoardFilesUnmatchedDismissed', JSON.stringify(next)) } catch { /* full/blocked */ }
      return next
    })
  }, [])

  // The user's explicit expand/collapse choices, persisted so the tree stops
  // "resetting minimized" on every visit. Read once per mount.
  const storedExpanded = useRef((() => {
    try { return JSON.parse(localStorage.getItem('taskBoardFilesExpanded')) || {} } catch { return {} }
  })())
  const rememberToggle = useCallback((key, open) => {
    storedExpanded.current[key] = open
    try { localStorage.setItem('taskBoardFilesExpanded', JSON.stringify(storedExpanded.current)) } catch { /* full/blocked */ }
  }, [])

  const loadProjects = useCallback(async () => {
    setError(null)
    try {
      const res = await apiFetch('/api/files/projects')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      setInfo(body)
      // Roots open by default (feat-files-tasks-impl-001) — the tree used to
      // reset collapsed on every visit because nothing persisted. The user's
      // explicit toggles (stored) override the default in either direction.
      setExpanded((prev) => {
        const next = { ...prev }
        for (const p of body.projects || []) {
          if (!p.linked) continue
          const key = `${p.folder}:`
          if (!(key in next)) next[key] = storedExpanded.current[key] !== undefined ? storedExpanded.current[key] : true
        }
        // Restore stored sub-directory choices too (only opens survive — a
        // stored `false` just stays closed, which is the default for dirs).
        for (const [key, open] of Object.entries(storedExpanded.current)) {
          if (open && !(key in next)) next[key] = true
        }
        return next
      })
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  // --- task↔file join ------------------------------------------------------
  // Tasks' files_affected entries are agent-typed strings; the server batch-
  // resolves them to jail-verified tree paths (incl. the stale-prefix
  // rescue). One fetch per project per distinct path-set; keyed by FOLDER —
  // that is what task.project holds.
  const [resolutions, setResolutions] = useState({}) // folder -> { raw: rel|null }
  const resolveRequested = useRef({})                // folder -> last requested path-set key
  const pathsByFolder = useMemo(() => {
    const m = {}
    for (const t of tasks) {
      const fa = t.files_affected || []
      if (!fa.length) continue
      const folder = t.project || 'Root'
      const set = m[folder] || (m[folder] = new Set())
      for (const p of fa) if (typeof p === 'string') set.add(p)
    }
    return m
  }, [tasks])
  useEffect(() => {
    for (const p of info?.projects || []) {
      if (!p.linked) continue
      const set = pathsByFolder[p.folder]
      if (!set || set.size === 0) continue
      const paths = [...set].sort().slice(0, 2000)
      const key = paths.join('\n')
      if (resolveRequested.current[p.folder] === key) continue
      resolveRequested.current[p.folder] = key
      apiFetch(`/api/files/resolve-paths?${new URLSearchParams({ project: p.folder })}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => { if (body?.resolutions) setResolutions((prev) => ({ ...prev, [p.folder]: body.resolutions })) })
        .catch(() => { /* view degrades to no badges — never blocks browsing */ })
    }
  }, [info, pathsByFolder])
  const indexes = useMemo(() => {
    const m = {}
    for (const p of info?.projects || []) {
      if (p.linked) m[p.folder] = buildFileTaskIndex(tasks, p.folder, resolutions[p.folder] || {})
    }
    return m
  }, [info, tasks, resolutions])

  // The open task's files (feat-files-highlight-001): resolved paths light
  // up in that project's tree; checked-and-missing paths are counted for the
  // header chip. Null whenever no task is open or nothing resolves.
  const highlight = useMemo(() => {
    const fa = selectedTask?.files_affected || []
    if (!fa.length) return null
    const folder = selectedTask.project || 'Root'
    const res = resolutions[folder] || {}
    const files = new Set()
    const dirs = new Set()
    let missing = 0
    for (const raw of fa) {
      if (!(raw in res)) continue
      const rel = res[raw]
      if (!rel) { missing++; continue }
      files.add(rel)
      const parts = rel.split('/')
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'))
    }
    if (!files.size && !missing) return null
    return { folder, taskId: selectedTask.id, files, dirs, missing }
  }, [selectedTask, resolutions])

  // Auto-expand ancestors of highlighted files so nothing lit is hidden.
  // EPHEMERAL by design: goes to `expanded` state only, never through
  // rememberToggle — closing the task must not have rewritten the user's
  // persisted choices.
  useEffect(() => {
    if (!highlight?.files.size) return
    setExpanded((prev) => {
      const next = { ...prev }
      next[`${highlight.folder}:`] = true
      for (const dir of highlight.dirs) next[`${highlight.folder}:${dir}`] = true
      return next
    })
  }, [highlight])

  // In-flight guard: StrictMode double-invokes and the refetch effect below
  // must never issue two identical listings at once.
  const inflight = useRef(new Set())
  const fetchDir = useCallback(async (project, relPath) => {
    const key = `${project}:${relPath}`
    if (inflight.current.has(key)) return
    inflight.current.add(key)
    setListings((prev) => ({ ...prev, [key]: 'loading' }))
    try {
      const qs = new URLSearchParams({ project, path: relPath })
      if (showIgnored) qs.set('all', '1')
      const res = await apiFetch(`/api/files/list?${qs}`)
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `HTTP ${res.status}`)
      const body = await res.json()
      setListings((prev) => ({ ...prev, [key]: body.entries }))
    } catch (e) {
      setListings((prev) => ({ ...prev, [key]: { error: e.message } }))
    } finally {
      inflight.current.delete(key)
    }
  }, [showIgnored])

  const toggleDir = useCallback((project, relPath) => {
    const key = `${project}:${relPath}`
    const willOpen = !expanded[key]
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
    rememberToggle(key, willOpen)
    if (willOpen && !listings[key]) fetchDir(project, relPath)
  }, [expanded, listings, fetchDir, rememberToggle])

  // Toggling ignored-visibility invalidates every cached listing; the effect
  // below then re-fetches whatever is still expanded.
  useEffect(() => { setListings({}) }, [showIgnored])
  useEffect(() => {
    for (const key of Object.keys(expanded)) {
      if (expanded[key] && !listings[key]) {
        const idx = key.indexOf(':')
        fetchDir(key.slice(0, idx), key.slice(idx + 1))
      }
    }
  }, [expanded, listings, fetchDir])

  const openFile = useCallback(async (project, relPath) => {
    setRawMd(false)
    setTouchedOpen(false) // every file starts with the panel minimized
    setDiff(null)         // and with the current content, not a stale diff
    setHighlightLine(null)
    setPreview({ project, path: relPath, state: 'loading' })
    try {
      const res = await apiFetch(`/api/files/content?${new URLSearchParams({ project, path: relPath })}`)
      if (res.ok) {
        setPreview({ project, path: relPath, state: 'ok', text: await res.text() })
      } else {
        const body = await res.json().catch(() => null)
        setPreview({ project, path: relPath, state: 'blocked', error: body?.error || `HTTP ${res.status}` })
      }
    } catch (e) {
      setPreview({ project, path: relPath, state: 'blocked', error: e.message })
    }
  }, [])

  const copyPath = useCallback((text) => {
    navigator.clipboard?.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [])

  const downloadZip = useCallback(async (project) => {
    setZipBusy(project)
    try {
      await blobDownload(`/api/files/archive?${new URLSearchParams({ project })}`, `${project}.zip`)
    } catch (e) {
      alert(`Download failed: ${e.message}`)
    } finally {
      setZipBusy(null)
    }
  }, [])

  const scoped = !!activeProject && activeProject !== 'All'
  const visibleProjects = useMemo(() => {
    const all = info?.projects || []
    // /api/files/projects is registry-wide; the workspace lens is applied
    // here client-side — roots belonging to OTHER workspaces do not exist.
    // A folder the registry doesn't know resolves to 'personal', same rule
    // as task filtering: nothing may vanish from every workspace.
    const wsByFolder = new Map(allProjects.map((p) => [p.folder || p, p.workspace || 'personal']))
    const named = all.filter((p) => p.folder !== 'Root'
      && (wsByFolder.get(p.folder) ?? 'personal') === activeWorkspace)
    return scoped ? named.filter((p) => p.folder === activeProject || p.project === activeProject) : named
  }, [info, scoped, activeProject, allProjects, activeWorkspace])

  const renderEntries = (project, relPath, depth) => {
    const key = `${project}:${relPath}`
    const listing = listings[key]
    if (listing === 'loading' || listing === undefined) {
      return <div style={{ paddingLeft: depth * 16 + 24, fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }} className="italic animate-pulse py-1">loading…</div>
    }
    if (listing.error) {
      return <div style={{ paddingLeft: depth * 16 + 24, fontSize: 'var(--text-caption2)', color: 'var(--apple-red)' }} className="py-1">{listing.error}</div>
    }
    if (listing.length === 0) {
      return <div style={{ paddingLeft: depth * 16 + 24, fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }} className="py-1">empty</div>
    }
    const idx = indexes[project]
    return listing.map((entry) => {
      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name
      const childKey = `${project}:${childPath}`
      const isOpen = !!expanded[childKey]
      const dim = entry.ignored || entry.name.startsWith('.')
      const touchCount = entry.type === 'dir'
        ? (idx?.dirCounts.get(childPath) || 0)
        : (idx?.byPath.get(childPath)?.length || 0)
      const isHl = highlight?.folder === project && (entry.type === 'file'
        ? highlight.files.has(childPath)
        : highlight.dirs.has(childPath))
      const isSelected = preview?.project === project && preview?.path === childPath
      return (
        <div key={childKey}>
          <button
            data-testid={entry.type === 'dir' ? 'files-dir' : 'files-file'}
            onClick={() => (entry.type === 'dir' ? toggleDir(project, childPath) : openFile(project, childPath))}
            className="apple-press w-full flex items-center gap-1.5 text-left"
            style={{
              paddingLeft: depth * 16 + 8,
              paddingTop: 3,
              paddingBottom: 3,
              background: isSelected ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)'
                : isHl && entry.type === 'file' ? 'color-mix(in srgb, var(--apple-yellow) 10%, transparent)'
                : 'transparent',
              boxShadow: isHl && entry.type === 'file' ? 'inset 2px 0 0 var(--apple-yellow)' : 'none',
              border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
            }}
          >
            {entry.type === 'dir'
              ? (isOpen ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />)
              : <span className="w-3 shrink-0" />}
            {entry.type === 'dir'
              ? <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-app)', opacity: dim ? 0.5 : 0.9 }} />
              : <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)', opacity: dim ? 0.5 : 1 }} />}
            <span className="truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', color: dim ? 'var(--text-tertiary)' : 'var(--text-app)' }}>{entry.name}</span>
            {isHl && entry.type === 'file' && (
              <span data-testid="files-highlighted" title={`Changed in ${highlight.taskId}`} className="shrink-0" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--apple-yellow)' }} />
            )}
            <span className="flex-1" />
            {touchCount > 0 && (
              <span
                data-testid="files-task-count"
                title={entry.type === 'dir' ? `${touchCount} task-touched file${touchCount === 1 ? '' : 's'} inside` : `Touched by ${touchCount} task${touchCount === 1 ? '' : 's'}`}
                className="shrink-0"
                style={{ minWidth: 16, padding: '0 4px', borderRadius: 'var(--radius-full)', fontSize: '10px', fontWeight: 'var(--font-semibold)', textAlign: 'center', background: 'color-mix(in srgb, var(--accent-app) 14%, transparent)', color: 'var(--accent-app)' }}
              >
                {touchCount}
              </span>
            )}
            {entry.type === 'file' && (
              <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{fmtSize(entry.size)}</span>
            )}
          </button>
          {entry.type === 'dir' && isOpen && renderEntries(project, childPath, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div data-testid="files-view" className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 'var(--space-4)', padding: '0 var(--space-1)' }}>
        <h1 style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <FolderOpen className="w-5 h-5" style={{ color: 'var(--accent-app)' }} />
          Files{scoped ? ` · ${activeProject === 'Root' ? 'No project' : activeProject}` : ''}
        </h1>
        {highlight && (
          <span
            data-testid="files-highlight-chip"
            className="inline-flex items-center gap-1.5"
            style={{ padding: '2px 10px', borderRadius: 'var(--radius-full)', background: 'color-mix(in srgb, var(--apple-yellow) 14%, transparent)', color: 'var(--text-app)', fontSize: 'var(--text-caption2)' }}
            title={`Files changed in ${highlight.taskId} are highlighted in the tree`}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--apple-yellow)', flexShrink: 0 }} />
            highlighting {highlight.files.size} file{highlight.files.size === 1 ? '' : 's'} from <span style={{ fontFamily: 'var(--font-mono)' }}>{highlight.taskId}</span>
            {highlight.missing > 0 && <span style={{ color: 'var(--text-muted)' }}>· {highlight.missing} not in tree</span>}
          </span>
        )}
        <div className="flex-1" />
        <button
          data-testid="files-show-ignored"
          onClick={() => setShowIgnored((v) => !v)}
          className="apple-press inline-flex items-center gap-1"
          style={{ padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-sm)', background: showIgnored ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)', color: showIgnored ? 'var(--accent-app)' : 'var(--text-app)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', border: 'none', cursor: 'pointer' }}
          title={showIgnored ? 'Hide build/cache folders' : 'Show build/cache folders (.git, node_modules, …)'}
        >
          {showIgnored ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {showIgnored ? 'All files' : 'Source only'}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2" style={{ color: 'var(--apple-red)', fontSize: 'var(--text-caption1)' }}>
          Could not load projects: {error}
          <Button size="sm" onClick={loadProjects}><RefreshCw className="w-3 h-3" /> Retry</Button>
        </div>
      )}
      {info && !info.configured && (
        <div style={{ color: 'var(--text-muted)' }}>No working directory configured — set one in Settings → Project first.</div>
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Tree */}
        <div data-testid="files-tree" className="overflow-y-auto custom-scrollbar" style={{ flex: `0 0 ${treeWidth}px`, borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)', padding: 'var(--space-2)' }}>
          {visibleProjects.map((p) => (
            <div key={p.id} style={{ marginBottom: 'var(--space-2)' }}>
              <div className="flex items-center gap-2" data-testid="files-project-root" style={{ padding: 'var(--space-1) var(--space-2)' }}>
                <button
                  onClick={() => p.linked && toggleDir(p.folder, '')}
                  className="apple-press flex items-center gap-2 flex-1 min-w-0 text-left"
                  style={{ background: 'transparent', border: 'none', cursor: p.linked ? 'pointer' : 'default' }}
                  disabled={!p.linked}
                >
                  {p.linked
                    ? (expanded[`${p.folder}:`] ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />)
                    : <Unlink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                  <span className="truncate" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: p.linked ? 'var(--text-app)' : 'var(--text-tertiary)' }}>{p.project}</span>
                </button>
                {p.linked ? (
                  <button
                    data-testid="files-zip"
                    onClick={() => downloadZip(p.folder)}
                    disabled={zipBusy === p.folder}
                    className="apple-press shrink-0 flex items-center gap-1"
                    title="Download project as zip (source only — caches excluded)"
                    style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--fill-secondary)', color: 'var(--text-muted)', fontSize: 'var(--text-caption2)', border: 'none', cursor: 'pointer', opacity: zipBusy === p.folder ? 0.5 : 1 }}
                  >
                    <Archive className="w-3 h-3" /> zip
                  </button>
                ) : (
                  <span data-testid="files-unlinked" className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }} title='Set a "directory" on the project to link its folder'>
                    no folder linked
                  </span>
                )}
              </div>
              {p.linked && (indexes[p.folder]?.unmatched.length || 0) > 0
                && unmatchedDismissed[p.folder] !== indexes[p.folder].unmatched.length && (
                <UnmatchedNote
                  items={indexes[p.folder].unmatched}
                  onSelectTask={onSelectTask}
                  onDismiss={() => dismissUnmatched(p.folder, indexes[p.folder].unmatched.length)}
                />
              )}
              {p.linked && expanded[`${p.folder}:`] && renderEntries(p.folder, '', 1)}
            </div>
          ))}
          {info?.configured && visibleProjects.length === 0 && (
            <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>No projects to browse.</div>
          )}
        </div>

        {/* Resize handle — drag to size the tree, double-click resets. */}
        <div
          data-testid="files-tree-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file tree"
          title="Drag to resize · double-click to reset"
          onMouseDown={onTreeResizeStart}
          onDoubleClick={resetTreeWidth}
          className="shrink-0"
          style={{ width: 10, cursor: 'col-resize', display: 'flex', alignItems: 'stretch', justifyContent: 'center' }}
        >
          <div style={{ width: 1, background: 'var(--separator)' }} />
        </div>

        {/* Preview */}
        <div className="flex-1 min-w-0 flex flex-col" style={{ borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)' }}>
          {!preview ? (
            <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-caption1)' }}>
              Select a file to preview it
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2" style={{ padding: 'var(--space-2) var(--space-3)', borderBottom: '0.5px solid var(--separator)' }}>
                <span className="truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }} title={`${preview.project}/${preview.path}`}>
                  {preview.path}
                </span>
                <span className="flex-1" />
                {diff && (
                  <>
                    <span data-testid="files-diff-header" className="shrink-0 inline-flex items-center gap-1" style={{ padding: '2px 8px', borderRadius: 'var(--radius-full)', background: 'color-mix(in srgb, var(--accent-app) 12%, transparent)', color: 'var(--accent-app)', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-medium)' }}>
                      <GitPullRequest className="w-3 h-3" />
                      PR #{diff.pr}{diff.state === 'ok' ? ` · +${diff.additions} −${diff.deletions}` : ''}
                    </span>
                    <button
                      data-testid="files-diff-back"
                      onClick={() => setDiff(null)}
                      aria-label="Back to current file"
                      title="Back to current file"
                      className="apple-press shrink-0"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
                {!diff && isMarkdownPath(preview.path) && preview.state === 'ok' && (
                  <button
                    data-testid="files-md-raw-toggle"
                    onClick={() => setRawMd((v) => !v)}
                    className="apple-press shrink-0"
                    title={rawMd ? 'Rendered markdown' : 'Raw source'}
                    aria-label={rawMd ? 'Show rendered markdown' : 'Show raw source'}
                    aria-pressed={rawMd}
                    style={{ color: rawMd ? 'var(--accent-app)' : 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  >
                    <Code className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => copyPath(`${preview.project}/${preview.path}`)} className="apple-press shrink-0" title="Copy path" aria-label="Copy path" style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                  {copied ? <Check className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  data-testid="files-download"
                  onClick={() => blobDownload(`/api/files/download?${new URLSearchParams({ project: preview.project, path: preview.path })}`, preview.path.split('/').pop()).catch((e) => alert(`Download failed: ${e.message}`))}
                  className="apple-press shrink-0"
                  title="Download file" aria-label="Download file"
                  style={{ color: 'var(--text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
              {(() => {
                const touched = indexes[preview.project]?.byPath.get(preview.path)
                if (!touched?.length) return null
                return (
                  <div data-testid="files-touched-by" style={{ borderBottom: '0.5px solid var(--separator)', padding: 'var(--space-2) var(--space-3)', maxHeight: 150, overflowY: 'auto' }} className="custom-scrollbar shrink-0">
                    {/* Minimized by default (ui-files-preview-001) — the list
                        competes with the code for vertical space. */}
                    <button
                      data-testid="files-touched-toggle"
                      onClick={() => setTouchedOpen((v) => !v)}
                      aria-expanded={touchedOpen}
                      className="apple-press w-full flex items-center gap-1.5"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 'var(--text-caption2)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)', padding: 0, marginBottom: touchedOpen ? 4 : 0 }}
                    >
                      <History className="w-3 h-3" />
                      Change History by {touched.length} task{touched.length === 1 ? '' : 's'}
                      {touchedOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {touchedOpen && touched.map(({ task, ts }) => (
                      <div key={task.id} className="flex items-center gap-1" style={{ minWidth: 0 }}>
                        <button
                          data-testid="files-touched-task"
                          onClick={() => onSelectTask?.(task)}
                          className="apple-press flex-1 flex items-center gap-2 text-left"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 0', minWidth: 0, borderRadius: 'var(--radius-sm)' }}
                          title={`${task.id} — ${task.title} (${task.status})`}
                        >
                          <span className="shrink-0" style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_COLOR[task.status] || 'var(--text-muted)' }} />
                          <span className="shrink-0" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption2)', color: 'var(--text-muted)' }}>{task.id}</span>
                          <span className="truncate" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-app)' }}>{task.title}</span>
                          <span className="flex-1" />
                          <span className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }}>{relTime(ts)}</span>
                        </button>
                        {prNumberFromUrl(task.github_pr_url) && (
                          <button
                            data-testid="files-diff-toggle"
                            onClick={() => loadDiff(task)}
                            aria-label={`View this file's changes from PR #${prNumberFromUrl(task.github_pr_url)}`}
                            title={`View this file's changes from PR #${prNumberFromUrl(task.github_pr_url)}`}
                            className="apple-press shrink-0"
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: diff?.taskId === task.id ? 'var(--accent-app)' : 'var(--text-tertiary)', padding: '2px' }}
                          >
                            <GitPullRequest className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })()}
              <div data-testid="files-preview" className="flex-1 overflow-auto custom-scrollbar" style={{ padding: 'var(--space-3)' }}>
                {diff && (
                  <div data-testid="files-diff-view">
                    {diff.state === 'loading' && <div className="italic animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading PR diff…</div>}
                    {diff.state === 'error' && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>
                        Could not load the diff: {diff.error} — <a href={diff.prUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-app)' }}>open PR #{diff.pr} on GitHub</a>
                      </div>
                    )}
                    {diff.state === 'ok' && (diff.patch ? (
                      <Suspense fallback={<pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', whiteSpace: 'pre-wrap' }}>{diff.patch}</pre>}>
                        <CodePreview language="diff" code={diff.patch} />
                      </Suspense>
                    ) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>
                        GitHub did not provide a patch for this file (usually it is too large) — <a href={diff.prUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-app)' }}>view it on PR #{diff.pr}</a>
                      </div>
                    ))}
                  </div>
                )}
                {!diff && preview.state === 'loading' && <div className="italic animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading…</div>}
                {!diff && preview.state === 'blocked' && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>
                    {preview.error} — use the download button instead.
                  </div>
                )}
                {!diff && preview.state === 'ok' && (() => {
                  if (isMarkdownPath(preview.path) && !rawMd) {
                    return (
                      <div data-testid="files-md-rendered" className={PROSE_CLASSES} style={{ fontSize: 'var(--text-subhead)' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown>
                      </div>
                    )
                  }
                  const plain = (
                    <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', lineHeight: 1.6, color: 'var(--text-app)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview.text}</pre>
                  )
                  const language = isMarkdownPath(preview.path) ? null : languageForPath(preview.path)
                  if (!language) return plain
                  return (
                    <Suspense fallback={plain}>
                      <CodePreview
                        language={language}
                        code={preview.text}
                        showLineNumbers
                        highlightedLine={highlightLine}
                        // Click a line to point at it: highlight + copy a
                        // pasteable project/path:line reference.
                        onLineClick={(n) => {
                          setHighlightLine((cur) => (cur === n ? null : n))
                          copyPath(`${preview.project}/${preview.path}:${n}`)
                        }}
                      />
                    </Suspense>
                  )
                })()}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
