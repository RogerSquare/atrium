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

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { FolderOpen, Folder, ChevronRight, ChevronDown, FileText, Download, Archive, Copy, Check, Eye, EyeOff, Unlink, RefreshCw, Code } from 'lucide-react'
import { apiFetch } from '../config'
import { useTaskData } from '../contexts/TaskContext'
import { Button } from './ui'

function fmtSize(n) {
  if (n == null) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const isMarkdownPath = (p) => /\.(md|markdown|mdx)$/i.test(p || '')

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

export default function FilesView() {
  const { activeProject } = useTaskData()
  const [info, setInfo] = useState(null)          // { configured, projects } | null
  const [error, setError] = useState(null)
  const [showIgnored, setShowIgnored] = useState(false)
  const [expanded, setExpanded] = useState({})    // `${project}:${path}` -> true
  const [listings, setListings] = useState({})    // `${project}:${path}` -> entries | 'loading' | { error }
  const [preview, setPreview] = useState(null)    // { project, path, state, text?, error? }
  const [copied, setCopied] = useState(false)
  const [zipBusy, setZipBusy] = useState(null)
  const [rawMd, setRawMd] = useState(false)       // markdown files: raw source instead of rendered

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
          const key = `${p.project}:`
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
    const named = all.filter((p) => p.folder !== 'Root')
    return scoped ? named.filter((p) => p.folder === activeProject || p.project === activeProject) : named
  }, [info, scoped, activeProject])

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
    return listing.map((entry) => {
      const childPath = relPath ? `${relPath}/${entry.name}` : entry.name
      const childKey = `${project}:${childPath}`
      const isOpen = !!expanded[childKey]
      const dim = entry.ignored || entry.name.startsWith('.')
      return (
        <div key={childKey}>
          <button
            data-testid={entry.type === 'dir' ? 'files-dir' : 'files-file'}
            onClick={() => (entry.type === 'dir' ? toggleDir(project, childPath) : openFile(project, childPath))}
            className="apple-press w-full flex items-center gap-1.5 text-left"
            style={{ paddingLeft: depth * 16 + 8, paddingTop: 3, paddingBottom: 3, background: preview?.project === project && preview?.path === childPath ? 'color-mix(in srgb, var(--accent-app) 8%, transparent)' : 'transparent', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-sm)' }}
          >
            {entry.type === 'dir'
              ? (isOpen ? <ChevronDown className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3 h-3 shrink-0" style={{ color: 'var(--text-tertiary)' }} />)
              : <span className="w-3 shrink-0" />}
            {entry.type === 'dir'
              ? <Folder className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent-app)', opacity: dim ? 0.5 : 0.9 }} />
              : <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)', opacity: dim ? 0.5 : 1 }} />}
            <span className="truncate" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', color: dim ? 'var(--text-tertiary)' : 'var(--text-app)' }}>{entry.name}</span>
            <span className="flex-1" />
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

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Tree */}
        <div className="overflow-y-auto custom-scrollbar" style={{ flex: '0 0 44%', minWidth: 280, borderRadius: 'var(--radius-md)', background: 'var(--bg-secondary)', border: 'var(--border-hairline)', padding: 'var(--space-2)' }}>
          {visibleProjects.map((p) => (
            <div key={p.id} style={{ marginBottom: 'var(--space-2)' }}>
              <div className="flex items-center gap-2" data-testid="files-project-root" style={{ padding: 'var(--space-1) var(--space-2)' }}>
                <button
                  onClick={() => p.linked && toggleDir(p.project, '')}
                  className="apple-press flex items-center gap-2 flex-1 min-w-0 text-left"
                  style={{ background: 'transparent', border: 'none', cursor: p.linked ? 'pointer' : 'default' }}
                  disabled={!p.linked}
                >
                  {p.linked
                    ? (expanded[`${p.project}:`] ? <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />)
                    : <Unlink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-tertiary)' }} />}
                  <span className="truncate" style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: p.linked ? 'var(--text-app)' : 'var(--text-tertiary)' }}>{p.project}</span>
                </button>
                {p.linked ? (
                  <button
                    data-testid="files-zip"
                    onClick={() => downloadZip(p.project)}
                    disabled={zipBusy === p.project}
                    className="apple-press shrink-0 flex items-center gap-1"
                    title="Download project as zip (source only — caches excluded)"
                    style={{ padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--fill-secondary)', color: 'var(--text-muted)', fontSize: 'var(--text-caption2)', border: 'none', cursor: 'pointer', opacity: zipBusy === p.project ? 0.5 : 1 }}
                  >
                    <Archive className="w-3 h-3" /> zip
                  </button>
                ) : (
                  <span data-testid="files-unlinked" className="shrink-0" style={{ fontSize: 'var(--text-caption2)', color: 'var(--text-tertiary)' }} title='Set a "directory" on the project to link its folder'>
                    no folder linked
                  </span>
                )}
              </div>
              {p.linked && expanded[`${p.project}:`] && renderEntries(p.project, '', 1)}
            </div>
          ))}
          {info?.configured && visibleProjects.length === 0 && (
            <div style={{ padding: 'var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>No projects to browse.</div>
          )}
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
                {isMarkdownPath(preview.path) && preview.state === 'ok' && (
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
              <div data-testid="files-preview" className="flex-1 overflow-auto custom-scrollbar" style={{ padding: 'var(--space-3)' }}>
                {preview.state === 'loading' && <div className="italic animate-pulse" style={{ color: 'var(--text-muted)' }}>Loading…</div>}
                {preview.state === 'blocked' && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-caption1)' }}>
                    {preview.error} — use the download button instead.
                  </div>
                )}
                {preview.state === 'ok' && (
                  isMarkdownPath(preview.path) && !rawMd ? (
                    <div data-testid="files-md-rendered" className={PROSE_CLASSES} style={{ fontSize: 'var(--text-subhead)' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', lineHeight: 1.6, color: 'var(--text-app)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{preview.text}</pre>
                  )
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
