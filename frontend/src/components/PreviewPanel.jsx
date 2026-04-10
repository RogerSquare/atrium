import { useState, useRef, useEffect, useCallback } from 'react'
import {
  X, RefreshCw, ArrowLeft, ArrowRight, ExternalLink,
  Monitor, Tablet, Smartphone, Laptop,
  Plus, Loader2, AlertTriangle, Zap, Play, Columns2, Square
} from 'lucide-react'
import { apiFetch } from '../config'
import ModalOverlay from './ModalOverlay'

const VIEWPORT_PRESETS = [
  { id: 'responsive', label: 'Responsive', icon: Monitor, width: null },
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: 1440 },
  { id: 'laptop', label: 'Laptop', icon: Laptop, width: 1024 },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: 768 },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: 375 },
]

const MAX_TABS = 5
const STORAGE_KEY = 'previewLastService'
const VIEWPORT_STORAGE_KEY = 'previewViewportPerProject'

const normalizeForMatch = (str) => (str || '').toLowerCase().replace(/[\s_-]+/g, '')

const getLastServiceForProject = (project) => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')[project] || null } catch { return null }
}
const saveLastServiceForProject = (project, serviceId) => {
  try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); s[project] = serviceId; localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch {}
}
const getViewportForProject = (project) => {
  try { return JSON.parse(localStorage.getItem(VIEWPORT_STORAGE_KEY) || '{}')[project] || 'responsive' } catch { return 'responsive' }
}
const saveViewportForProject = (project, viewport) => {
  try { const s = JSON.parse(localStorage.getItem(VIEWPORT_STORAGE_KEY) || '{}'); s[project] = viewport; localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(s)) } catch {}
}

function IframePane({ service, socket, autoRefresh, viewport, onViewportChange }) {
  const [urlPath, setUrlPath] = useState('/')
  const [iframeKey, setIframeKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [lastReload, setLastReload] = useState(null)
  const iframeRef = useRef(null)

  useEffect(() => {
    if (!socket || !autoRefresh || !service) return
    socket.emit('preview_watch_start', { serviceId: service.id })
    const handleReload = ({ serviceId }) => {
      if (serviceId === service.id) {
        setReloading(true)
        setIframeKey(k => k + 1)
        setLoading(true)
        setLastReload(new Date())
        setTimeout(() => setReloading(false), 800)
      }
    }
    socket.on('preview_reload', handleReload)
    return () => {
      socket.off('preview_reload', handleReload)
      socket.emit('preview_watch_stop', { serviceId: service.id })
    }
  }, [socket, service, autoRefresh])

  const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  const iframeSrc = service ? (isLocal ? `http://localhost:${service.port}${urlPath}` : `/api/preview/${service.port}${urlPath}`) : null
  const activePreset = VIEWPORT_PRESETS.find(v => v.id === viewport)
  const iframeWidth = activePreset?.width

  const handleRefresh = () => { setIframeKey(k => k + 1); setLoading(true); setError(false) }
  const handleNavigate = (e) => { e.preventDefault(); handleRefresh() }

  if (!service) return (
    <div className="flex-1 flex items-center justify-center h-full" style={{ background: 'var(--bg-tertiary)' }}>
      <div className="text-center">
        <Monitor className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
        <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>Select a service to preview</p>
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* Pane toolbar */}
      <div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
        <button onClick={() => { try { iframeRef.current?.contentWindow?.history.back() } catch(e) {} }} className="p-1 apple-press" style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }} title="Back">
          <ArrowLeft className="w-3.5 h-3.5" />
        </button>
        <button onClick={() => { try { iframeRef.current?.contentWindow?.history.forward() } catch(e) {} }} className="p-1 apple-press" style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }} title="Forward">
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <button onClick={handleRefresh} className="p-1 apple-press" style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }} title="Refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>

        <form onSubmit={handleNavigate} className="flex-1 flex items-center mx-1">
          <div className="flex-1 flex items-center gap-1 px-2 py-1" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>:{service.port}</span>
            <input type="text" value={urlPath} onChange={(e) => setUrlPath(e.target.value)} className="flex-1 bg-transparent outline-none min-w-0" style={{ fontSize: '11px', color: 'var(--text-app)' }} placeholder="/" />
          </div>
        </form>

        {/* Viewport presets */}
        <div className="flex items-center gap-0.5">
          {VIEWPORT_PRESETS.map(preset => {
            const Icon = preset.icon
            return (
              <button key={preset.id} onClick={() => onViewportChange(preset.id)} className="p-1 apple-press" style={{ borderRadius: 'var(--radius-sm)', color: viewport === preset.id ? 'var(--accent-app)' : 'var(--text-muted)', background: viewport === preset.id ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent' }} title={`${preset.label}${preset.width ? ` (${preset.width}px)` : ''}`}>
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
          {iframeWidth && <span style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginLeft: '2px' }}>{iframeWidth}px</span>}
        </div>

        <button onClick={() => window.open(`http://localhost:${service.port}${urlPath}`, '_blank')} className="p-1 apple-press" style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }} title="Open in browser">
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative overflow-hidden" style={{ background: '#1a1a2e' }}>
        <div className="w-full h-full flex items-start justify-center overflow-auto">
          <iframe
            ref={iframeRef}
            key={`${service.id}-${iframeKey}`}
            src={iframeSrc}
            onLoad={() => { setLoading(false); setError(false) }}
            onError={() => { setLoading(false); setError(true) }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            className="bg-white"
            style={{
              width: iframeWidth ? `${iframeWidth}px` : '100%', height: '100%',
              border: iframeWidth ? '1px solid var(--border-app)' : 'none',
              boxShadow: iframeWidth ? '0 0 20px rgba(0,0,0,0.3)' : 'none',
              transition: 'width 200ms ease',
            }}
          />
          {loading && !reloading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--bg-app) 80%, transparent)' }}>
              <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
            </div>
          )}
          {reloading && (
            <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)', borderRadius: 'var(--radius-md)', padding: '4px 8px' }}>
              <Zap className="w-3 h-3" style={{ color: 'var(--apple-green)' }} />
              <span style={{ fontSize: '10px', fontWeight: 'var(--font-semibold)', color: 'var(--apple-green)' }}>HMR</span>
            </div>
          )}
          {lastReload && !reloading && (
            <div className="absolute bottom-2 right-2 z-10" style={{ fontSize: '9px', color: 'var(--text-tertiary)', background: 'color-mix(in srgb, var(--bg-card) 90%, transparent)', padding: '2px 6px', borderRadius: 'var(--radius-sm)' }}>
              Last reload: {lastReload.toLocaleTimeString()}
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--bg-app) 90%, transparent)' }}>
              <div className="text-center">
                <AlertTriangle className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--apple-orange)' }} />
                <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)', fontWeight: 'var(--font-medium)' }}>Cannot reach localhost:{service.port}</p>
                <button onClick={handleRefresh} className="apple-press mt-3" style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', border: '1px solid color-mix(in srgb, var(--accent-app) 30%, transparent)' }}>Retry</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PreviewPanel({ services, onClose, socket, activeProject }) {
  const frontendServices = services.filter(s => {
    if (s.preview === true) return true
    if (s.preview === false) return false
    const name = (s.name || '').toLowerCase()
    const group = (s.group || '').toLowerCase()
    const cmd = (s.startCmd || '').toLowerCase()
    const backendIndicators = ['backend', 'server', 'api', 'database', 'db', 'redis', 'mongo', 'postgres']
    const frontendIndicators = ['frontend', 'client', 'ui', 'web', 'app', 'vite', 'next', 'react', 'vue', 'svelte', 'angular']
    if (frontendIndicators.some(f => name.includes(f) || cmd.includes(f))) return true
    if (backendIndicators.some(b => name.includes(b) || group.includes(b))) return false
    return true
  })

  // Group services by project
  const servicesByGroup = {}
  frontendServices.forEach(s => {
    const group = s.group || 'Other'
    if (!servicesByGroup[group]) servicesByGroup[group] = []
    servicesByGroup[group].push(s)
  })

  const [splitMode, setSplitMode] = useState(false)
  const [leftService, setLeftService] = useState(null)
  const [rightService, setRightService] = useState(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [leftViewport, setLeftViewport] = useState(() => getViewportForProject(activeProject || 'default'))
  const [rightViewport, setRightViewport] = useState('responsive')
  const [splitRatio, setSplitRatio] = useState(50)
  const [draggingSplit, setDraggingSplit] = useState(false)
  const containerRef = useRef(null)

  // Auto-select best service on mount
  useEffect(() => {
    if (leftService) return
    const running = frontendServices.filter(s => s.status === 'running')
    if (running.length === 0) return

    if (activeProject && activeProject !== 'All') {
      const lastId = getLastServiceForProject(activeProject)
      if (lastId) { const s = running.find(x => x.id === lastId); if (s) { setLeftService(s); return } }
      const norm = normalizeForMatch(activeProject)
      const match = running.find(s => normalizeForMatch(s.group) === norm)
      if (match) { setLeftService(match); return }
    }
    setLeftService(running.find(s => s.preview === true) || running[0])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist viewport per project
  const handleLeftViewport = (v) => {
    setLeftViewport(v)
    if (leftService) saveViewportForProject(leftService.group || 'default', v)
  }

  // Quick-start a stopped service
  const handleStartService = async (serviceId) => {
    try { await apiFetch(`/api/services/${serviceId}/start`, { method: 'POST' }) } catch {}
  }

  // Split divider drag
  useEffect(() => {
    if (!draggingSplit) return
    const handleMove = (e) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = Math.max(20, Math.min(80, ((e.clientX - rect.left) / rect.width) * 100))
      setSplitRatio(pct)
    }
    const handleUp = () => setDraggingSplit(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [draggingSplit])

  const selectService = (service, pane) => {
    if (pane === 'right') { setRightService(service) }
    else {
      setLeftService(service)
      if (activeProject && activeProject !== 'All') saveLastServiceForProject(activeProject, service.id)
      setLeftViewport(getViewportForProject(service.group || 'default'))
    }
  }

  return (
    <ModalOverlay onClose={onClose}>
      <div
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-hidden animate-slide-in"
        style={{ width: '92vw', height: '88vh', maxWidth: '1600px', background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)' }}
      >
        {/* Header with project tabs */}
        <header className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: '0.5px solid var(--separator)' }}>
          <Monitor className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-app)' }} />
          <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-bold)', color: 'var(--text-app)' }}>Preview</span>

          {/* Project-grouped service tabs */}
          <div className="flex items-center gap-1 flex-1 overflow-x-auto">
            {Object.entries(servicesByGroup).map(([group, groupServices]) => (
              <div key={group} className="flex items-center gap-0.5">
                <span style={{ fontSize: '9px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginRight: '2px', marginLeft: '8px' }}>{group}</span>
                {groupServices.map(s => {
                  const isActive = s.id === leftService?.id || s.id === rightService?.id
                  const isRunning = s.status === 'running'
                  return (
                    <button
                      key={s.id}
                      onClick={() => isRunning ? selectService(s, splitMode && leftService ? 'right' : 'left') : handleStartService(s.id)}
                      className="apple-press flex items-center gap-1.5 px-2 py-1"
                      style={{
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '11px', fontWeight: 'var(--font-semibold)',
                        color: isActive ? 'var(--accent-app)' : isRunning ? 'var(--text-app)' : 'var(--text-tertiary)',
                        background: isActive ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent',
                      }}
                      title={isRunning ? `Switch to ${s.name} (:${s.port})` : `Start ${s.name}`}
                    >
                      {!isRunning ? <Play className="w-3 h-3" style={{ color: 'var(--apple-green)' }} /> : (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)', flexShrink: 0 }} />
                      )}
                      <span className="truncate max-w-[100px]">{s.name}</span>
                      <span style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>:{s.port}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {/* Split toggle */}
            <button
              onClick={() => {
                setSplitMode(prev => {
                  if (!prev && frontendServices.filter(s => s.status === 'running').length > 1 && !rightService) {
                    const other = frontendServices.find(s => s.status === 'running' && s.id !== leftService?.id)
                    if (other) setRightService(other)
                  }
                  if (prev) setRightService(null)
                  return !prev
                })
              }}
              className="apple-press p-1.5"
              style={{
                borderRadius: 'var(--radius-sm)',
                color: splitMode ? 'var(--accent-app)' : 'var(--text-muted)',
                background: splitMode ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent',
              }}
              title={splitMode ? 'Exit split view' : 'Split view'}
            >
              <Columns2 className="w-4 h-4" />
            </button>

            {/* Auto-refresh */}
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="apple-press p-1.5"
              style={{
                borderRadius: 'var(--radius-sm)',
                color: autoRefresh ? 'var(--apple-green)' : 'var(--text-muted)',
              }}
              title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            >
              <Zap className="w-4 h-4" />
            </button>

            <button onClick={onClose} className="apple-press p-1.5" style={{ borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content: single or split panes */}
        <div className="flex-1 flex overflow-hidden" style={{ userSelect: draggingSplit ? 'none' : undefined }}>
          <div style={{ width: splitMode ? `${splitRatio}%` : '100%', display: 'flex', flexDirection: 'column' }}>
            <IframePane service={leftService} socket={socket} autoRefresh={autoRefresh} viewport={leftViewport} onViewportChange={handleLeftViewport} />
          </div>

          {splitMode && (
            <>
              {/* Drag divider */}
              <div
                onMouseDown={() => setDraggingSplit(true)}
                className="flex items-center justify-center shrink-0 cursor-col-resize"
                style={{ width: '6px', background: 'var(--separator)' }}
              >
                <div style={{ width: '2px', height: '32px', borderRadius: '1px', background: 'var(--text-tertiary)' }} />
              </div>

              <div style={{ width: `${100 - splitRatio}%`, display: 'flex', flexDirection: 'column' }}>
                <IframePane service={rightService} socket={socket} autoRefresh={autoRefresh} viewport={rightViewport} onViewportChange={setRightViewport} />
              </div>
            </>
          )}
        </div>
      </div>
    </ModalOverlay>
  )
}
