import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  X, Send, Loader2, Palette, ImagePlus, Trash2, Monitor, Tablet, Smartphone, Laptop,
  Zap, Check, RotateCcw, ChevronDown, ChevronRight, Sparkles, Play, Save, FolderOpen, Undo2, Redo2, Download, Copy, ClipboardCheck, Crosshair, XCircle
} from 'lucide-react'
import { apiFetch, API_BASE } from '../config'
import ModalOverlay from './ModalOverlay'
import { Button, IconButton, Badge } from './ui'

const VIEWPORT_PRESETS = [
  { id: 'responsive', label: 'Responsive', icon: Monitor, width: null },
  { id: 'desktop', label: 'Desktop', icon: Monitor, width: 1440 },
  { id: 'laptop', label: 'Laptop', icon: Laptop, width: 1024 },
  { id: 'tablet', label: 'Tablet', icon: Tablet, width: 768 },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, width: 375 },
]

const MOOD_PRESETS = [
  { id: 'minimal', label: 'Minimal', desc: 'Clean lines, lots of whitespace, monochrome with one accent' },
  { id: 'bold', label: 'Bold', desc: 'High contrast, saturated colors, strong typography' },
  { id: 'warm', label: 'Warm & Inviting', desc: 'Soft tones, amber/orange accents, cozy and welcoming' },
  { id: 'dark-luxury', label: 'Dark Luxury', desc: 'Deep backgrounds, gold/silver accents, premium feel' },
  { id: 'playful', label: 'Playful', desc: 'Rounded corners, bright colors, friendly and fun' },
  { id: 'editorial', label: 'Editorial', desc: 'Strong typography hierarchy, reading-focused, magazine-like' },
  { id: 'glassmorphism', label: 'Glassmorphism', desc: 'Frosted glass, blur effects, translucent layers' },
  { id: 'neon-dark', label: 'Neon Dark', desc: 'Deep black, neon accent colors, cyberpunk energy' },
  { id: 'earth-tones', label: 'Earth Tones', desc: 'Greens, browns, warm grays, natural and grounded' },
  { id: 'pastel-soft', label: 'Pastel Soft', desc: 'Light pastels, gentle gradients, calm and soothing' },
  { id: 'corporate', label: 'Corporate Pro', desc: 'Blue/gray palette, trustworthy, data-dense layout' },
  { id: 'brutalist', label: 'Brutalist', desc: 'Raw, no-nonsense, high contrast, heavy borders' },
]

const ADJECTIVES = [
  'clean', 'modern', 'warm', 'cool', 'minimal', 'bold', 'soft', 'sharp',
  'airy', 'dense', 'vibrant', 'muted', 'premium', 'playful', 'professional',
  'dark', 'light', 'rounded', 'flat', 'spacious', 'elegant', 'futuristic',
  'cozy', 'industrial', 'organic', 'techy', 'retro', 'luxurious', 'brutalist',
  'whimsical', 'corporate', 'editorial', 'glassy', 'neon', 'pastel', 'monochrome'
]

const REF_APPS = [
  // Productivity & Dev Tools
  { id: 'linear', label: 'Linear', desc: 'Clean, minimal, monochrome with purple accents' },
  { id: 'notion', label: 'Notion', desc: 'Warm, readable, spacious with sepia tones' },
  { id: 'vercel', label: 'Vercel', desc: 'Dark, stark, geometric, developer-focused' },
  { id: 'github', label: 'GitHub', desc: 'Functional, clean, blue accents, code-centric' },
  { id: 'figma', label: 'Figma', desc: 'Bright, colorful toolbar, clean canvas' },
  { id: 'raycast', label: 'Raycast', desc: 'Dark, vibrant gradients, glassmorphism' },
  { id: 'arc', label: 'Arc Browser', desc: 'Colorful, rounded, sidebar-focused' },
  { id: 'obsidian', label: 'Obsidian', desc: 'Dark, purple accents, knowledge-graph feel' },
  { id: 'slack', label: 'Slack', desc: 'Friendly, sidebar-driven, customizable colors' },
  { id: 'todoist', label: 'Todoist', desc: 'Red accent, clean lists, productive feel' },
  // Design & Creative
  { id: 'apple', label: 'Apple', desc: 'Rounded, vibrant, layered depth, SF Pro typography' },
  { id: 'dribbble', label: 'Dribbble', desc: 'Pink accent, card-heavy, creative showcase' },
  { id: 'framer', label: 'Framer', desc: 'Dark, bold purple, motion-focused' },
  { id: 'canva', label: 'Canva', desc: 'Bright, approachable, colorful templates' },
  // Social & Media
  { id: 'spotify', label: 'Spotify', desc: 'Bold dark, high-contrast, green accents' },
  { id: 'discord', label: 'Discord', desc: 'Playful dark, blurple accents, gaming-friendly' },
  { id: 'twitter', label: 'X / Twitter', desc: 'Stark black/white, blue accent, feed-focused' },
  { id: 'instagram', label: 'Instagram', desc: 'Clean white, gradient accents, image-first' },
  { id: 'youtube', label: 'YouTube', desc: 'Red accent, dark mode, video-centric grid' },
  { id: 'reddit', label: 'Reddit', desc: 'Orange accent, dense, discussion-focused' },
  { id: 'pinterest', label: 'Pinterest', desc: 'Red accent, masonry grid, visual discovery' },
  // Finance & Business
  { id: 'stripe', label: 'Stripe', desc: 'Sharp gradients, professional, documentation-rich' },
  { id: 'mercury', label: 'Mercury', desc: 'Clean banking, purple tones, trustworthy' },
  { id: 'robinhood', label: 'Robinhood', desc: 'Green/black, bold numbers, financial data' },
  { id: 'wise', label: 'Wise', desc: 'Bright green, friendly, international feel' },
  // E-commerce & Consumer
  { id: 'shopify', label: 'Shopify', desc: 'Green accent, merchant-focused, polished admin' },
  { id: 'airbnb', label: 'Airbnb', desc: 'Coral/pink accent, warm photography, rounded cards' },
  { id: 'uber', label: 'Uber', desc: 'Black/white, bold typography, map-centric' },
  // News & Content
  { id: 'medium', label: 'Medium', desc: 'Serif typography, reading-focused, minimal UI' },
  { id: 'substack', label: 'Substack', desc: 'Orange accent, newsletter-style, editorial' },
  { id: 'nytimes', label: 'NY Times', desc: 'Classic editorial, serif headers, information-dense' },
]

function ProtoProgressBar({ progress, onCancel }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!progress?.startedAt) return
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - progress.startedAt) / 1000))
    }, 1000)
    return () => clearInterval(interval)
  }, [progress?.startedAt])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`
  const kb = progress?.chars ? (progress.chars / 1024).toFixed(1) : '0.0'

  let statusMsg = 'Starting AI...'
  let statusColor = 'var(--text-muted)'
  if (progress?.status === 'generating') {
    statusMsg = `Generating... ${kb}KB received`
  }
  if (elapsed >= 120) {
    statusMsg = `Taking longer than expected (${kb}KB so far). You can cancel and try a simpler description.`
    statusColor = 'var(--apple-orange, #ff9500)'
  } else if (elapsed >= 30 && progress?.status === 'generating') {
    statusMsg = `AI is building your design... ${kb}KB received`
  }

  return (
    <div className="flex items-center gap-2 mb-2" style={{ fontSize: '11px', color: statusColor }}>
      <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--apple-purple)' }} />
      <span className="flex-1">{statusMsg}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-tertiary)' }}>{timeStr}</span>
    </div>
  )
}

export default function DesignStudio({ onClose, services, activeProject, user, socket }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [images, setImages] = useState([]) // uploaded moodboard images
  const [pendingImages, setPendingImages] = useState([]) // images attached to current message
  const [selectedAdjectives, setSelectedAdjectives] = useState([])
  const [cssChanges, setCssChanges] = useState([]) // latest proposed (for display)
  const [fileChanges, setFileChanges] = useState([]) // latest proposed file edits
  const [projectColors, setProjectColors] = useState([]) // scanned color variables from project
  const [projectTypography, setProjectTypography] = useState([]) // scanned typography variables
  const [activeColorVar, setActiveColorVar] = useState(null) // variable being edited with picker
  const [sidebarTab, setSidebarTab] = useState('chat') // 'chat' | 'colors' | 'type'
  const [mode, setMode] = useState('refine') // 'refine' | 'prototype' | 'implement'
  const [prototypeId, setPrototypeId] = useState(null)
  const [protoLoading, setProtoLoading] = useState(false)
  const [protoInput, setProtoInput] = useState('')
  const [protoProgress, setProtoProgress] = useState(null) // { chars, startedAt, status }
  const protoAbortRef = useRef(null) // AbortController for cancelling
  const [implementPlan, setImplementPlan] = useState([]) // component change list
  const [implementIndex, setImplementIndex] = useState(0) // current component being reviewed
  // Design history stack: each entry = { cssChanges: [], styleInjection: '', label: '' }
  const [designHistory, setDesignHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1) // -1 = no changes applied
  const [disabledChanges, setDisabledChanges] = useState(new Set())

  // Computed active state from history (respects disabled toggles)
  const appliedChanges = useMemo(() => {
    const merged = []
    for (let i = 0; i <= historyIndex && i < designHistory.length; i++) {
      for (const c of (designHistory[i].cssChanges || [])) {
        const idx = merged.findIndex(m => m.variable === c.variable)
        if (idx >= 0) merged.splice(idx, 1)
        merged.push(c)
      }
    }
    return merged.filter(c => !disabledChanges.has(c.variable))
  }, [designHistory, historyIndex, disabledChanges])

  // All changes including disabled (for the changes panel)
  const allChanges = useMemo(() => {
    const merged = []
    for (let i = 0; i <= historyIndex && i < designHistory.length; i++) {
      for (const c of (designHistory[i].cssChanges || [])) {
        const idx = merged.findIndex(m => m.variable === c.variable)
        if (idx >= 0) merged.splice(idx, 1)
        merged.push(c)
      }
    }
    return merged
  }, [designHistory, historyIndex])

  const styleInjection = useMemo(() => {
    const rules = []
    for (let i = 0; i <= historyIndex && i < designHistory.length; i++) {
      if (designHistory[i].styleInjection) rules.push(designHistory[i].styleInjection)
    }
    return rules.join('\n')
  }, [designHistory, historyIndex])

  const canUndo = historyIndex >= 0
  const canRedo = historyIndex < designHistory.length - 1

  const pushDesignChange = useCallback((newCssChanges, newStyleInjection, label) => {
    setDesignHistory(prev => {
      const trimmed = prev.slice(0, historyIndex + 1)
      // Capture old values from previous history entries
      const enriched = (newCssChanges || []).map(c => {
        // Find the most recent previous value for this variable
        for (let i = trimmed.length - 1; i >= 0; i--) {
          const prevChange = trimmed[i].cssChanges?.find(p => p.variable === c.variable)
          if (prevChange) return { ...c, oldValue: prevChange.value }
        }
        return { ...c, oldValue: null } // first time this variable is set
      })
      return [...trimmed, { cssChanges: enriched, styleInjection: newStyleInjection || '', label: label || 'Design change' }]
    })
    setHistoryIndex(prev => prev + 1)
  }, [historyIndex])

  const handleUndo = useCallback(() => {
    if (historyIndex >= 0) setHistoryIndex(prev => prev - 1)
  }, [historyIndex])

  const handleRedo = useCallback(() => {
    if (historyIndex < designHistory.length - 1) setHistoryIndex(prev => prev + 1)
  }, [historyIndex, designHistory.length])

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); handleUndo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) { e.preventDefault(); handleRedo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleUndo, handleRedo])
  const [viewport, setViewport] = useState('responsive')
  const [customWidth, setCustomWidth] = useState('')
  const [draggingWidth, setDraggingWidth] = useState(false)
  const previewContainerRef = useRef(null)
  const [showMoodboard, setShowMoodboard] = useState(false)
  const [showBefore, setShowBefore] = useState(false)
  const [selectedService, setSelectedService] = useState(null)
  const [savedSessions, setSavedSessions] = useState([])
  const [showSessionMenu, setShowSessionMenu] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const chatEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const iframeRef = useRef(null)
  const dropZoneRef = useRef(null)

  // Frontend services
  const frontendServices = (services || []).filter(s => {
    if (s.preview === true) return true
    if (s.preview === false) return false
    const name = (s.name || '').toLowerCase()
    const cmd = (s.startCmd || '').toLowerCase()
    if (['frontend', 'client', 'ui', 'vite', 'next', 'react'].some(f => name.includes(f) || cmd.includes(f))) return true
    if (['backend', 'server', 'api', 'database'].some(b => name.includes(b))) return false
    return true
  })

  // Auto-select service
  useEffect(() => {
    if (selectedService) return
    const running = frontendServices.filter(s => s.status === 'running')
    if (activeProject && activeProject !== 'All') {
      const norm = (activeProject || '').toLowerCase().replace(/[\s_-]+/g, '')
      const match = running.find(s => (s.group || '').toLowerCase().replace(/[\s_-]+/g, '') === norm)
      if (match) { setSelectedService(match); return }
    }
    if (running.length > 0) setSelectedService(running[0])
  }, [frontendServices, activeProject]) // eslint-disable-line

  // --- Auto-save draft to localStorage ---
  useEffect(() => {
    if (messages.length === 0 && designHistory.length === 0) return
    try {
      localStorage.setItem('designStudio_draft', JSON.stringify({
        designHistory, historyIndex, fileChanges, messages, images,
        serviceId: selectedService?.id, timestamp: Date.now()
      }))
    } catch (e) { /* quota exceeded */ }
  }, [designHistory, historyIndex, fileChanges, messages, images, selectedService])

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('designStudio_draft')
      if (!raw) return
      const draft = JSON.parse(raw)
      if (Date.now() - draft.timestamp > 86400000) { localStorage.removeItem('designStudio_draft'); return }
      if (draft.messages?.length > 0 || draft.designHistory?.length > 0) {
        setMessages(draft.messages || [])
        setDesignHistory(draft.designHistory || [])
        setHistoryIndex(draft.historyIndex ?? -1)
        setFileChanges(draft.fileChanges || [])
        setImages(draft.images || [])
      }
    } catch (e) { /* ignore */ }
  }, [])

  // --- Session management ---
  const fetchSessions = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/design/sessions?username=${user?.username}`)
      if (res.ok) setSavedSessions(await res.json())
    } catch (e) { /* ignore */ }
  }, [user?.username])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  const handleSaveSession = async () => {
    if (!sessionName.trim()) return
    try {
      const res = await apiFetch('/api/design/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user?.username, name: sessionName.trim(),
          serviceId: selectedService?.id,
          designHistory, historyIndex, fileChanges, messages, images,
        })
      })
      if (res.ok) {
        setShowSaveDialog(false)
        setSessionName('')
        fetchSessions()
        setMessages(prev => [...prev, { role: 'system', content: `Design saved as "${sessionName.trim()}"` }])
      }
    } catch (e) { /* ignore */ }
  }

  const handleLoadSession = async (sessionId) => {
    try {
      const res = await apiFetch(`/api/design/sessions/${sessionId}`)
      if (res.ok) {
        const session = await res.json()
        setMessages(session.messages || [])
        setDesignHistory(session.designHistory || [])
        setHistoryIndex(session.historyIndex ?? -1)
        setFileChanges(session.fileChanges || [])
        setImages(session.images || [])
        setShowSessionMenu(false)
        // Find and select the service
        if (session.serviceId) {
          const svc = frontendServices.find(s => s.id === session.serviceId)
          if (svc) setSelectedService(svc)
        }
      }
    } catch (e) { /* ignore */ }
  }

  const handleDeleteSession = async (sessionId, e) => {
    e.stopPropagation()
    try {
      await apiFetch(`/api/design/sessions/${sessionId}`, { method: 'DELETE' })
      fetchSessions()
    } catch (e) { /* ignore */ }
  }

  // Scan project colors when service changes
  useEffect(() => {
    if (!selectedService) return
    apiFetch('/api/design/scan-css', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: selectedService.id })
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (!data) return
      const colors = data.variables
        .filter(v => v.category === 'colors' && v.theme === 'default' && /^#|^rgb|^hsl/.test(v.value))
        .map(v => ({ variable: v.name, value: v.value }))
      setProjectColors(colors)
      const typo = data.variables
        .filter(v => (v.category === 'typography' || /^--(font|text-(?!app|muted|tertiary)|leading|tracking)/.test(v.name)) && v.theme === 'default' && !/color|bg|fill/i.test(v.name))
        .map(v => ({ variable: v.name, value: v.value }))
      setProjectTypography(typo)
    }).catch(() => {})
  }, [selectedService])

  // Apply a color change from the picker
  const handleColorChange = useCallback((variable, newValue) => {
    pushDesignChange([{ variable, value: newValue }], '', `Color: ${variable}`)
  }, [pushDesignChange])

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // --- Image upload ---
  const uploadImage = async (file) => {
    const formData = new FormData()
    formData.append('image', file)
    try {
      const res = await apiFetch('/api/design/upload', { method: 'POST', body: formData })
      if (res.ok) {
        const data = await res.json()
        setImages(prev => [...prev, { ...data, annotation: '' }])
        setPendingImages(prev => [...prev, data])
        return data
      }
    } catch (e) { /* ignore */ }
    return null
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    dropZoneRef.current?.classList.remove('drag-over')
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    files.forEach(uploadImage)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    dropZoneRef.current?.classList.add('drag-over')
  }

  const handleDragLeave = () => {
    dropZoneRef.current?.classList.remove('drag-over')
  }

  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || [])
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (imageItem) {
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (file) uploadImage(file)
    }
  }

  const handleFileSelect = (e) => {
    Array.from(e.target.files || []).forEach(uploadImage)
    e.target.value = ''
  }

  const removeImage = async (filename) => {
    try { await apiFetch(`/api/design/upload/${filename}`, { method: 'DELETE' }) } catch {}
    setImages(prev => prev.filter(i => i.filename !== filename))
    setPendingImages(prev => prev.filter(i => i.filename !== filename))
  }

  // --- Inject CSS into preview iframe ---
  const injectCss = useCallback((changes, rawCss) => {
    const iframe = iframeRef.current
    if (!iframe) return

    const varBlock = changes.length > 0
      ? `:root {\n${changes.map(c => `  ${c.variable}: ${c.value} !important;`).join('\n')}\n}`
      : ''
    const fullCss = [varBlock, rawCss || ''].filter(Boolean).join('\n\n')

    // Method 1: Direct DOM access (works when same-origin via proxy)
    try {
      if (iframe.contentDocument && iframe.contentDocument.head) {
        const existing = iframe.contentDocument.getElementById('design-studio-overrides')
        if (existing) existing.remove()
        if (fullCss) {
          const style = iframe.contentDocument.createElement('style')
          style.id = 'design-studio-overrides'
          style.textContent = fullCss
          iframe.contentDocument.head.appendChild(style)
        }
        return
      }
    } catch (e) { /* cross-origin — fall through */ }

    // Method 2: postMessage (works if proxy script or injected listener is present)
    try {
      iframe.contentWindow.postMessage({ type: 'design-studio-css', css: fullCss }, '*')
    } catch (e) { /* iframe not ready */ }

    // Method 3: direct script injection fallback
    try {
      if (iframe.contentDocument && iframe.contentDocument.body) {
        let s = iframe.contentDocument.getElementById('ds-css-inject-script')
        if (s) s.remove()
        s = iframe.contentDocument.createElement('script')
        s.id = 'ds-css-inject-script'
        s.textContent = `(function(){var o=document.getElementById('design-studio-overrides');if(o)o.remove();${fullCss ? `var s=document.createElement('style');s.id='design-studio-overrides';s.textContent=${JSON.stringify(fullCss)};document.head.appendChild(s);` : ''}})();`
        iframe.contentDocument.body.appendChild(s)
      }
    } catch (e) { /* cross-origin */ }
  }, [])

  useEffect(() => {
    if (showBefore) {
      injectCss([], '')
    } else {
      injectCss(appliedChanges, styleInjection)
    }
    // Keep re-injecting on an interval in case SPA navigation removes the style tag
    if (!showBefore && (appliedChanges.length > 0 || styleInjection)) {
      const interval = setInterval(() => {
        try {
          const iframe = iframeRef.current
          if (iframe?.contentDocument && !iframe.contentDocument.getElementById('design-studio-overrides')) {
            injectCss(appliedChanges, styleInjection)
          }
        } catch (e) {
          // Cross-origin — use postMessage to check/re-inject
          try { iframeRef.current?.contentWindow?.postMessage({ type: 'design-studio-css-check' }, '*') } catch (e2) {}
        }
      }, 2000)
      return () => clearInterval(interval)
    }
  }, [appliedChanges, styleInjection, showBefore, injectCss])

  // Re-inject after iframe loads (with retries for proxy-loaded content)
  const handleIframeLoad = () => {
    // Inject design studio listeners into the iframe (for direct localhost URLs)
    setTimeout(injectDesignListeners, 200)
    setTimeout(injectDesignListeners, 1000)
    // Re-inject CSS if we have active changes
    if (!showBefore && (appliedChanges.length > 0 || styleInjection)) {
      const inject = () => injectCss(appliedChanges, styleInjection)
      setTimeout(inject, 300)
      setTimeout(inject, 800)
      setTimeout(inject, 1500)
    }
  }

  // --- Send message ---
  const handleSend = async () => {
    const text = input.trim()
    if (!text && pendingImages.length === 0) return
    if (loading) return

    // Build message with adjectives and references
    let fullMessage = text
    if (selectedAdjectives.length > 0 && !messages.length) {
      fullMessage = `Design direction: ${selectedAdjectives.join(', ')}. ${fullMessage}`
    }
    // Include selected element context for scoped changes
    if (selectedElement) {
      fullMessage += `\n\n[TARGETING ELEMENT: selector="${selectedElement.selector}", tag=${selectedElement.tag}, dimensions=${selectedElement.dimensions?.width}x${selectedElement.dimensions?.height}. Scope your style-injection CSS rules to this selector specifically. Do NOT apply global styles — target only "${selectedElement.selector}" and its children.]`
    }

    const userMsg = { role: 'user', content: fullMessage, images: pendingImages.map(i => ({ ...i })) }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingImages([])
    setLoading(true)

    try {
      const res = await apiFetch('/api/design/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: fullMessage,
          username: user?.username,
          serviceId: selectedService?.id,
          images: images.map(i => ({ filename: i.filename, originalName: i.originalName, annotation: i.annotation })),
        })
      })

      if (res.ok) {
        const data = await res.json()
        // Strip all change blocks from display text
        const displayText = data.response
          .replace(/```css-changes[\s\S]*?```/g, '')
          .replace(/```style-injection[\s\S]*?```/g, '')
          .replace(/```file-changes[\s\S]*?```/g, '')
          .trim()
        setMessages(prev => [...prev, {
          role: 'assistant', content: displayText,
          cssChanges: data.cssChanges,
          styleInjection: data.styleInjection,
          fileChanges: data.fileChanges,
        }])

        if ((data.cssChanges && data.cssChanges.length > 0) || data.styleInjection) {
          setCssChanges(data.cssChanges || [])
          const label = data.cssChanges?.length ? `${data.cssChanges.length} theme changes` : 'Style rules'
          pushDesignChange(data.cssChanges, data.styleInjection, data.styleInjection ? label + ' + style rules' : label)
        }
        if (data.fileChanges && data.fileChanges.length > 0) {
          setFileChanges(data.fileChanges)
        }
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Connection failed. Is the backend running?' }])
    } finally {
      setLoading(false)
    }
  }

  // --- Apply to files ---
  const handleApply = async () => {
    if (!selectedService || appliedChanges.length === 0) return
    try {
      const res = await apiFetch('/api/design/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: selectedService.id, changes: appliedChanges })
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Applied ${data.applied.length} changes to project files.${data.failed.length > 0 ? ` ${data.failed.length} failed.` : ''} Vite should hot-reload automatically.`
        }])
        setCssChanges([])
        setAppliedChanges([])
      }
    } catch (e) { /* ignore */ }
  }

  const handleApplyFiles = async () => {
    if (!selectedService || fileChanges.length === 0) return
    try {
      const res = await apiFetch('/api/design/apply-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: selectedService.id, changes: fileChanges })
      })
      if (res.ok) {
        const data = await res.json()
        setMessages(prev => [...prev, {
          role: 'system',
          content: `Layout changes: ${data.applied.length} applied${data.failed.length > 0 ? `, ${data.failed.length} failed` : ''}. Vite should hot-reload.`
        }])
        setFileChanges([])
      }
    } catch (e) { /* ignore */ }
  }

  const handleReset = () => {
    setCssChanges([])
    setFileChanges([])
    setDesignHistory([])
    setHistoryIndex(-1)
    injectCss([], '')
  }

  const handleClearChat = async () => {
    setMessages([])
    setCssChanges([])
    setFileChanges([])
    setDesignHistory([])
    setHistoryIndex(-1)
    setDisabledChanges(new Set())
    setPrototypeId(null)
    setProtoProgress(null)
    setProtoLoading(false)
    if (protoAbortRef.current) { protoAbortRef.current.abort(); protoAbortRef.current = null }
    setImplementPlan([])
    setImplementIndex(0)
    setMode('refine')
    injectCss([], '')
    localStorage.removeItem('designStudio_draft')
    try { await apiFetch(`/api/design/history?username=${user?.username}`, { method: 'DELETE' }) } catch (e) {}
  }

  // --- Prototype mode ---
  const handleCancelPrototype = async () => {
    if (protoAbortRef.current) {
      protoAbortRef.current.abort()
      protoAbortRef.current = null
    }
    try {
      await apiFetch('/api/design/prototype/session', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user?.username })
      })
    } catch (e) { /* best effort */ }
    setProtoLoading(false)
    setProtoProgress(null)
    setMessages(prev => [...prev, { role: 'system', content: 'Generation cancelled.' }])
  }

  const handleGeneratePrototype = async () => {
    const text = protoInput.trim()
    if (!text || protoLoading) return
    setProtoLoading(true)
    setProtoProgress({ chars: 0, startedAt: Date.now(), status: 'starting' })
    setMessages(prev => [...prev, { role: 'user', content: `[Prototype] ${text}` }])
    setProtoInput('')

    const abortController = new AbortController()
    protoAbortRef.current = abortController

    try {
      let token = null
      try { const saved = localStorage.getItem('taskBoardUser'); if (saved) token = JSON.parse(saved)?.token } catch (e) { /* ignore */ }
      const res = await fetch(`${API_BASE}/api/design/prototype/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          message: text, username: user?.username, serviceId: selectedService?.id,
          images: images.map(i => ({ filename: i.filename, originalName: i.originalName, annotation: i.annotation })),
          prototypeId: prototypeId,
        }),
        signal: abortController.signal,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setMessages(prev => [...prev, { role: 'assistant', content: err.error || 'Prototype generation failed.' }])
        setProtoLoading(false)
        setProtoProgress(null)
        return
      }

      // Parse SSE stream
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = null
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'progress') {
                setProtoProgress(prev => ({ ...prev, chars: data.chars, status: data.type }))
              } else if (eventType === 'complete') {
                setPrototypeId(data.id)
                setMessages(prev => [...prev, { role: 'system', content: `Prototype generated! (${Math.round(data.size / 1024)}KB)` }])
              } else if (eventType === 'error') {
                const detail = data.raw ? `\n\nAI output preview: ${data.raw.slice(0, 200)}...` : ''
                setMessages(prev => [...prev, { role: 'assistant', content: (data.error || 'Prototype generation failed.') + detail }])
              }
            } catch (e) { /* ignore parse errors */ }
            eventType = null
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMessages(prev => [...prev, { role: 'assistant', content: 'Connection failed.' }])
      }
    } finally {
      protoAbortRef.current = null
      setProtoLoading(false)
      setProtoProgress(null)
    }
  }

  const handleStartImplementation = async () => {
    if (!prototypeId || !selectedService) return
    setProtoLoading(true)
    setMessages(prev => [...prev, { role: 'system', content: 'Analyzing prototype for component-by-component implementation...' }])
    try {
      const res = await apiFetch('/api/design/prototype/implement', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prototypeId, serviceId: selectedService.id, username: user?.username })
      })
      if (res.ok) {
        const data = await res.json()
        if (data.plan && data.plan.length > 0) {
          setImplementPlan(data.plan)
          setImplementIndex(0)
          setMode('implement')
          setMessages(prev => [...prev, { role: 'system', content: `Found ${data.plan.length} components to update.` }])
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: 'Could not break down the prototype into component changes. Try refining the prototype first.' }])
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Implementation analysis failed.' }])
    } finally {
      setProtoLoading(false)
    }
  }

  const handleApproveComponent = async (comp) => {
    // Apply CSS changes
    if (comp.cssChanges?.length > 0) {
      pushDesignChange(comp.cssChanges, comp.styleInjection || '', `Implement: ${comp.component}`)
    } else if (comp.styleInjection) {
      pushDesignChange([], comp.styleInjection, `Implement: ${comp.component}`)
    }
    // Apply file changes
    if (comp.fileChanges?.length > 0) {
      try {
        await apiFetch('/api/design/apply-files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serviceId: selectedService.id, changes: comp.fileChanges })
        })
      } catch (e) { /* ignore */ }
    }
    setMessages(prev => [...prev, { role: 'system', content: `Applied: ${comp.component}` }])
    setImplementIndex(prev => prev + 1)
  }

  const handleSkipComponent = (comp) => {
    setMessages(prev => [...prev, { role: 'system', content: `Skipped: ${comp.component}` }])
    setImplementIndex(prev => prev + 1)
  }

  // Prototype iframe src
  const prototypeUrl = prototypeId ? `/api/design/prototypes/${prototypeId}.html` : null

  // --- Export ---
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inspectMode, setInspectMode] = useState(false)
  const [selectedElement, setSelectedElement] = useState(null)
  const [showChangesPanel, setShowChangesPanel] = useState(false)

  const toggleChange = useCallback((variable) => {
    setDisabledChanges(prev => {
      const next = new Set(prev)
      if (next.has(variable)) next.delete(variable); else next.add(variable)
      return next
    })
  }, [])

  // Toggle inspect mode in iframe
  const sendInspectMessage = useCallback((enabled) => {
    const iframe = iframeRef.current
    if (!iframe) return
    const msg = { type: 'design-studio-inspect', enabled }
    try { iframe.contentWindow.postMessage(msg, '*') } catch (e) {}
    // Also try direct injection as fallback for same-origin
    try {
      const doc = iframe.contentDocument
      if (doc) {
        // Inject inspector directly if postMessage doesn't work
        let script = doc.getElementById('ds-inspector-toggle')
        if (script) script.remove()
        script = doc.createElement('script')
        script.id = 'ds-inspector-toggle'
        script.textContent = `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(msg)}}));`
        doc.body.appendChild(script)
      }
    } catch (e) {}
  }, [])

  const toggleInspect = useCallback(() => {
    const next = !inspectMode
    setInspectMode(next)
    if (!next) setSelectedElement(null)
    sendInspectMessage(next)
    // Retry in case iframe wasn't ready
    setTimeout(() => sendInspectMessage(next), 200)
  }, [inspectMode, sendInspectMessage])

  // Listen for element selection from iframe
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === 'design-studio-element-selected') {
        setSelectedElement(e.data)
        setInspectMode(false)
        try {
          iframeRef.current?.contentWindow?.postMessage({ type: 'design-studio-inspect', enabled: false }, '*')
        } catch (err) { /* ignore */ }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const buildExportCss = () => {
    const lines = []
    if (appliedChanges.length > 0) {
      lines.push(':root {')
      appliedChanges.forEach(c => lines.push(`  ${c.variable}: ${c.value};`))
      lines.push('}')
      lines.push('')
    }
    if (styleInjection) { lines.push(styleInjection); lines.push('') }
    return lines.join('\n')
  }

  const handleCopyCss = () => {
    navigator.clipboard.writeText(buildExportCss())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    setShowExportMenu(false)
  }

  const handleExportCss = async () => {
    try {
      const res = await apiFetch('/api/design/export/css', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedChanges, styleInjection, projectName: selectedService?.name || activeProject })
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'design.css'
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) { /* ignore */ }
    setShowExportMenu(false)
  }

  const handleExportJson = async () => {
    try {
      const res = await apiFetch('/api/design/export/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appliedChanges, styleInjection, projectName: selectedService?.name || activeProject })
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('content-disposition')?.match(/filename="(.+)"/)?.[1] || 'design.json'
        a.click()
        URL.revokeObjectURL(url)
      }
    } catch (e) { /* ignore */ }
    setShowExportMenu(false)
  }

  // Iframe src — proxy for everything (has CSS/inspect listeners + namespaced localStorage)
  const iframeSrc = (mode === 'prototype' || mode === 'implement') && prototypeUrl
    ? prototypeUrl
    : selectedService?.status === 'running'
      ? `/api/preview/${selectedService.port}`
      : null

  // Inject design studio listeners into the iframe after it loads (for direct localhost)
  const injectDesignListeners = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      // Try postMessage approach first — always works
      iframe.contentWindow.postMessage({ type: 'design-studio-init' }, '*')
    } catch (e) {}
    // For same-origin or direct localhost, inject the listener script
    try {
      const doc = iframe.contentDocument
      if (doc && !doc.getElementById('ds-listener')) {
        const script = doc.createElement('script')
        script.id = 'ds-listener'
        script.textContent = `
          window.addEventListener('message', function(e) {
            if (!e.data || !e.data.type) return;
            if (e.data.type === 'design-studio-css') {
              var old = document.getElementById('design-studio-overrides');
              if (old) old.remove();
              if (e.data.css) {
                var s = document.createElement('style');
                s.id = 'design-studio-overrides';
                s.textContent = e.data.css;
                document.head.appendChild(s);
              }
            }
            if (e.data.type === 'design-studio-inspect') {
              var enabled = e.data.enabled;
              var overlay = document.getElementById('ds-inspect-overlay');
              var label = document.getElementById('ds-inspect-label');
              if (enabled) {
                if (!overlay) {
                  overlay = document.createElement('div');
                  overlay.id = 'ds-inspect-overlay';
                  overlay.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #007AFF;background:rgba(0,122,255,0.08);z-index:99999;transition:all 80ms ease;display:none;border-radius:4px;';
                  document.body.appendChild(overlay);
                  label = document.createElement('div');
                  label.id = 'ds-inspect-label';
                  label.style.cssText = 'position:fixed;z-index:100000;pointer-events:none;background:#007AFF;color:#fff;font:bold 10px/1.3 -apple-system,sans-serif;padding:2px 6px;border-radius:3px;display:none;white-space:nowrap;';
                  document.body.appendChild(label);
                }
                var hovered = null;
                window._dsMove = function(ev) {
                  var el = document.elementFromPoint(ev.clientX, ev.clientY);
                  if (!el || el === overlay || el === label) return;
                  hovered = el;
                  var r = el.getBoundingClientRect();
                  overlay.style.left = r.left+'px'; overlay.style.top = r.top+'px';
                  overlay.style.width = r.width+'px'; overlay.style.height = r.height+'px';
                  overlay.style.display = 'block';
                  var cls = el.className && typeof el.className === 'string' ? '.'+el.className.trim().split(/\\s+/).join('.') : '';
                  label.textContent = el.tagName.toLowerCase() + (el.id ? '#'+el.id : '') + (cls.length > 1 ? cls : '');
                  label.style.left = Math.min(r.left, window.innerWidth-150)+'px';
                  label.style.top = Math.max(0, r.top-20)+'px';
                  label.style.display = 'block';
                };
                window._dsClick = function(ev) {
                  ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation();
                  if (!hovered) return;
                  var el = hovered;
                  var cs = window.getComputedStyle(el);
                  var styles = {};
                  ['color','background-color','font-size','font-weight','padding','margin','border-radius','display','gap','width','height'].forEach(function(p) { styles[p] = cs.getPropertyValue(p); });
                  var cls = el.className && typeof el.className === 'string' ? el.className.trim() : '';
                  window.parent.postMessage({ type:'design-studio-element-selected', tag:el.tagName.toLowerCase(), id:el.id||null, className:cls, selector:(el.id?'#'+el.id:el.tagName.toLowerCase()+(cls?'.'+cls.split(/\\s+/).join('.'):'').slice(0,120)), computedStyles:styles, dimensions:{width:Math.round(el.getBoundingClientRect().width),height:Math.round(el.getBoundingClientRect().height)} }, '*');
                };
                document.addEventListener('mousemove', window._dsMove, true);
                document.addEventListener('click', window._dsClick, true);
              } else {
                if (overlay) overlay.style.display = 'none';
                if (label) label.style.display = 'none';
                if (window._dsMove) document.removeEventListener('mousemove', window._dsMove, true);
                if (window._dsClick) document.removeEventListener('click', window._dsClick, true);
              }
            }
          });
        `
        doc.head.appendChild(script)
      }
    } catch (e) { /* cross-origin — postMessage only */ }
  }, [])

  const activePreset = VIEWPORT_PRESETS.find(v => v.id === viewport)
  const iframeWidth = viewport === 'custom' ? (parseInt(customWidth) || null) : activePreset?.width

  // Drag to resize iframe width
  useEffect(() => {
    if (!draggingWidth) return
    const handleMove = (e) => {
      if (!previewContainerRef.current) return
      const rect = previewContainerRef.current.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const width = Math.max(280, Math.min(rect.width, Math.round((e.clientX - centerX) * 2 + rect.width)))
      setCustomWidth(String(width))
      setViewport('custom')
    }
    const handleUp = () => setDraggingWidth(false)
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
  }, [draggingWidth])

  return (
    <ModalOverlay onClose={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex overflow-hidden animate-slide-in"
        style={{ width: '95vw', height: '90vh', maxWidth: '1800px', background: 'var(--bg-app)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-popover)' }}
      >
        {/* Left: Design Chat */}
        <div className="flex flex-col" style={{ width: '420px', minWidth: '360px', borderRight: '0.5px solid var(--separator)' }}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '0.5px solid var(--separator)' }}>
            <Palette className="w-5 h-5" style={{ color: 'var(--accent-app)' }} />
            <span style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-bold)', color: 'var(--text-app)' }}>Design Studio</span>

            {/* Mode toggle */}
            <div className="flex items-center gap-0.5 ml-2" style={{ background: 'var(--fill-secondary)', borderRadius: 'var(--radius-sm)', padding: '2px' }}>
              <button onClick={() => setMode('refine')} className="apple-press" style={{ padding: '3px 8px', borderRadius: 'var(--radius-xs)', fontSize: '10px', fontWeight: 'var(--font-semibold)', color: mode === 'refine' ? 'var(--accent-app)' : 'var(--text-muted)', background: mode === 'refine' ? 'var(--bg-card)' : 'transparent' }}>Refine</button>
              <button onClick={() => setMode('prototype')} className="apple-press" style={{ padding: '3px 8px', borderRadius: 'var(--radius-xs)', fontSize: '10px', fontWeight: 'var(--font-semibold)', color: mode === 'prototype' ? 'var(--apple-purple)' : 'var(--text-muted)', background: mode === 'prototype' || mode === 'implement' ? 'var(--bg-card)' : 'transparent' }}>Prototype</button>
            </div>

            <div className="flex-1" />

            {/* Save */}
            <div className="relative">
              {showSaveDialog ? (
                <div className="flex items-center gap-1">
                  <input
                    type="text" value={sessionName} onChange={(e) => setSessionName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveSession() }}
                    placeholder="Design name..."
                    autoFocus
                    className="focus:outline-none"
                    style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '4px 8px', fontSize: '11px', color: 'var(--text-app)', width: '120px' }}
                  />
                  <IconButton size="sm" onClick={handleSaveSession} aria-label="Save"><Check className="w-3.5 h-3.5" /></IconButton>
                  <IconButton size="sm" onClick={() => setShowSaveDialog(false)} aria-label="Cancel"><X className="w-3.5 h-3.5" /></IconButton>
                </div>
              ) : (
                <IconButton onClick={() => setShowSaveDialog(true)} aria-label="Save design" title="Save design">
                  <Save className="w-4 h-4" />
                </IconButton>
              )}
            </div>

            {/* Load */}
            <div className="relative">
              <IconButton onClick={() => { setShowSessionMenu(!showSessionMenu); if (!showSessionMenu) fetchSessions() }} aria-label="Load design" title="Load saved design">
                <FolderOpen className="w-4 h-4" />
              </IconButton>
              {showSessionMenu && (
                <div className="absolute right-0 top-full mt-1 z-30" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)', minWidth: '200px', maxHeight: '250px', overflow: 'auto' }}>
                  {savedSessions.length === 0 ? (
                    <div style={{ padding: '12px 16px', fontSize: '11px', color: 'var(--text-tertiary)' }}>No saved designs</div>
                  ) : savedSessions.map(s => (
                    <div
                      key={s.id}
                      onClick={() => handleLoadSession(s.id)}
                      className="apple-press flex items-center justify-between cursor-pointer"
                      style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--separator)' }}
                    >
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{s.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                          {new Date(s.createdAt).toLocaleDateString()} · {s.changeCount} changes
                        </div>
                      </div>
                      <button onClick={(e) => handleDeleteSession(s.id, e)} className="p-1 apple-press" style={{ color: 'var(--text-tertiary)' }} title="Delete">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <IconButton onClick={handleClearChat} aria-label="New session" title="Clear chat & start fresh" color="var(--apple-orange)">
              <Trash2 className="w-4 h-4" />
            </IconButton>
            <IconButton onClick={onClose} aria-label="Close"><X className="w-4 h-4" /></IconButton>
          </div>

          {/* Service selector */}
          <div className="px-4 py-2" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
            <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '4px' }}>Target Project</div>
            <div className="flex gap-1 flex-wrap">
              {frontendServices.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSelectedService(s)}
                  className="apple-press flex items-center gap-1 px-2 py-1"
                  style={{
                    borderRadius: 'var(--radius-sm)', fontSize: '11px', fontWeight: 'var(--font-semibold)',
                    color: selectedService?.id === s.id ? 'var(--accent-app)' : s.status === 'running' ? 'var(--text-app)' : 'var(--text-tertiary)',
                    background: selectedService?.id === s.id ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent',
                  }}
                >
                  {s.status === 'running'
                    ? <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-green)' }} />
                    : <Play className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                  }
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* Sidebar tabs */}
          <div className="flex" style={{ borderBottom: '0.5px solid var(--separator)' }}>
            {[
              { id: 'chat', label: 'Chat' },
              { id: 'colors', label: 'Colors', count: projectColors.length },
              { id: 'type', label: 'Type', count: projectTypography.length },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setSidebarTab(tab.id)}
                className="flex-1 apple-press py-2 text-center"
                style={{
                  fontSize: '11px', fontWeight: 'var(--font-semibold)',
                  color: sidebarTab === tab.id ? 'var(--accent-app)' : 'var(--text-muted)',
                  borderBottom: sidebarTab === tab.id ? '2px solid var(--accent-app)' : '2px solid transparent',
                }}
              >
                {tab.label}{tab.count ? ` (${tab.count})` : ''}
              </button>
            ))}
          </div>

          {/* Colors tab */}
          {sidebarTab === 'colors' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3" style={{ background: 'var(--bg-app)' }}>
              {projectColors.length === 0 ? (
                <div className="text-center py-8">
                  <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>
                    {selectedService ? 'No color variables found' : 'Select a service first'}
                  </p>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '8px' }}>Project Color Tokens</div>
                  <div className="flex flex-col gap-1">
                    {projectColors.map(c => {
                      // Check if this color has been modified
                      const override = appliedChanges.find(a => a.variable === c.variable)
                      const currentValue = override ? override.value : c.value
                      const isModified = !!override
                      return (
                        <div key={c.variable} className="flex items-center gap-2 apple-press" style={{ padding: '4px 6px', borderRadius: 'var(--radius-sm)', background: isModified ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent' }}>
                          <div className="relative shrink-0">
                            <input
                              type="color"
                              value={currentValue.startsWith('#') ? currentValue : '#000000'}
                              onChange={(e) => handleColorChange(c.variable, e.target.value)}
                              className="absolute inset-0 opacity-0 cursor-pointer"
                              style={{ width: '24px', height: '24px' }}
                            />
                            <div style={{ width: '24px', height: '24px', borderRadius: '4px', background: currentValue, border: '2px solid var(--separator)', cursor: 'pointer' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-medium)', color: 'var(--text-app)' }}>{c.variable}</div>
                            <div className="flex items-center gap-1">
                              {isModified && <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>{c.value}</span>}
                              <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: isModified ? 'var(--accent-app)' : 'var(--text-muted)' }}>{currentValue}</span>
                            </div>
                          </div>
                          {isModified && (
                            <button onClick={() => toggleChange(c.variable)} className="apple-press shrink-0 p-0.5" title="Revert" style={{ color: 'var(--text-tertiary)' }}>
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Typography tab */}
          {sidebarTab === 'type' && (
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3" style={{ background: 'var(--bg-app)' }}>
              {projectTypography.length === 0 ? (
                <div className="text-center py-8">
                  <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>
                    {selectedService ? 'No typography variables found' : 'Select a service first'}
                  </p>
                </div>
              ) : (
                <>
                  {/* Font family quick-switch */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '6px' }}>Font Family</div>
                    <div className="flex flex-wrap gap-1">
                      {['Inter', 'Poppins', 'DM Sans', 'Plus Jakarta Sans', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Raleway', 'Nunito', 'Source Sans 3', 'IBM Plex Sans', 'Noto Sans', 'Work Sans', 'Outfit'].map(font => (
                        <button
                          key={font}
                          onClick={() => {
                            // Inject the font via style rule + update variable
                            const importRule = `@import url('https://fonts.googleapis.com/css2?family=${font.replace(/\s+/g, '+')}:wght@300;400;500;600;700&display=swap');`
                            const fontStack = `'${font}', -apple-system, system-ui, sans-serif`
                            const fontVar = projectTypography.find(v => /--font-sans|--font-family|--font-primary/i.test(v.variable))
                            if (fontVar) {
                              pushDesignChange([{ variable: fontVar.variable, value: fontStack }], importRule, `Font: ${font}`)
                            } else {
                              pushDesignChange([], `${importRule}\n* { font-family: '${font}', sans-serif !important; }`, `Font: ${font}`)
                            }
                          }}
                          className="apple-press"
                          style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', fontWeight: 'var(--font-medium)', fontFamily: `'${font}', sans-serif`, color: 'var(--text-app)', background: 'var(--fill-secondary)' }}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Serif fonts */}
                  <div style={{ marginBottom: '12px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '6px' }}>Serif Fonts</div>
                    <div className="flex flex-wrap gap-1">
                      {['Playfair Display', 'Lora', 'Merriweather', 'Source Serif 4', 'Libre Baskerville', 'EB Garamond'].map(font => (
                        <button
                          key={font}
                          onClick={() => {
                            const importRule = `@import url('https://fonts.googleapis.com/css2?family=${font.replace(/\s+/g, '+')}:wght@400;500;600;700&display=swap');`
                            pushDesignChange([], `${importRule}\n* { font-family: '${font}', serif !important; }`, `Font: ${font}`)
                          }}
                          className="apple-press"
                          style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '11px', fontFamily: `'${font}', serif`, color: 'var(--text-app)', background: 'var(--fill-secondary)' }}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Mono fonts */}
                  <div style={{ marginBottom: '16px' }}>
                    <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '6px' }}>Monospace</div>
                    <div className="flex flex-wrap gap-1">
                      {['JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono'].map(font => (
                        <button
                          key={font}
                          onClick={() => {
                            const importRule = `@import url('https://fonts.googleapis.com/css2?family=${font.replace(/\s+/g, '+')}:wght@400;500;600;700&display=swap');`
                            const monoVar = projectTypography.find(v => /--font-mono/i.test(v.variable))
                            if (monoVar) {
                              pushDesignChange([{ variable: monoVar.variable, value: `'${font}', monospace` }], importRule, `Mono font: ${font}`)
                            }
                          }}
                          className="apple-press"
                          style={{ padding: '4px 8px', borderRadius: 'var(--radius-sm)', fontSize: '10px', fontFamily: `'${font}', monospace`, color: 'var(--text-app)', background: 'var(--fill-secondary)' }}
                        >
                          {font}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Typography token sliders */}
                  <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '8px' }}>Typography Tokens</div>
                  <div className="flex flex-col gap-2">
                    {projectTypography.map(v => {
                      const override = appliedChanges.find(a => a.variable === v.variable)
                      const currentValue = override ? override.value : v.value
                      const isNumeric = /^\d/.test(v.value) || /^-?\d/.test(v.value)
                      const isModified = !!override

                      // Parse numeric value for slider
                      const numMatch = currentValue.match(/^(-?[\d.]+)(.*)$/)
                      const numVal = numMatch ? parseFloat(numMatch[1]) : null
                      const unit = numMatch ? numMatch[2] : ''

                      // Determine slider range based on variable name and unit
                      let min = 0, max = 100, step = 1
                      if (/leading|line-height/i.test(v.variable)) { min = 0.8; max = 2.5; step = 0.05 }
                      else if (/tracking|letter-spacing/i.test(v.variable)) { min = -0.1; max = 0.2; step = 0.005 }
                      else if (/font-(regular|medium|semibold|bold|weight)/i.test(v.variable)) { min = 100; max = 900; step = 100 }
                      else if (unit === 'px') { min = 8; max = 72; step = 1 }
                      else if (unit === 'em' || unit === 'rem') { min = 0.5; max = 4; step = 0.1 }

                      return (
                        <div key={v.variable} style={{ padding: '4px 6px', borderRadius: 'var(--radius-sm)', background: isModified ? 'color-mix(in srgb, var(--accent-app) 6%, transparent)' : 'transparent' }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="truncate" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flex: 1 }}>{v.variable}</span>
                            <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-semibold)', color: isModified ? 'var(--accent-app)' : 'var(--text-app)', marginLeft: '8px' }}>{currentValue}</span>
                          </div>
                          {isNumeric && numVal !== null && (
                            <input
                              type="range"
                              min={min} max={max} step={step}
                              value={numVal}
                              onChange={(e) => handleColorChange(v.variable, `${e.target.value}${unit}`)}
                              className="w-full"
                              style={{ height: '4px', accentColor: 'var(--accent-app)' }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Chat tab content */}
          {sidebarTab === 'chat' && <>

          {/* Quick-start: mood/adjectives (only before first message) */}
          {(messages.length === 0 || (mode === 'prototype' && !prototypeId)) && (
            <div className="px-4 py-3 overflow-y-auto" style={{ borderBottom: '0.5px solid var(--separator)', maxHeight: '280px' }}>
              <div style={{ fontSize: '11px', fontWeight: 'var(--font-bold)', color: 'var(--text-muted)', marginBottom: '8px' }}>How should it feel?</div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {ADJECTIVES.map(adj => (
                  <button
                    key={adj}
                    onClick={() => setSelectedAdjectives(prev => prev.includes(adj) ? prev.filter(a => a !== adj) : [...prev, adj])}
                    className="apple-press"
                    style={{
                      padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: '11px', fontWeight: 'var(--font-medium)',
                      color: selectedAdjectives.includes(adj) ? 'var(--accent-app)' : 'var(--text-muted)',
                      background: selectedAdjectives.includes(adj) ? 'color-mix(in srgb, var(--accent-app) 12%, transparent)' : 'var(--fill-secondary)',
                    }}
                  >
                    {adj}
                  </button>
                ))}
              </div>

              <div style={{ fontSize: '11px', fontWeight: 'var(--font-bold)', color: 'var(--text-muted)', marginBottom: '6px' }}>Or make it feel like...</div>
              {[
                { group: 'Productivity & Dev', ids: ['linear','notion','vercel','github','figma','raycast','arc','obsidian','slack','todoist'] },
                { group: 'Design & Creative', ids: ['apple','dribbble','framer','canva'] },
                { group: 'Social & Media', ids: ['spotify','discord','twitter','instagram','youtube','reddit','pinterest'] },
                { group: 'Finance & Business', ids: ['stripe','mercury','robinhood','wise'] },
                { group: 'E-commerce', ids: ['shopify','airbnb','uber'] },
                { group: 'Content & News', ids: ['medium','substack','nytimes'] },
              ].map(section => (
                <div key={section.group} className="mb-2">
                  <div style={{ fontSize: '9px', fontWeight: 'var(--font-bold)', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '3px' }}>{section.group}</div>
                  <div className="flex flex-wrap gap-1">
                    {section.ids.map(id => {
                      const app = REF_APPS.find(a => a.id === id)
                      if (!app) return null
                      return (
                        <button
                          key={app.id}
                          onClick={() => { const text = `Make it feel like ${app.label}. `; if (mode === 'prototype') setProtoInput(prev => `${prev}${text}`.trim()); else setInput(prev => `${prev}${text}`.trim()) }}
                          className="apple-press flex items-center gap-1"
                          style={{ padding: '3px 8px', borderRadius: 'var(--radius-full)', fontSize: '10px', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', background: 'var(--fill-secondary)' }}
                          title={app.desc}
                        >
                          <Sparkles className="w-2.5 h-2.5" style={{ color: 'var(--accent-app)' }} />
                          {app.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}

              <div style={{ fontSize: '11px', fontWeight: 'var(--font-bold)', color: 'var(--text-muted)', marginBottom: '6px' }}>Mood presets</div>
              <div className="flex flex-col gap-1">
                {MOOD_PRESETS.map(mood => (
                  <button
                    key={mood.id}
                    onClick={() => { const text = `I want a ${mood.label.toLowerCase()} look: ${mood.desc}`; if (mode === 'prototype') setProtoInput(text); else setInput(text) }}
                    className="apple-press text-left px-3 py-2"
                    style={{ borderRadius: 'var(--radius-sm)', fontSize: '11px', background: 'var(--fill-secondary)' }}
                  >
                    <span style={{ fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>{mood.label}</span>
                    <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>{mood.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Moodboard toggle */}
          {images.length > 0 && (
            <button onClick={() => setShowMoodboard(!showMoodboard)} className="apple-press flex items-center gap-2 px-4 py-2" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
              {showMoodboard ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              <ImagePlus className="w-3.5 h-3.5" style={{ color: 'var(--accent-app)' }} />
              <span style={{ fontSize: '11px', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Moodboard ({images.length})</span>
            </button>
          )}
          {showMoodboard && images.length > 0 && (
            <div className="grid grid-cols-3 gap-1 p-2 overflow-y-auto" style={{ maxHeight: '150px', borderBottom: '0.5px solid var(--separator)' }}>
              {images.map(img => (
                <div key={img.filename} className="relative group">
                  <img src={`/api/design/uploads/${img.filename}`} alt="" className="w-full h-16 object-cover" style={{ borderRadius: 'var(--radius-sm)' }} />
                  <button onClick={() => removeImage(img.filename)} className="absolute top-0.5 right-0.5 p-0.5 opacity-0 group-hover:opacity-100" style={{ background: 'rgba(0,0,0,0.6)', borderRadius: 'var(--radius-sm)' }}>
                    <X className="w-3 h-3 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 custom-scrollbar" style={{ background: 'var(--bg-app)' }}>
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Palette className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                <p style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-muted)' }}>Describe your vision</p>
                <p style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', marginTop: '4px' }}>Upload moodboard images, pick adjectives, or just describe what you want.</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`mb-3 ${msg.role === 'user' ? 'text-right' : ''}`}>
                {msg.role === 'system' ? (
                  <div className="text-center py-2">
                    <Badge preset="accent" style={{ padding: '4px 12px', fontSize: '11px' }}>
                      <Check className="w-3 h-3" /> {msg.content}
                    </Badge>
                  </div>
                ) : (
                  <div
                    style={{
                      display: 'inline-block', maxWidth: '90%', textAlign: 'left',
                      padding: '10px 14px', borderRadius: 'var(--radius-lg)',
                      fontSize: 'var(--text-footnote)', lineHeight: '1.5',
                      color: 'var(--text-app)',
                      background: msg.role === 'user' ? 'color-mix(in srgb, var(--accent-app) 15%, transparent)' : 'var(--bg-secondary)',
                    }}
                  >
                    {msg.images && msg.images.length > 0 && (
                      <div className="flex gap-1 mb-2">
                        {msg.images.map(img => (
                          <img key={img.filename} src={`/api/design/uploads/${img.filename}`} alt="" className="h-12 rounded object-cover" />
                        ))}
                      </div>
                    )}
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    {msg.cssChanges && msg.cssChanges.length > 0 && (
                      <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
                        <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--accent-app)', marginBottom: '4px' }}>{msg.cssChanges.length} changes proposed</div>
                        {msg.cssChanges.slice(0, 8).map((c, j) => {
                          const isColor = /color|bg|accent|text|fill|border/i.test(c.variable) && /^#|^rgb|^hsl|^var/i.test(c.value)
                          return (
                            <div key={j} className="flex items-center gap-1.5 mb-1" style={{ fontSize: '10px' }}>
                              {isColor && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {c.oldValue && <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: c.oldValue, border: '1px solid var(--separator)' }} />}
                                  {c.oldValue && <span style={{ color: 'var(--text-tertiary)', fontSize: '8px' }}>→</span>}
                                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: c.value, border: '1px solid var(--separator)' }} />
                                </div>
                              )}
                              <span className="truncate" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', maxWidth: '120px' }}>{c.variable}</span>
                              {c.oldValue && <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', textDecoration: 'line-through', fontSize: '9px' }}>{c.oldValue}</span>}
                              <span style={{ color: 'var(--text-tertiary)', fontSize: '8px' }}>→</span>
                              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-app)' }}>{c.value}</span>
                            </div>
                          )
                        })}
                        {msg.cssChanges.length > 8 && (
                          <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>+{msg.cssChanges.length - 8} more</span>
                        )}
                      </div>
                    )}
                    {msg.styleInjection && (
                      <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
                        <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--apple-teal)', marginBottom: '4px' }}>Style rules injected (live preview)</div>
                        <pre style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', maxHeight: '80px', overflow: 'auto' }}>{msg.styleInjection}</pre>
                      </div>
                    )}
                    {msg.fileChanges && msg.fileChanges.length > 0 && (
                      <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
                        <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--apple-purple)', marginBottom: '4px' }}>{msg.fileChanges.length} file changes proposed</div>
                        {msg.fileChanges.map((c, j) => (
                          <div key={j} className="mb-1" style={{ fontSize: '10px' }}>
                            <span style={{ color: 'var(--apple-purple)', fontFamily: 'var(--font-mono)' }}>{c.file}</span>
                            {c.description && <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>— {c.description}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 mb-3">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-app)' }} />
                <span style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-muted)' }}>Designing...</span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Pending images */}
          {pendingImages.length > 0 && (
            <div className="flex gap-1 px-4 py-1" style={{ borderTop: '0.5px solid var(--separator)' }}>
              {pendingImages.map(img => (
                <div key={img.filename} className="relative">
                  <img src={`/api/design/uploads/${img.filename}`} alt="" className="h-10 rounded object-cover" />
                  <button onClick={() => setPendingImages(prev => prev.filter(i => i.filename !== img.filename))} className="absolute -top-1 -right-1 p-0.5" style={{ background: 'var(--apple-red)', borderRadius: '50%' }}>
                    <X className="w-2.5 h-2.5 text-white" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input area */}
          {/* Implementation panel — shows when reviewing component changes */}
          {mode === 'implement' && implementPlan.length > 0 && implementIndex < implementPlan.length && (
            <div className="px-4 py-3" style={{ borderTop: '0.5px solid var(--separator)', background: 'var(--fill-secondary)' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--apple-purple)', textTransform: 'uppercase' }}>
                  Component {implementIndex + 1}/{implementPlan.length}
                </span>
                <Badge color="var(--apple-purple)" bg="color-mix(in srgb, var(--apple-purple) 15%, transparent)" style={{ padding: '2px 6px', fontSize: '9px' }}>
                  {implementPlan[implementIndex].complexity || 'medium'}
                </Badge>
              </div>
              <div style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', marginBottom: '4px' }}>
                {implementPlan[implementIndex].component}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', lineHeight: '1.4' }}>
                {implementPlan[implementIndex].description}
              </div>
              {implementPlan[implementIndex].fileChanges?.length > 0 && (
                <div style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                  {implementPlan[implementIndex].fileChanges.length} file edit(s) in {implementPlan[implementIndex].file}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={() => handleApproveComponent(implementPlan[implementIndex])}>
                  <Check className="w-3.5 h-3.5" /> Approve
                </Button>
                <Button variant="ghost" size="sm" onClick={() => handleSkipComponent(implementPlan[implementIndex])}>
                  Skip
                </Button>
                <div className="flex-1" />
                <span style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>
                  {implementIndex}/{implementPlan.length} done
                </span>
              </div>
            </div>
          )}
          {mode === 'implement' && implementIndex >= implementPlan.length && implementPlan.length > 0 && (
            <div className="px-4 py-3 text-center" style={{ borderTop: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 'var(--text-footnote)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-green)', marginBottom: '4px' }}>Implementation complete!</div>
              <Button variant="ghost" size="sm" onClick={() => { setMode('refine'); setImplementPlan([]) }}>Back to Refine</Button>
            </div>
          )}

          {/* Input area */}
          <div
            ref={dropZoneRef}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className="px-4 py-3"
            style={{ borderTop: mode === 'implement' ? 'none' : '0.5px solid var(--separator)', background: 'var(--bg-secondary)', display: mode === 'implement' ? 'none' : undefined }}
          >
            {mode === 'prototype' ? (
              /* Prototype mode input */
              <div>
                {prototypeId && (
                  <div className="flex items-center gap-2 mb-2">
                    <Badge color="var(--apple-purple)" bg="var(--fill-secondary)" style={{ padding: '3px 8px' }}>Prototype active</Badge>
                    <Button variant="ghost" size="sm" onClick={() => { setMode('refine'); setPrototypeId(null) }} style={{ fontSize: '10px' }}>Back to Live</Button>
                    <div className="flex-1" />
                    <Button variant="secondary" size="sm" onClick={handleStartImplementation} loading={protoLoading}>
                      <Check className="w-3.5 h-3.5" /> Implement Design
                    </Button>
                  </div>
                )}
                {protoLoading && protoProgress && <ProtoProgressBar progress={protoProgress} onCancel={handleCancelPrototype} />}
                <div className="flex items-end gap-2">
                  <IconButton onClick={() => fileInputRef.current?.click()} aria-label="Upload image" size="sm">
                    <ImagePlus className="w-4 h-4" />
                  </IconButton>
                  <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" multiple className="hidden" />
                  <textarea
                    value={protoInput}
                    onChange={(e) => setProtoInput(e.target.value)}
                    onPaste={handlePaste}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleGeneratePrototype() } }}
                    placeholder={prototypeId ? 'Describe changes to the prototype...' : 'Describe the complete new design...'}
                    className="flex-1 resize-none custom-scrollbar"
                    rows={2}
                    style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--text-footnote)', color: 'var(--text-app)', outline: 'none', fontFamily: 'var(--font-sans)' }}
                  />
                  {protoLoading ? (
                    <Button variant="secondary" size="sm" onClick={handleCancelPrototype} style={{ background: 'var(--apple-red, #ff3b30)', color: '#fff', minWidth: 70 }}>
                      <XCircle className="w-3.5 h-3.5" /> Cancel
                    </Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={handleGeneratePrototype} disabled={protoLoading} style={{ background: 'var(--apple-purple)' }}>
                      <Sparkles className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              /* Refine mode input */
              <div className="flex items-end gap-2">
                <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="image/*" multiple className="hidden" />
                <IconButton onClick={() => fileInputRef.current?.click()} aria-label="Upload image" size="sm">
                  <ImagePlus className="w-4 h-4" />
                </IconButton>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                  placeholder="Describe the look you want..."
                  className="flex-1 resize-none custom-scrollbar"
                  rows={2}
                  style={{ background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 12px', fontSize: 'var(--text-footnote)', color: 'var(--text-app)', outline: 'none', fontFamily: 'var(--font-sans)' }}
                />
                <Button variant="primary" size="sm" onClick={handleSend} disabled={loading} loading={loading}>
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}
          </div>

          </>}
        </div>

        {/* Right: Live Preview */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Preview toolbar */}
          <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-0.5">
              {VIEWPORT_PRESETS.map(preset => {
                const Icon = preset.icon
                return (
                  <button key={preset.id} onClick={() => setViewport(preset.id)} className="p-1.5 apple-press" style={{ borderRadius: 'var(--radius-sm)', color: viewport === preset.id ? 'var(--accent-app)' : 'var(--text-muted)', background: viewport === preset.id ? 'color-mix(in srgb, var(--accent-app) 10%, transparent)' : 'transparent' }} title={`${preset.label}${preset.width ? ` (${preset.width}px)` : ''}`}>
                    <Icon className="w-4 h-4" />
                  </button>
                )
              })}
              {/* Custom width input */}
              <div className="flex items-center gap-1 ml-1">
                <input
                  type="number"
                  value={viewport === 'custom' ? customWidth : (iframeWidth || '')}
                  onChange={(e) => { setCustomWidth(e.target.value); setViewport('custom') }}
                  placeholder="W"
                  className="focus:outline-none text-center"
                  style={{ width: '48px', background: 'var(--fill-secondary)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '3px 4px', fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-app)' }}
                />
                <span style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>px</span>
              </div>
            </div>

            {/* Inspect mode toggle */}
            <IconButton
              size="sm"
              onClick={toggleInspect}
              aria-label={inspectMode ? 'Exit inspect mode' : 'Inspect element'}
              title={inspectMode ? 'Click an element to select it' : 'Inspect element'}
              color={inspectMode ? 'var(--accent-app)' : undefined}
              style={inspectMode ? { background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)', borderRadius: 'var(--radius-sm)' } : undefined}
            >
              <Crosshair className="w-4 h-4" />
            </IconButton>

            {/* Changes panel toggle */}
            {allChanges.length > 0 && (
              <Button variant={showChangesPanel ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowChangesPanel(!showChangesPanel)}>
                {allChanges.length} changes
              </Button>
            )}

            {/* Selected element info */}
            {selectedElement && (
              <div className="flex items-center gap-1.5 px-2 py-1" style={{ background: 'color-mix(in srgb, var(--accent-app) 8%, transparent)', borderRadius: 'var(--radius-sm)', maxWidth: '300px' }}>
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-bold)', color: 'var(--accent-app)' }} className="truncate">{selectedElement.selector}</span>
                <span style={{ fontSize: '9px', color: 'var(--text-tertiary)' }}>{selectedElement.dimensions?.width}x{selectedElement.dimensions?.height}</span>
                <button onClick={() => setSelectedElement(null)} className="apple-press shrink-0" style={{ padding: '1px' }}>
                  <XCircle className="w-3 h-3" style={{ color: 'var(--text-tertiary)' }} />
                </button>
              </div>
            )}

            <div className="flex-1" />

            {/* Undo/Redo */}
            {designHistory.length > 0 && (
              <div className="flex items-center gap-0.5">
                <IconButton size="sm" onClick={handleUndo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)" title={canUndo ? `Undo: ${designHistory[historyIndex]?.label}` : 'Nothing to undo'}>
                  <Undo2 className="w-3.5 h-3.5" />
                </IconButton>
                <IconButton size="sm" onClick={handleRedo} disabled={!canRedo} aria-label="Redo (Ctrl+Shift+Z)" title={canRedo ? `Redo: ${designHistory[historyIndex + 1]?.label}` : 'Nothing to redo'}>
                  <Redo2 className="w-3.5 h-3.5" />
                </IconButton>
                <span style={{ fontSize: '9px', color: 'var(--text-tertiary)', marginLeft: '2px' }}>{historyIndex + 1}/{designHistory.length}</span>
              </div>
            )}

            {/* Before/After toggle */}
            {appliedChanges.length > 0 && (
              <Button variant={showBefore ? 'secondary' : 'ghost'} size="sm" onClick={() => setShowBefore(!showBefore)}>
                {showBefore ? 'Showing Original' : 'Showing New Design'}
              </Button>
            )}

            {/* Change count + actions */}
            {(appliedChanges.length > 0 || styleInjection || fileChanges.length > 0) && (
              <div className="flex items-center gap-1">
                {appliedChanges.length > 0 && (
                  <>
                    <Badge preset="accent" style={{ padding: '3px 8px' }}>{appliedChanges.length} theme</Badge>
                    <Button variant="primary" size="sm" onClick={handleApply}>
                      <Check className="w-3.5 h-3.5" /> Apply Theme
                    </Button>
                  </>
                )}
                {styleInjection && (
                  <Badge color="var(--apple-teal)" bg="var(--fill-secondary)" style={{ padding: '3px 8px' }}>styles live</Badge>
                )}
                {fileChanges.length > 0 && (
                  <>
                    <Badge color="var(--apple-purple)" bg="var(--fill-secondary)" style={{ padding: '3px 8px' }}>{fileChanges.length} file edits</Badge>
                    <Button variant="secondary" size="sm" onClick={handleApplyFiles}>
                      <Check className="w-3.5 h-3.5" /> Apply Files
                    </Button>
                  </>
                )}
                <IconButton size="sm" onClick={handleReset} aria-label="Reset all changes" color="var(--apple-red)">
                  <RotateCcw className="w-3.5 h-3.5" />
                </IconButton>

                {/* Export */}
                <div className="relative">
                  <IconButton size="sm" onClick={() => setShowExportMenu(!showExportMenu)} aria-label="Export design" title="Export">
                    <Download className="w-3.5 h-3.5" />
                  </IconButton>
                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 z-30" style={{ background: 'var(--bg-card)', border: '1px solid var(--separator)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)', minWidth: '160px' }}>
                      <button onClick={handleCopyCss} className="w-full text-left apple-press flex items-center gap-2 px-3 py-2" style={{ fontSize: '11px', color: 'var(--text-app)', borderBottom: '0.5px solid var(--separator)' }}>
                        {copied ? <ClipboardCheck className="w-3.5 h-3.5" style={{ color: 'var(--apple-green)' }} /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copied!' : 'Copy CSS to clipboard'}
                      </button>
                      <button onClick={handleExportCss} className="w-full text-left apple-press flex items-center gap-2 px-3 py-2" style={{ fontSize: '11px', color: 'var(--text-app)', borderBottom: '0.5px solid var(--separator)' }}>
                        <Download className="w-3.5 h-3.5" /> Download .css file
                      </button>
                      <button onClick={handleExportJson} className="w-full text-left apple-press flex items-center gap-2 px-3 py-2" style={{ fontSize: '11px', color: 'var(--text-app)' }}>
                        <Download className="w-3.5 h-3.5" /> Download .json theme
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Iframe */}
          {/* Changes panel */}
          {showChangesPanel && allChanges.length > 0 && (
            <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: '180px', borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)', padding: '8px 12px' }}>
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Active Changes ({appliedChanges.length}/{allChanges.length})</span>
                <button onClick={() => setDisabledChanges(new Set())} className="apple-press" style={{ fontSize: '9px', color: 'var(--accent-app)', fontWeight: 'var(--font-semibold)' }}>Enable All</button>
              </div>
              {allChanges.map((c, i) => {
                const isColor = /color|bg|accent|text|fill|border/i.test(c.variable) && /^#|^rgb|^hsl/i.test(c.value)
                const disabled = disabledChanges.has(c.variable)
                return (
                  <div key={i} className="flex items-center gap-2 mb-1 apple-press cursor-pointer" onClick={() => toggleChange(c.variable)} style={{ opacity: disabled ? 0.4 : 1, padding: '3px 4px', borderRadius: 'var(--radius-sm)' }}>
                    <div style={{ width: '14px', height: '14px', borderRadius: '3px', border: `2px solid ${disabled ? 'var(--gray-3)' : 'var(--accent-app)'}`, background: disabled ? 'transparent' : 'var(--accent-app)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {!disabled && <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                    </div>
                    {isColor && (
                      <div className="flex items-center gap-0.5 shrink-0">
                        {c.oldValue && <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: c.oldValue, border: '1px solid var(--separator)' }} />}
                        {c.oldValue && <span style={{ fontSize: '8px', color: 'var(--text-tertiary)' }}>→</span>}
                        <span style={{ width: '10px', height: '10px', borderRadius: '2px', background: c.value, border: '1px solid var(--separator)' }} />
                      </div>
                    )}
                    <span className="truncate" style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', flex: 1 }}>{c.variable}</span>
                    <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: disabled ? 'var(--text-tertiary)' : 'var(--text-app)' }}>{c.value}</span>
                  </div>
                )
              })}
              {styleInjection && (
                <div className="mt-2 pt-2" style={{ borderTop: '0.5px solid var(--separator)' }}>
                  <div style={{ fontSize: '10px', fontWeight: 'var(--font-bold)', color: 'var(--apple-teal)', marginBottom: '4px' }}>Style Rules</div>
                  <pre style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{styleInjection}</pre>
                </div>
              )}
            </div>
          )}

          <div ref={previewContainerRef} className="flex-1 relative overflow-hidden" style={{ background: '#1a1a2e', userSelect: draggingWidth ? 'none' : undefined }}>
            {iframeSrc ? (
              <div className="w-full h-full flex items-start justify-center overflow-auto relative">
                <iframe
                  ref={iframeRef}
                  src={iframeSrc}
                  onLoad={handleIframeLoad}
                  className="bg-white"
                  style={{
                    width: iframeWidth ? `${iframeWidth}px` : '100%', height: '100%',
                    border: iframeWidth ? '1px solid var(--border-app)' : 'none',
                    boxShadow: iframeWidth ? '0 0 20px rgba(0,0,0,0.3)' : 'none',
                    transition: draggingWidth ? 'none' : 'width 200ms ease',
                    pointerEvents: draggingWidth ? 'none' : 'auto',
                  }}
                />
                {/* Drag handle on right edge of iframe */}
                {iframeWidth && (
                  <div
                    onMouseDown={() => setDraggingWidth(true)}
                    className="absolute top-0 bottom-0 flex items-center justify-center cursor-ew-resize z-10"
                    style={{ right: `calc(50% - ${iframeWidth / 2 + 8}px)`, width: '16px' }}
                    title="Drag to resize"
                  >
                    <div style={{ width: '3px', height: '40px', borderRadius: '2px', background: draggingWidth ? 'var(--accent-app)' : 'var(--gray-2)', transition: 'background 150ms' }} />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Monitor className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
                  <p style={{ fontSize: 'var(--text-footnote)', color: 'var(--text-muted)' }}>
                    {selectedService ? `${selectedService.name} is not running` : 'Select a frontend service to preview'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </ModalOverlay>
  )
}
