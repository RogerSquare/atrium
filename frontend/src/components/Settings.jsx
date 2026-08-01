import { useState, useEffect } from 'react'
import { X, Save, FolderOpen, Play, Square, RefreshCw, Plus, Trash2, Check, Shield, Bot, Server, Palette, User, Info, Database, Download, Key, Pencil, RotateCcw, ExternalLink, Terminal, Eye, ChevronLeft, ChevronDown, ChevronRight, Menu, Sparkles } from 'lucide-react'
import { API_URL, apiFetch } from '../config'
import ModalOverlay from './ModalOverlay'
import useIsMobile from '../hooks/useIsMobile'

// Service model v2 (feat-service-surfaces-001). Mirrors backend/lib/serviceModel.js:
// only web/server surfaces are probed over a port, so only they require one.
const SURFACES = ['web', 'server', 'desktop', 'cli', 'job']
const surfaceNeedsPort = (surface) => surface === 'web' || surface === 'server'

// Job surfaces resolve to idle/succeeded/failed from the last run's exit code;
// everything else stays running/stopped (+ unavailable for Docker-less containers).
const STATUS_STYLE = {
  running: 'bg-green-500/15 text-green-400',
  succeeded: 'bg-sky-500/15 text-sky-400',
  failed: 'bg-red-500/10 text-red-400',
  idle: 'bg-app-border/60 text-app-text-muted',
  unavailable: 'bg-amber-500/15 text-amber-400',
}
const statusStyle = (status) => STATUS_STYLE[status] || 'bg-red-500/10 text-red-400'

const parseEnvText = (text) => {
  const env = {}
  for (const line of (text || '').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i <= 0) continue
    env[t.slice(0, i).trim()] = t.slice(i + 1)
  }
  return env
}
const envToText = (env) => env && typeof env === 'object'
  ? Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
  : ''

const formatUptime = (startedAt) => {
  if (!startedAt) return null
  const ms = Date.now() - new Date(startedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return null
  const m = Math.floor(ms / 60000)
  if (m < 1) return '<1m'
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}

export default function Settings({ theme, onSetTheme, onClose, currentUser, onUserUpdate, onOpenPreview, onOpenSetup }) {
  const [activeTab, setActiveTab] = useState('appearance')
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [savedWorkingDirectory, setSavedWorkingDirectory] = useState('')
  const [defaultPriority, setDefaultPriority] = useState('medium')
  const [savedDefaultPriority, setSavedDefaultPriority] = useState('medium')
  const [defaultType, setDefaultType] = useState('fullstack')
  const [savedDefaultType, setSavedDefaultType] = useState('fullstack')
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [showAddService, setShowAddService] = useState(false)
  const EMPTY_SERVICE = { name: '', group: '', port: '', cwd: '', startCmd: '', type: 'process', container_name: '', surface: 'web', autostart: false, envText: '' }
  const [newService, setNewService] = useState(EMPTY_SERVICE)
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set())
  const [users, setUsers] = useState([])
  const [agentsEnabled, setAgentsEnabled] = useState(true)
  const [savedAgentsEnabled, setSavedAgentsEnabled] = useState(true)
  const [aiChatEnabled, setAiChatEnabled] = useState(true)
  const [savedAiChatEnabled, setSavedAiChatEnabled] = useState(true)
  const [statusInfo, setStatusInfo] = useState(null)

  // GitHub sign-in (feat-github-auth-settings-001). The container has no
  // interactive terminal for `gh auth login`, so the token is pasted here.
  const [githubAuth, setGithubAuth] = useState(null) // { connected, source, login, error, hint }
  const [githubToken, setGithubToken] = useState('')
  const [githubBusy, setGithubBusy] = useState(false)
  const [githubMessage, setGithubMessage] = useState('')

  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  // Agent tokens (admin only)
  const [agentTokens, setAgentTokens] = useState([])
  const [newTokenName, setNewTokenName] = useState('')
  const [newTokenError, setNewTokenError] = useState('')
  const [generatedToken, setGeneratedToken] = useState(null) // { token, jti, name, issued_at, installCmd }
  const [tokenCopied, setTokenCopied] = useState(false)

  const fetchAgentTokens = () => {
    return apiFetch(`${API_URL}/agent-tokens`)
      .then(r => r.ok ? r.json() : { tokens: [] })
      .then(d => setAgentTokens(d.tokens || []))
      .catch(() => {})
  }

  const handleGenerateAgentToken = async () => {
    setNewTokenError('')
    const name = newTokenName.trim()
    if (!name) { setNewTokenError('Name required'); return }
    try {
      const r = await apiFetch(`${API_URL}/agent-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!r.ok) {
        let msg = `HTTP ${r.status}`
        try { const d = await r.json(); if (d?.error) msg = d.error } catch (_) { /* non-JSON body */ }
        setNewTokenError(r.status === 404 ? 'Endpoint not found — restart atrium-backend to load the new routes.' : msg)
        return
      }
      const d = await r.json()
      const installCmd = `atrium-mcp-setup --token ${d.token} --url ${window.location.origin.replace(/:\d+$/, ':3001')}`
      setGeneratedToken({ ...d, installCmd })
      setNewTokenName('')
      fetchAgentTokens()
    } catch (e) {
      setNewTokenError('Network error — is atrium-backend running?')
    }
  }

  const handleRevokeAgentToken = async (jti) => {
    if (!confirm('Revoke this token? The agent using it will fail on next call.')) return
    try {
      await apiFetch(`${API_URL}/agent-tokens/${encodeURIComponent(jti)}`, { method: 'DELETE' })
      fetchAgentTokens()
    } catch (e) { /* ignore */ }
  }

  const copyTokenToClipboard = (text) => {
    navigator.clipboard?.writeText(text).then(() => {
      setTokenCopied(true)
      setTimeout(() => setTokenCopied(false), 1500)
    }).catch(() => {})
  }

  const isAdmin = currentUser?.role === 'admin'
  const hasUnsavedChanges = workingDirectory !== savedWorkingDirectory ||
    agentsEnabled !== savedAgentsEnabled ||
    aiChatEnabled !== savedAiChatEnabled ||
    defaultPriority !== savedDefaultPriority ||
    defaultType !== savedDefaultType

  const THEMES = [
    { id: 'dark', name: 'Dark', bg: '#1c1c1e', accent: '#0A84FF' },
    { id: 'light', name: 'Light', bg: '#f2f2f7', accent: '#007AFF' },
    { id: 'oled', name: 'OLED', bg: '#000000', accent: '#0A84FF' },
    { id: 'paper', name: 'Paper', bg: '#faf5ef', accent: '#e8750a' },
  ]

  const TABS = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'profile', label: 'Profile', icon: User },
    ...(isAdmin ? [
      { id: 'project', label: 'Project', icon: FolderOpen },
      { id: 'services', label: 'Services', icon: Server },
      { id: 'admin', label: 'Admin', icon: Shield },
      { id: 'data', label: 'Data', icon: Database },
    ] : []),
    { id: 'about', label: 'About', icon: Info },
  ]

  const fetchSettings = () => {
    return apiFetch(`${API_URL}/settings`)
      .then(res => res.json())
      .then(data => {
        setWorkingDirectory(data.workingDirectory || '')
        setSavedWorkingDirectory(data.workingDirectory || '')
        setAgentsEnabled(data.agents_enabled !== false)
        setSavedAgentsEnabled(data.agents_enabled !== false)
        setAiChatEnabled(data.ai_chat_enabled !== false)
        setSavedAiChatEnabled(data.ai_chat_enabled !== false)
        setDefaultPriority(data.default_priority || 'medium')
        setSavedDefaultPriority(data.default_priority || 'medium')
        setDefaultType(data.default_type || 'fullstack')
        setSavedDefaultType(data.default_type || 'fullstack')
      })
  }

  const fetchUsers = () => apiFetch(`${API_URL}/users`).then(r => r.json()).then(d => setUsers(d)).catch(() => {})
  const fetchServices = () => {
    setRefreshing(true)
    return apiFetch(`${API_URL}/services`).then(r => r.json()).then(d => setServices(d)).catch(() => {}).finally(() => setRefreshing(false))
  }
  const fetchStatus = () => apiFetch(`${API_URL}/settings/status`).then(r => r.json()).then(d => setStatusInfo(d)).catch(() => {})

  const fetchGithubAuth = async () => {
    try {
      const res = await apiFetch(`${API_URL}/github/auth`)
      if (res.ok) setGithubAuth(await res.json())
    } catch (err) { /* leave null — the section renders an unknown state */ }
  }

  const handleGithubConnect = async (e) => {
    e.preventDefault()
    setGithubBusy(true)
    setGithubMessage('')
    try {
      const res = await apiFetch(`${API_URL}/github/auth`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubToken.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setGithubToken('')
        setGithubMessage(`Connected as ${data.login}`)
        await fetchGithubAuth()
      } else {
        setGithubMessage(data.error || 'Could not connect')
      }
    } catch (err) {
      setGithubMessage('Could not reach the server')
    } finally {
      setGithubBusy(false)
    }
  }

  const handleGithubDisconnect = async () => {
    setGithubBusy(true)
    setGithubMessage('')
    try {
      const res = await apiFetch(`${API_URL}/github/auth`, { method: 'DELETE' })
      const data = await res.json()
      setGithubAuth(data)
      // An env-supplied GH_TOKEN outlives the stored one; don't claim otherwise.
      setGithubMessage(data.connected
        ? 'Stored token removed — still connected via GH_TOKEN in the environment'
        : 'Disconnected')
    } catch (err) {
      setGithubMessage('Could not reach the server')
    } finally {
      setGithubBusy(false)
    }
  }

  useEffect(() => {
    Promise.all([fetchSettings(), fetchServices(), isAdmin ? fetchUsers() : Promise.resolve(), fetchStatus(), isAdmin ? fetchAgentTokens() : Promise.resolve(), isAdmin ? fetchGithubAuth() : Promise.resolve()])
      .finally(() => setLoading(false))
    const interval = setInterval(fetchServices, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleServiceAction = async (id, action) => {
    try {
      const res = await apiFetch(`${API_URL}/services/${id}/${action}`, { method: 'POST' })
      if (res.ok) setTimeout(fetchServices, 2000)
      else setMessage(`Failed to ${action} service`)
    } catch (err) { setMessage(`Failed to ${action} service — network error`) }
  }

  const handleGroupAction = async (groupName, action) => {
    try {
      const res = await apiFetch(`${API_URL}/services/groups/${groupName}/${action}`, { method: 'POST' })
      if (res.ok) setTimeout(fetchServices, 2000)
      else setMessage(`Failed to ${action} group`)
    } catch (err) { setMessage(`Failed to ${action} group — network error`) }
  }

  // Collapsible service groups (absorbs ui-services-009).
  const toggleGroup = (groupName) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupName)) next.delete(groupName)
      else next.add(groupName)
      return next
    })
  }

  const handleAddService = async (e) => {
    e.preventDefault()
    const { envText, ...payload } = newService
    const env = parseEnvText(envText)
    if (Object.keys(env).length > 0) payload.env = env
    try {
      const res = await apiFetch(`${API_URL}/services`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) { setNewService(EMPTY_SERVICE); setShowAddService(false); fetchServices() }
      else setMessage('Failed to add service')
    } catch (err) { setMessage('Failed to add service — network error') }
  }

  const [editingService, setEditingService] = useState(null)
  const [editServiceData, setEditServiceData] = useState({})
  const [expandedLogs, setExpandedLogs] = useState(null)
  const [serviceLogs, setServiceLogs] = useState([])

  const handleEditService = (service) => {
    setEditingService(service.id)
    setEditServiceData({ name: service.name, group: service.group, port: service.port, cwd: service.cwd, startCmd: service.startCmd, depends_on: service.depends_on || [], preview: service.preview ?? false, surface: service.surface || '', autostart: !!service.autostart, envText: envToText(service.env) })
  }

  const handleSaveService = async (id) => {
    const { envText, ...payload } = editServiceData
    payload.env = parseEnvText(envText)
    // '' means "legacy, no surface" — the backend rejects surface values
    // outside the enum, so omit rather than send the empty string.
    if (!payload.surface) delete payload.surface
    try {
      const res = await apiFetch(`${API_URL}/services/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (res.ok) { setEditingService(null); fetchServices() }
      else setMessage('Failed to save service')
    } catch (err) { setMessage('Failed to save service — network error') }
  }

  const handleRestartService = async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/services/${id}/restart`, { method: 'POST' })
      if (res.ok) setTimeout(fetchServices, 3000)
      else setMessage('Failed to restart service')
    } catch (err) { setMessage('Failed to restart service — network error') }
  }

  const handleStopService = async (id, name) => {
    if (!window.confirm(`Stop "${name}"?`)) return
    handleServiceAction(id, 'stop')
  }

  const handleToggleLogs = async (serviceId) => {
    if (expandedLogs === serviceId) {
      setExpandedLogs(null)
      setServiceLogs([])
    } else {
      setExpandedLogs(serviceId)
      try {
        const res = await apiFetch(`${API_URL}/services/${serviceId}/logs`)
        const data = await res.json()
        setServiceLogs(data.logs || [])
      } catch (err) { setServiceLogs([]) }
    }
  }

  const handleClearServiceLogs = async (serviceId) => {
    try {
      await apiFetch(`${API_URL}/services/${serviceId}/logs`, { method: 'DELETE' })
      setServiceLogs([])
    } catch (err) { setMessage('Failed to clear logs') }
  }

  const handleDeleteService = async (id) => {
    if (!window.confirm('Remove this service from registry?')) return
    try { const res = await apiFetch(`${API_URL}/services/${id}`, { method: 'DELETE' }); if (res.ok) fetchServices(); else setMessage('Failed to delete service') } catch (err) { setMessage('Failed to delete service — network error') }
  }

  const handleSave = async () => {
    setSaving(true); setMessage('')
    try {
      const res = await apiFetch(`${API_URL}/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory, agents_enabled: agentsEnabled, ai_chat_enabled: aiChatEnabled, default_priority: defaultPriority, default_type: defaultType })
      })
      if (res.ok) {
        setSavedWorkingDirectory(workingDirectory); setSavedAgentsEnabled(agentsEnabled); setSavedAiChatEnabled(aiChatEnabled)
        setSavedDefaultPriority(defaultPriority); setSavedDefaultType(defaultType)
        setMessage('Saved!'); setTimeout(() => setMessage(''), 3000)
      } else { setMessage('Failed to save') }
    } catch (err) { setMessage('Error connecting') } finally { setSaving(false) }
  }

  const handleToggleUserAgent = async (username, val) => {
    try {
      const res = await apiFetch(`${API_URL}/users/${username}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ can_run_agents: !val }) })
      if (res.ok) {
        setUsers(prev => prev.map(u => u.username === username ? { ...u, can_run_agents: !val } : u))
        if (username === currentUser?.username && onUserUpdate) onUserUpdate({ ...currentUser, can_run_agents: !val })
      }
    } catch (err) { setMessage('Failed to update user permissions') }
  }

  const handleToggleUserAiChat = async (username, val) => {
    try {
      const res = await apiFetch(`${API_URL}/users/${username}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ can_use_ai_chat: !val }) })
      if (res.ok) {
        setUsers(prev => prev.map(u => u.username === username ? { ...u, can_use_ai_chat: !val } : u))
        if (username === currentUser?.username && onUserUpdate) onUserUpdate({ ...currentUser, can_use_ai_chat: !val })
      }
    } catch (err) { setMessage('Failed to update user permissions') }
  }

  const handleToggleUserRole = async (username, role) => {
    const newRole = role === 'admin' ? 'member' : 'admin'
    try {
      const res = await apiFetch(`${API_URL}/users/${username}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: newRole }) })
      if (res.ok) {
        setUsers(prev => prev.map(u => u.username === username ? { ...u, role: newRole } : u))
        if (username === currentUser?.username && onUserUpdate) onUserUpdate({ ...currentUser, role: newRole })
      }
    } catch (err) { setMessage('Failed to update user role') }
  }

  const handleDeleteUser = async (username) => {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return
    try {
      const res = await apiFetch(`${API_URL}/users/${username}`, { method: 'DELETE' })
      if (res.ok) setUsers(prev => prev.filter(u => u.username !== username))
    } catch (err) { setMessage('Failed to delete user') }
  }

  const handleChangePassword = async () => {
    setPasswordMessage('')
    if (!currentPassword || !newPassword) return setPasswordMessage('All fields required')
    if (newPassword.length < 4) return setPasswordMessage('Password must be at least 4 characters')
    if (newPassword !== confirmPassword) return setPasswordMessage('Passwords do not match')
    try {
      const res = await apiFetch(`${API_URL}/change-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: currentUser?.username, currentPassword, newPassword })
      })
      const data = await res.json()
      if (res.ok) { setPasswordMessage('Password changed!'); setCurrentPassword(''); setNewPassword(''); setConfirmPassword('') }
      else setPasswordMessage(data.error || 'Failed')
    } catch (err) { setPasswordMessage('Error connecting') }
  }

  const handleClearChat = async () => {
    if (!window.confirm('Clear all chat messages? This cannot be undone.')) return
    try { await apiFetch(`${API_URL}/settings/chat-history`, { method: 'DELETE' }); setMessage('Chat cleared!'); setTimeout(() => setMessage(''), 3000) } catch (err) { setMessage('Failed to clear chat') }
  }

  const handlePurgeHistory = async () => {
    if (!window.confirm('Delete history backups older than 30 days?')) return
    try {
      const res = await apiFetch(`${API_URL}/settings/history?days=30`, { method: 'DELETE' })
      const data = await res.json()
      setMessage(`Deleted ${data.deleted} backups`); setTimeout(() => setMessage(''), 3000)
      fetchStatus()
    } catch (err) { setMessage('Failed to purge history') }
  }

  const handleExport = () => { window.open(`${API_URL}/settings/export`, '_blank') }

  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1048576).toFixed(1)} MB`
  }

  const handleClose = () => {
    if (hasUnsavedChanges && !window.confirm('You have unsaved changes. Discard them?')) return
    onClose()
  }

  const isMobile = useIsMobile()

  // --- Shared tab navigation ---
  const renderTabs = (layout) => {
    if (layout === 'horizontal') {
      return (
        <nav className="flex overflow-x-auto mobile-scroll-hidden shrink-0 gap-0.5" style={{ padding: '8px 12px', borderBottom: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className="apple-segment apple-press flex items-center gap-1.5 whitespace-nowrap"
                style={{
                  padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)',
                  color: activeTab === tab.id ? 'var(--text-app)' : 'var(--text-muted)',
                  background: activeTab === tab.id ? 'var(--bg-card)' : 'transparent',
                }}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {tab.label}
              </button>
            )
          })}
        </nav>
      )
    }
    return (
      <nav className="w-44 shrink-0 overflow-y-auto" style={{ padding: 'var(--space-2)', borderRight: '0.5px solid var(--separator)', background: 'var(--bg-secondary)' }}>
        {TABS.map(tab => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="w-full flex items-center gap-2.5 text-left apple-press"
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-caption1)',
                fontWeight: 'var(--font-medium)',
                color: isActive ? 'var(--text-app)' : 'var(--text-muted)',
                background: isActive ? 'var(--fill-secondary)' : 'transparent',
                marginBottom: '2px',
                transition: `all var(--duration-fast) var(--ease-default)`,
              }}
            >
              <Icon className="w-4 h-4 shrink-0" style={{ color: isActive ? 'var(--accent-app)' : 'var(--text-tertiary)' }} />
              {tab.label}
            </button>
          )
        })}
      </nav>
    )
  }

  // --- Mobile: full-screen page with sidebar menu ---
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const activeTabObj = TABS.find(t => t.id === activeTab)

  if (isMobile) {
    const ActiveIcon = activeTabObj?.icon
    return (
      <div className="fixed inset-0 z-50 bg-app-bg flex flex-col">
        {/* Header: hamburger left, section title center, actions right */}
        <header className="px-3 py-3 border-b border-app-border flex items-center bg-app-card/80 shrink-0 safe-top">
          <button
            onClick={() => setShowMobileMenu(true)}
            className="p-2 text-app-text-muted hover:text-app-text rounded-lg transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1 flex items-center justify-center gap-1.5">
            {ActiveIcon && <ActiveIcon className="w-3.5 h-3.5 text-app-accent" />}
            <span className="text-sm font-semibold text-app-text">{activeTabObj?.label || 'Settings'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {message && <span className={`text-[10px] font-medium ${message.includes('saved') || message.includes('Saved') || message.includes('changed') || message.includes('cleared') || message.includes('Deleted') ? 'text-green-400' : 'text-red-400'}`}>{message}</span>}
            {hasUnsavedChanges ? (
              <button onClick={handleSave} disabled={saving || loading}
                className="bg-app-accent text-white px-3 py-1.5 rounded-lg font-semibold text-xs flex items-center gap-1.5 disabled:opacity-30 shadow-md shadow-app-accent/20">
                <Save className="w-3.5 h-3.5" /> {saving ? '...' : 'Save'}
              </button>
            ) : (
              <button onClick={handleClose} className="p-2 text-app-text-muted hover:text-app-text rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 safe-bottom">
          {renderContent()}
        </div>

        {/* Slide-out sidebar menu */}
        {showMobileMenu && (
          <div className="fixed inset-0 z-[60] flex" onClick={() => setShowMobileMenu(false)}>
            <div className="absolute inset-0 bg-black/60" />
            <nav
              className="relative w-72 bg-app-bg border-r border-app-border flex flex-col shadow-2xl animate-slide-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-app-border flex items-center justify-between">
                <h3 className="text-sm font-semibold text-app-text">Settings</h3>
                <button onClick={() => setShowMobileMenu(false)} className="p-1.5 text-app-text-muted hover:text-app-text rounded-lg transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {TABS.map(tab => {
                  const Icon = tab.icon
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setShowMobileMenu(false) }}
                      className={`w-full flex items-center gap-3 px-5 py-3.5 text-left text-sm font-medium transition-colors
                        ${isActive
                          ? 'text-app-accent bg-app-accent/10 border-l-[3px] border-app-accent'
                          : 'text-app-text-muted hover:text-app-text hover:bg-app-border/30 border-l-[3px] border-transparent'
                        }
                      `}
                    >
                      <Icon className={`w-4.5 h-4.5 shrink-0 ${isActive ? 'text-app-accent' : ''}`} />
                      {tab.label}
                    </button>
                  )
                })}
              </div>
              <div className="px-5 py-3 border-t border-app-border">
                <button onClick={handleClose} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-app-text-muted hover:text-app-text bg-app-card hover:bg-app-border rounded-lg transition-colors border border-app-border">
                  <ChevronLeft className="w-4 h-4" />
                  Back to Board
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>
    )
  }

  // --- Shared content renderer ---
  // (this function is defined between the mobile and desktop returns
  //  but is hoisted by JS, so the desktop return below can also call it)
  function renderContent() {
    if (loading) return <div className="text-center text-app-text-muted py-12 italic animate-pulse text-sm">Loading...</div>
    return (
              <>
                {/* APPEARANCE */}
                {activeTab === 'appearance' && (
                  <div>
                    <h3 style={{ fontSize: 'var(--text-subhead)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)', marginBottom: '4px' }}>Theme</h3>
                    <p style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-5)' }}>Choose your preferred appearance.</p>
                    <div className="flex flex-wrap gap-5">
                      {THEMES.map(t => {
                        const isActive = theme === t.id
                        return (
                          <button key={t.id} onClick={() => onSetTheme(t.id)} className="apple-press flex flex-col items-center gap-2" style={{ minWidth: '64px' }}>
                            <div className="relative">
                              <div
                                className="flex items-center justify-center"
                                style={{
                                  width: '52px', height: '52px',
                                  borderRadius: '50%',
                                  background: t.bg,
                                  boxShadow: isActive ? `0 0 0 3px var(--accent-app)` : 'none',
                                  border: `2px solid ${t.bg === '#000000' || t.bg === '#1c1c1e' || t.bg === '#1e1e1e' || t.bg === '#0f1923' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
                                  transition: `box-shadow var(--duration-fast) var(--ease-default)`,
                                }}
                              >
                                <div style={{ width: '18px', height: '18px', borderRadius: '50%', background: t.accent }} />
                              </div>
                              {isActive && (
                                <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-white" style={{ background: 'var(--accent-app)' }}>
                                  <Check className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: 'var(--text-caption2)', fontWeight: isActive ? 'var(--font-semibold)' : 'var(--font-medium)', color: isActive ? 'var(--accent-app)' : 'var(--text-muted)' }}>{t.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* PROJECT */}
                {activeTab === 'project' && isAdmin && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Working Directory</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Base path where agents and services operate.</p>
                      <input type="text" value={workingDirectory} onChange={(e) => setWorkingDirectory(e.target.value)}
                        className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent transition-all" placeholder="C:\Path\To\Projects" />
                    </div>
                    {/* Re-run the first-run wizard. Reopening clears the
                        dismissal server-side so it reflects live state again. */}
                    {onOpenSetup && (
                      <div>
                        <h3 className="text-sm font-semibold text-app-text mb-1">Setup</h3>
                        <p className="text-[11px] text-app-text-muted mb-3">
                          Walk through the workspace folder, GitHub, and Claude Code sign-in again.
                        </p>
                        <button type="button"
                          onClick={async () => {
                            try { await apiFetch(`${API_URL}/setup/reopen`, { method: 'POST' }) } catch { /* open anyway */ }
                            onOpenSetup()
                          }}
                          className="px-4 py-2 text-sm rounded-lg border border-app-border text-app-text hover:border-app-text-muted transition-colors">
                          Run setup guide
                        </button>
                      </div>
                    )}

                    {/* GitHub sign-in — without a token the Changes view can
                        show branches but never PR badges. */}
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">GitHub</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">
                        Required for pull-request badges in the Changes view. Paste a personal access token with the <code className="text-app-text">repo</code> scope.
                      </p>

                      {githubAuth?.connected ? (
                        <div className="flex items-center justify-between gap-3 bg-app-bg border border-app-border rounded-lg px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Check size={16} className="text-green-500 shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm text-app-text truncate">
                                Connected as <span className="font-semibold">{githubAuth.login}</span>
                              </div>
                              <div className="text-[11px] text-app-text-muted">
                                {githubAuth.source === 'env'
                                  ? 'From GH_TOKEN in the environment'
                                  : `Stored token ${githubAuth.hint || ''}`}
                              </div>
                            </div>
                          </div>
                          {githubAuth.source === 'settings' && (
                            <button type="button" onClick={handleGithubDisconnect} disabled={githubBusy}
                              className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-app-border text-app-text-muted hover:text-app-text hover:border-app-text-muted disabled:opacity-50 transition-colors">
                              Disconnect
                            </button>
                          )}
                        </div>
                      ) : (
                        <form onSubmit={handleGithubConnect} className="space-y-2">
                          {githubAuth && githubAuth.error && (
                            <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                              {githubAuth.error}
                            </div>
                          )}
                          <div className="flex gap-2">
                            <input type="password" value={githubToken} onChange={(e) => setGithubToken(e.target.value)}
                              autoComplete="off" spellCheck="false" placeholder="ghp_..."
                              className="flex-1 bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent transition-all" />
                            <button type="submit" disabled={githubBusy || !githubToken.trim()}
                              className="shrink-0 px-4 py-2.5 text-sm rounded-lg bg-app-accent text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity">
                              {githubBusy ? 'Checking…' : 'Connect'}
                            </button>
                          </div>
                          <a href="https://github.com/settings/tokens/new?scopes=repo&description=Atrium"
                            target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-app-text-muted hover:text-app-accent transition-colors">
                            Create a token on GitHub <ExternalLink size={11} />
                          </a>
                        </form>
                      )}

                      {githubMessage && (
                        <p className="text-[11px] text-app-text-muted mt-2">{githubMessage}</p>
                      )}
                    </div>

                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Default Task Settings</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Defaults applied when creating new tasks.</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] uppercase font-semibold text-app-text-muted mb-1.5">Default Priority</label>
                          <select value={defaultPriority} onChange={(e) => setDefaultPriority(e.target.value)}
                            className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent cursor-pointer">
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase font-semibold text-app-text-muted mb-1.5">Default Type</label>
                          <select value={defaultType} onChange={(e) => setDefaultType(e.target.value)}
                            className="w-full bg-app-bg border border-app-border rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent cursor-pointer">
                            <option value="frontend">Frontend</option>
                            <option value="backend">Backend</option>
                            <option value="fullstack">Fullstack</option>
                            <option value="devops">DevOps</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* SERVICES */}
                {activeTab === 'services' && isAdmin && (
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <h3 className="text-sm font-semibold text-app-text">Service Registry</h3>
                        <p className="text-[11px] text-app-text-muted">
                          {services.length > 0 ? `${services.filter(s => s.status === 'running').length} of ${services.length} running` : 'Manage background services.'}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {services.length > 1 && (
                          <>
                            <button onClick={() => { services.forEach(s => { if (s.status !== 'running') handleServiceAction(s.id, 'start') }) }} className="px-2 py-1 text-[9px] font-semibold uppercase text-green-400 hover:bg-green-500/10 rounded-lg transition-colors" title="Start All">Start All</button>
                            <button onClick={() => { if (window.confirm('Stop all services?')) services.forEach(s => { if (s.status === 'running') handleServiceAction(s.id, 'stop') }) }} className="px-2 py-1 text-[9px] font-semibold uppercase text-red-400 hover:bg-red-400/10 rounded-lg transition-colors" title="Stop All">Stop All</button>
                            <div className="w-px h-5 bg-app-border mx-0.5" />
                          </>
                        )}
                        <button onClick={() => setShowAddService(!showAddService)} className={`p-1.5 rounded-lg transition-all ${showAddService ? 'bg-app-accent text-white' : 'text-app-text-muted hover:text-app-text hover:bg-app-border'}`} title="Add"><Plus className="w-3.5 h-3.5" /></button>
                        <button onClick={fetchServices} disabled={refreshing} className={`p-1.5 rounded-lg text-app-text-muted hover:text-app-text hover:bg-app-border transition-all ${refreshing ? 'animate-spin' : ''}`}><RefreshCw className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    {showAddService && (
                      <form onSubmit={handleAddService} className="bg-app-bg border border-app-accent/30 p-4 rounded-xl space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <input required placeholder="Service Name" value={newService.name} onChange={(e) => setNewService({...newService, name: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                          <input required placeholder="Group" value={newService.group} onChange={(e) => setNewService({...newService, group: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                        </div>
                        {/* Kind selector. A container service is driven through Docker and
                            has no cwd/start command; a process service is spawned on the
                            host and cannot run in container mode. */}
                        <div className="flex gap-2" role="radiogroup" aria-label="Service kind">
                          {[['container', 'Container'], ['process', 'Process']].map(([val, label]) => (
                            <button
                              key={val}
                              type="button"
                              role="radio"
                              aria-checked={newService.type === val}
                              onClick={() => setNewService({ ...newService, type: val })}
                              className={`flex-1 px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all border ${
                                newService.type === val
                                  ? 'bg-app-accent text-white border-app-accent'
                                  : 'bg-app-card text-app-text-muted border-app-border hover:text-app-text'
                              }`}
                            >{label}</button>
                          ))}
                        </div>

                        {/* Surface picker (feat-service-surfaces-001) — what kind of thing
                            this service is. Drives preview eligibility, whether a port is
                            required, and how status is resolved. */}
                        <div>
                          <label className="block text-[9px] uppercase font-semibold text-app-text-muted mb-1">Surface</label>
                          <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Service surface">
                            {SURFACES.map(val => (
                              <button
                                key={val}
                                type="button"
                                role="radio"
                                aria-checked={newService.surface === val}
                                onClick={() => setNewService({ ...newService, surface: val })}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all border ${
                                  newService.surface === val
                                    ? 'bg-app-accent text-white border-app-accent'
                                    : 'bg-app-card text-app-text-muted border-app-border hover:text-app-text'
                                }`}
                              >{val}</button>
                            ))}
                          </div>
                          <p className="text-[10px] text-app-text-muted mt-1.5 leading-relaxed">
                            {{
                              web: 'Browser UI listening on a port — shows up in the preview panel.',
                              server: 'Backend or API listening on a port. Not previewable.',
                              desktop: 'GUI app with no port — alive while its process runs.',
                              cli: 'Terminal app with no port — alive while its process runs.',
                              job: 'Runs to completion (build, test, script) — status comes from the exit code.',
                            }[newService.surface]}
                          </p>
                        </div>

                        {newService.type === 'container' ? (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <input required placeholder="Container Name (docker ps)" value={newService.container_name} onChange={(e) => setNewService({...newService, container_name: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                              <input type="number" placeholder="Port (optional)" value={newService.port} onChange={(e) => setNewService({...newService, port: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                            </div>
                            <p className="text-[10px] text-app-text-muted leading-relaxed">
                              Managed through Docker. Status and the published port are read from
                              the container, so Port is only a hint for links.
                            </p>
                          </>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-3">
                              <input required={surfaceNeedsPort(newService.surface)} type="number" placeholder={surfaceNeedsPort(newService.surface) ? 'Port' : 'Port (optional)'} value={newService.port} onChange={(e) => setNewService({...newService, port: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                              <input required placeholder="Start Cmd" value={newService.startCmd} onChange={(e) => setNewService({...newService, startCmd: e.target.value})} className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                            </div>
                            <input required placeholder="Working Dir" value={newService.cwd} onChange={(e) => setNewService({...newService, cwd: e.target.value})} className="w-full bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                            <p className="text-[10px] text-app-text-muted leading-relaxed">
                              Spawned on the host. Not available when Atrium runs in a container.
                            </p>
                          </>
                        )}

                        {/* Per-service environment (absorbs ui-services-010) — merged over the
                            backend's env at spawn time. */}
                        <div>
                          <label className="block text-[9px] uppercase font-semibold text-app-text-muted mb-1" htmlFor="new-service-env">Environment Variables</label>
                          <textarea
                            id="new-service-env"
                            rows={3}
                            placeholder={'KEY=value — one per line (optional)'}
                            value={newService.envText}
                            onChange={(e) => setNewService({ ...newService, envText: e.target.value })}
                            className="w-full bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs font-mono text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent resize-y"
                          />
                        </div>

                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          {/* Autostart (absorbs ui-services-008) — started by the backend at boot. */}
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newService.autostart}
                              onChange={(e) => setNewService({ ...newService, autostart: e.target.checked })}
                              className="rounded border-app-border text-app-accent focus:ring-app-accent w-3 h-3"
                            />
                            <span className="text-[10px] font-medium text-app-text-muted">Start automatically when Atrium boots</span>
                          </label>
                          <button type="submit" className="bg-app-accent hover:bg-app-accent-hover text-white px-4 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all shadow-md">Register</button>
                        </div>
                      </form>
                    )}
                    <div className="space-y-5">
                      {Object.entries(services.reduce((acc, s) => { const g = s.group || 'Uncategorized'; if (!acc[g]) acc[g] = []; acc[g].push(s); return acc }, {})).map(([groupName, groupServices]) => (
                        <div key={groupName}>
                          <div className="flex justify-between items-center mb-2 px-1">
                            <button
                              type="button"
                              onClick={() => toggleGroup(groupName)}
                              aria-expanded={!collapsedGroups.has(groupName)}
                              className="flex items-center gap-1 text-[10px] uppercase font-black text-app-text-muted tracking-[0.15em] hover:text-app-text transition-colors"
                            >
                              {collapsedGroups.has(groupName) ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
                              {groupName} <span className="text-app-text-muted/50 normal-case tracking-normal font-semibold">({groupServices.filter(s => s.status === 'running').length}/{groupServices.length})</span>
                            </button>
                            <div className="flex gap-1">
                              <button onClick={() => handleGroupAction(groupName, 'start')} className="p-1 text-app-text-muted hover:text-green-500 transition-colors" title="Start group"><Play className="w-3 h-3 fill-current" /></button>
                              <button onClick={() => handleGroupAction(groupName, 'stop')} className="p-1 text-app-text-muted hover:text-red-400 transition-colors" title="Stop group"><Square className="w-3 h-3 fill-current" /></button>
                            </div>
                          </div>
                          {!collapsedGroups.has(groupName) && (
                          <div className="space-y-1.5">
                            {groupServices.map(s => (
                              <div key={s.id} className={`rounded-xl border transition-colors group ${s.status === 'running' ? 'bg-green-500/5 border-green-500/15' : 'bg-app-bg border-app-border'}`}>
                                {editingService === s.id ? (
                                  /* Edit mode */
                                  <div className="p-3 space-y-2">
                                    <div className="grid grid-cols-2 gap-2">
                                      <input value={editServiceData.name} onChange={(e) => setEditServiceData({...editServiceData, name: e.target.value})} placeholder="Name" className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                                      <input value={editServiceData.group} onChange={(e) => setEditServiceData({...editServiceData, group: e.target.value})} placeholder="Group" className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <input type="number" value={editServiceData.port} onChange={(e) => setEditServiceData({...editServiceData, port: e.target.value})} placeholder="Port" className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                                      <input value={editServiceData.startCmd} onChange={(e) => setEditServiceData({...editServiceData, startCmd: e.target.value})} placeholder="Start Cmd" className="bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                                    </div>
                                    <input value={editServiceData.cwd} onChange={(e) => setEditServiceData({...editServiceData, cwd: e.target.value})} placeholder="Working Dir" className="w-full bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent" />
                                    <div>
                                      <label className="block text-[9px] uppercase font-semibold text-app-text-muted mb-1" htmlFor={`edit-surface-${s.id}`}>Surface</label>
                                      <select
                                        id={`edit-surface-${s.id}`}
                                        value={editServiceData.surface}
                                        onChange={(e) => setEditServiceData({...editServiceData, surface: e.target.value})}
                                        className="w-full bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent cursor-pointer"
                                      >
                                        <option value="">legacy (port-based)</option>
                                        {SURFACES.map(v => <option key={v} value={v}>{v}</option>)}
                                      </select>
                                    </div>
                                    <div>
                                      <label className="block text-[9px] uppercase font-semibold text-app-text-muted mb-1" htmlFor={`edit-env-${s.id}`}>Environment Variables</label>
                                      <textarea
                                        id={`edit-env-${s.id}`}
                                        rows={3}
                                        placeholder={'KEY=value — one per line'}
                                        value={editServiceData.envText}
                                        onChange={(e) => setEditServiceData({...editServiceData, envText: e.target.value})}
                                        className="w-full bg-app-card border border-app-border rounded-lg px-3 py-1.5 text-xs font-mono text-app-text outline-none focus-visible:ring-1 focus-visible:ring-app-accent resize-y"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[9px] uppercase font-semibold text-app-text-muted mb-1">Depends On</label>
                                      <div className="flex flex-wrap gap-1.5">
                                        {services.filter(other => other.id !== s.id).map(other => {
                                          const selected = (editServiceData.depends_on || []).includes(other.id)
                                          return (
                                            <button
                                              key={other.id}
                                              type="button"
                                              onClick={() => {
                                                const deps = editServiceData.depends_on || []
                                                setEditServiceData({...editServiceData, depends_on: selected ? deps.filter(d => d !== other.id) : [...deps, other.id]})
                                              }}
                                              className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${selected ? 'bg-app-accent/15 text-app-accent border-app-accent/30' : 'bg-app-bg text-app-text-muted border-app-border hover:border-app-text-muted'}`}
                                            >
                                              {other.name}
                                            </button>
                                          )
                                        })}
                                        {services.length <= 1 && <span className="text-[10px] text-app-text-muted/50 italic">No other services</span>}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 flex-wrap">
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={editServiceData.preview ?? false}
                                          onChange={(e) => setEditServiceData({...editServiceData, preview: e.target.checked})}
                                          className="rounded border-app-border text-app-accent focus:ring-app-accent w-3 h-3"
                                        />
                                        <span className="text-[10px] font-medium text-app-text-muted">Show in Browser Preview</span>
                                      </label>
                                      <label className="flex items-center gap-1.5 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={editServiceData.autostart ?? false}
                                          onChange={(e) => setEditServiceData({...editServiceData, autostart: e.target.checked})}
                                          className="rounded border-app-border text-app-accent focus:ring-app-accent w-3 h-3"
                                        />
                                        <span className="text-[10px] font-medium text-app-text-muted">Autostart at boot</span>
                                      </label>
                                    </div>
                                    <div className="flex gap-2 justify-end">
                                      <button onClick={() => setEditingService(null)} className="px-3 py-1 text-[10px] font-semibold text-app-text-muted hover:text-app-text rounded-lg hover:bg-app-border transition-colors">Cancel</button>
                                      <button onClick={() => handleSaveService(s.id)} className="px-3 py-1 text-[10px] font-semibold text-white bg-app-accent hover:bg-app-accent-hover rounded-lg transition-colors">Save</button>
                                    </div>
                                  </div>
                                ) : (
                                  /* View mode */
                                  <div>
                                    <div className="flex items-center justify-between p-2.5">
                                      <div className="flex items-center gap-3 min-w-0">
                                        <div className={`px-2 py-0.5 rounded text-[9px] font-semibold uppercase shrink-0 ${statusStyle(s.status)}`}>{s.status}</div>
                                        <div className="min-w-0">
                                          <span className="text-xs font-semibold text-app-text">{s.name}</span>
                                          {/* Kind/surface chip — container-vs-process (and which surface)
                                              visible without opening the edit form. */}
                                          <span className="text-[8px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-app-border/60 text-app-text-muted ml-2 align-middle" data-testid="service-surface-badge">
                                            {s.type === 'container' ? 'container' : (s.surface || 'process')}
                                          </span>
                                          {s.port ? <span className="text-[10px] text-app-text-muted ml-2">:{s.port}</span> : null}
                                          {s.pid && <span className="text-[9px] text-app-text-muted/50 ml-2">PID {s.pid}</span>}
                                          {s.status === 'running' && formatUptime(s.startedAt) && (
                                            <span className="text-[9px] text-app-text-muted/50 ml-2" data-testid="service-uptime">up {formatUptime(s.startedAt)}</span>
                                          )}
                                          {s.depends_on && s.depends_on.length > 0 && (
                                            <span className="text-[9px] text-app-text-muted/60 ml-2">
                                              depends on {s.depends_on.map(d => services.find(x => x.id === d)?.name || d).join(', ')}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex gap-1 items-center">
                                        {/* Logs toggle */}
                                        <button onClick={() => handleToggleLogs(s.id)} className={`p-1 transition-all rounded ${expandedLogs === s.id ? 'text-app-accent' : 'text-app-text-muted hover:text-app-accent opacity-0 group-hover:opacity-100'}`} title="View logs">
                                          <Terminal className="w-3 h-3" />
                                        </button>
                                        {s.status === 'running' && s.port && onOpenPreview && (
                                          <button onClick={() => { onOpenPreview(s); onClose() }} className="p-1 text-app-text-muted hover:text-app-accent opacity-0 group-hover:opacity-100 transition-all" title="Preview in panel">
                                            <Eye className="w-3 h-3" />
                                          </button>
                                        )}
                                        {s.status === 'running' && s.port && (
                                          <a href={`http://localhost:${s.port}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="p-1 text-app-text-muted hover:text-app-accent opacity-0 group-hover:opacity-100 transition-all" title="Open in browser">
                                            <ExternalLink className="w-3 h-3" />
                                          </a>
                                        )}
                                        <button onClick={() => handleEditService(s)} className="p-1 text-app-text-muted hover:text-app-accent opacity-0 group-hover:opacity-100 transition-all" title="Edit">
                                          <Pencil className="w-3 h-3" />
                                        </button>
                                        <button onClick={() => handleDeleteService(s.id)} className="p-1 text-app-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all" title="Remove">
                                          <Trash2 className="w-3 h-3" />
                                        </button>
                                        {s.status === 'running' && (
                                          <button onClick={() => handleRestartService(s.id)} className="p-1.5 rounded-lg text-amber-400 border border-amber-900/20 bg-amber-900/5 hover:bg-amber-900/10 transition-all" title="Restart">
                                            <RotateCcw className="w-3 h-3" />
                                          </button>
                                        )}
                                        <button
                                          onClick={() => s.status === 'running' ? handleStopService(s.id, s.name) : handleServiceAction(s.id, 'start')}
                                          title={s.status === 'running' ? 'Stop' : (s.surface === 'job' ? 'Run' : 'Start')}
                                          className={`p-1.5 rounded-lg transition-all border ${s.status === 'running' ? 'text-red-400 border-red-900/20 bg-red-900/5 hover:bg-red-900/10' : 'text-green-400 border-green-900/20 bg-green-900/5 hover:bg-green-900/10'}`}
                                        >
                                          {s.status === 'running' ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                                        </button>
                                      </div>
                                    </div>
                                    {/* Expandable log panel */}
                                    {expandedLogs === s.id && (
                                      <div className="border-t border-app-border">
                                        <div className="flex items-center justify-between px-3 py-1.5 bg-app-card/30">
                                          <span className="text-[9px] uppercase font-semibold text-app-text-muted tracking-wider">Output Log</span>
                                          <button onClick={() => handleClearServiceLogs(s.id)} className="text-[9px] font-semibold text-app-text-muted hover:text-red-400 transition-colors">Clear</button>
                                        </div>
                                        <div className="h-[150px] overflow-y-auto custom-scrollbar bg-[#1a1a2e] p-2">
                                          {serviceLogs.length === 0 ? (
                                            <div className="flex items-center justify-center h-full text-app-text-muted/30 text-[10px] italic">No output captured</div>
                                          ) : (
                                            <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-words leading-relaxed">{serviceLogs.join('\n')}</pre>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          )}
                        </div>
                      ))}
                      {services.length === 0 && <div className="text-center text-app-text-muted/40 text-xs italic py-8">No services registered</div>}
                    </div>
                  </div>
                )}

                {/* PROFILE */}
                {activeTab === 'profile' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-3">Account</h3>
                      <div className="bg-app-bg border border-app-border rounded-xl p-4 flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-app-accent/15 flex items-center justify-center text-lg font-semibold text-app-accent">
                          {currentUser?.username?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-app-text">{currentUser?.username}</p>
                          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${currentUser?.role === 'admin' ? 'bg-amber-500/15 text-amber-400' : 'bg-app-border text-app-text-muted'}`}>{currentUser?.role || 'member'}</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Change Password</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Enter your current password and choose a new one.</p>
                      <form autoComplete="off" onSubmit={(e) => { e.preventDefault(); handleChangePassword() }} className="space-y-3 max-w-sm">
                        <input type="password" autoComplete="current-password" placeholder="Current password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent" />
                        <input type="password" autoComplete="new-password" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent" />
                        <input type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent" />
                        <div className="flex items-center gap-3">
                          <button type="submit" className="bg-app-accent hover:bg-app-accent-hover text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all shadow-md flex items-center gap-1.5">
                            <Key className="w-3.5 h-3.5" /> Change Password
                          </button>
                          {passwordMessage && <span className={`text-xs font-medium ${passwordMessage.includes('changed') ? 'text-green-400' : 'text-red-400'}`}>{passwordMessage}</span>}
                        </div>
                      </form>
                    </div>
                  </div>
                )}

                {/* ADMIN */}
                {activeTab === 'admin' && isAdmin && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">AI Features</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Control AI access system-wide.</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between bg-app-bg border border-app-border p-4 rounded-xl">
                          <div className="flex items-center gap-2.5">
                            <Bot className="w-4 h-4 text-app-text-muted" />
                            <span className="text-sm font-medium text-app-text">Enable AI Agents</span>
                          </div>
                          <button onClick={() => setAgentsEnabled(prev => !prev)} className={`relative w-10 h-5 rounded-full transition-colors ${agentsEnabled ? 'bg-app-accent' : 'bg-app-border'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${agentsEnabled ? 'left-5.5' : 'left-0.5'}`} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between bg-app-bg border border-app-border p-4 rounded-xl">
                          <div className="flex items-center gap-2.5">
                            <Sparkles className="w-4 h-4 text-app-text-muted" />
                            <span className="text-sm font-medium text-app-text">Enable AI Chat</span>
                          </div>
                          <button onClick={() => setAiChatEnabled(prev => !prev)} className={`relative w-10 h-5 rounded-full transition-colors ${aiChatEnabled ? 'bg-app-accent' : 'bg-app-border'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${aiChatEnabled ? 'left-5.5' : 'left-0.5'}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">User Permissions</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Manage roles and agent access.</p>
                      <div className="bg-app-bg border border-app-border rounded-xl overflow-hidden">
                        <div className="divide-y divide-app-border/50">
                          {users.map(u => (
                            <div key={u.username} className="flex items-center justify-between px-4 py-3 group">
                              <div className="flex items-center gap-3">
                                <div className="w-7 h-7 rounded-full bg-app-accent/15 flex items-center justify-center text-[11px] font-semibold text-app-accent">{u.username.charAt(0).toUpperCase()}</div>
                                <div>
                                  <span className="text-sm font-medium text-app-text">{u.username}</span>
                                  <span className={`ml-2 text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${u.role === 'admin' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20' : 'bg-app-border text-app-text-muted'}`}>{u.role}</span>
                                  {u.last_login && <span className="ml-2 text-[9px] text-app-text-muted">Last: {new Date(u.last_login).toLocaleDateString()}</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-app-text-muted">Agents</span>
                                  <button onClick={() => handleToggleUserAgent(u.username, u.can_run_agents)} className={`relative w-8 h-4 rounded-full transition-colors ${u.can_run_agents ? 'bg-app-accent' : 'bg-app-border'}`}>
                                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${u.can_run_agents ? 'left-4.5' : 'left-0.5'}`} />
                                  </button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10px] text-app-text-muted">AI Chat</span>
                                  <button onClick={() => handleToggleUserAiChat(u.username, u.can_use_ai_chat)} className={`relative w-8 h-4 rounded-full transition-colors ${u.can_use_ai_chat !== false ? 'bg-app-accent' : 'bg-app-border'}`}>
                                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${u.can_use_ai_chat !== false ? 'left-4.5' : 'left-0.5'}`} />
                                  </button>
                                </div>
                                {u.username !== currentUser?.username && (
                                  <>
                                    <button onClick={() => handleToggleUserRole(u.username, u.role)} className="text-[10px] font-semibold text-app-text-muted hover:text-app-accent px-2 py-1 rounded hover:bg-app-accent/10 transition-colors">
                                      {u.role === 'admin' ? 'Demote' : 'Make Admin'}
                                    </button>
                                    <button onClick={() => handleDeleteUser(u.username)} className="p-1 text-app-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all" title="Delete user">
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Agent Tokens — for Claude Code MCP integration */}
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Agent Tokens</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Long-lived tokens for Claude Code's MCP server. Tokens are shown once; if lost, revoke and generate a new one.</p>

                      <div className="flex gap-2 mb-3">
                        <input
                          type="text"
                          placeholder="Token name (e.g. my-laptop)"
                          value={newTokenName}
                          onChange={e => { setNewTokenName(e.target.value); setNewTokenError('') }}
                          onKeyDown={e => { if (e.key === 'Enter') handleGenerateAgentToken() }}
                          className="flex-1 bg-app-bg border border-app-border px-3 py-2 rounded-lg text-sm text-app-text outline-none focus:border-app-accent"
                        />
                        <button onClick={handleGenerateAgentToken} className="flex items-center gap-1.5 bg-app-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-opacity">
                          <Key className="w-3.5 h-3.5" />
                          Generate
                        </button>
                      </div>
                      {newTokenError && <div className="text-[11px] text-red-400 mb-3">{newTokenError}</div>}

                      {agentTokens.length > 0 && (
                        <div className="bg-app-bg border border-app-border rounded-xl overflow-hidden">
                          <div className="divide-y divide-app-border/50">
                            {agentTokens.map(t => (
                              <div key={t.jti} className="flex items-center justify-between px-4 py-3">
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-app-text">{t.name}</span>
                                    {t.revoked && <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">Revoked</span>}
                                  </div>
                                  <span className="text-[10px] text-app-text-muted font-mono">{t.jti}</span>
                                  <span className="text-[10px] text-app-text-muted">Issued by {t.issued_by} · {t.issued_at ? new Date(t.issued_at).toLocaleString() : '?'}</span>
                                </div>
                                {!t.revoked && (
                                  <button onClick={() => handleRevokeAgentToken(t.jti)} className="text-[10px] font-semibold text-app-text-muted hover:text-red-400 px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
                                    Revoke
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* DATA */}
                {activeTab === 'data' && isAdmin && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Export</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Download all task data as JSON.</p>
                      <button onClick={handleExport} className="flex items-center gap-2 bg-app-bg border border-app-border hover:border-app-text-muted px-4 py-2.5 rounded-lg text-xs font-semibold text-app-text transition-colors">
                        <Download className="w-4 h-4" /> Export Tasks (JSON)
                      </button>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-1">Cleanup</h3>
                      <p className="text-[11px] text-app-text-muted mb-3">Free up storage by removing old data.</p>
                      <div className="space-y-2">
                        <button onClick={handleClearChat} className="flex items-center gap-2 bg-app-bg border border-app-border hover:border-red-400/30 px-4 py-2.5 rounded-lg text-xs font-semibold text-app-text-muted hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" /> Clear Chat History
                        </button>
                        <button onClick={handlePurgeHistory} className="flex items-center gap-2 bg-app-bg border border-app-border hover:border-red-400/30 px-4 py-2.5 rounded-lg text-xs font-semibold text-app-text-muted hover:text-red-400 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" /> Purge History Backups (30+ days)
                        </button>
                      </div>
                    </div>
                    {statusInfo && (
                      <div>
                        <h3 className="text-sm font-semibold text-app-text mb-3">Storage Usage</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Tasks', value: formatBytes(statusInfo.storage.tasks) },
                            { label: 'History Backups', value: formatBytes(statusInfo.storage.history) },
                            { label: 'Chat', value: formatBytes(statusInfo.storage.chat) },
                            { label: 'Users', value: formatBytes(statusInfo.storage.users) },
                          ].map(item => (
                            <div key={item.label} className="bg-app-bg border border-app-border rounded-lg px-3 py-2">
                              <p className="text-[10px] uppercase font-semibold text-app-text-muted">{item.label}</p>
                              <p className="text-sm font-semibold text-app-text">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ABOUT */}
                {activeTab === 'about' && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-sm font-semibold text-app-text mb-3">Atrium</h3>
                      <p className="text-[11px] text-app-text-muted leading-relaxed">AI and Human Collaborative Kanban — a task board designed for teams working alongside AI agents.</p>
                    </div>
                    {statusInfo && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Version', value: statusInfo.version },
                            { label: 'Node.js', value: statusInfo.node_version },
                            { label: 'Uptime', value: statusInfo.uptime },
                            { label: 'Tasks', value: statusInfo.counts.tasks },
                            { label: 'Projects', value: statusInfo.counts.projects },
                            { label: 'Users', value: statusInfo.counts.users },
                            { label: 'History Backups', value: statusInfo.counts.history_backups },
                          ].map(item => (
                            <div key={item.label} className="bg-app-bg border border-app-border rounded-lg px-3 py-2">
                              <p className="text-[10px] uppercase font-semibold text-app-text-muted">{item.label}</p>
                              <p className="text-sm font-semibold text-app-text">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
    )
  }

  // --- Desktop: modal with ModalOverlay ---
  return (
    <ModalOverlay onClose={handleClose} titleId="settings-modal-title">
      {/* Generated-token display — nested modal, shown once */}
      {generatedToken && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setGeneratedToken(null)}>
          <div className="bg-app-card border border-app-accent/30 rounded-xl p-6 max-w-xl w-full" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-app-text mb-1">Agent token — shown once</h3>
            <p className="text-[11px] text-app-text-muted mb-4">Copy this now. Atrium does not store the token itself, only its metadata. If lost, revoke and generate a new one.</p>
            <div className="bg-app-bg border border-app-border rounded-lg p-3 mb-3">
              <div className="text-[10px] uppercase font-semibold text-app-text-muted mb-1">Token</div>
              <div className="font-mono text-[11px] text-app-text break-all select-all">{generatedToken.token}</div>
            </div>
            <div className="bg-app-bg border border-app-border rounded-lg p-3 mb-4">
              <div className="text-[10px] uppercase font-semibold text-app-text-muted mb-1">Install command (run once on your PC)</div>
              <div className="font-mono text-[11px] text-app-text break-all select-all">{generatedToken.installCmd}</div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => copyTokenToClipboard(generatedToken.token)} className="flex items-center gap-1.5 bg-app-bg border border-app-border hover:border-app-text-muted px-3 py-1.5 rounded-lg text-xs font-semibold text-app-text transition-colors">
                {tokenCopied ? <Check className="w-3 h-3" /> : <Key className="w-3 h-3" />}
                {tokenCopied ? 'Copied' : 'Copy token'}
              </button>
              <button onClick={() => copyTokenToClipboard(generatedToken.installCmd)} className="flex items-center gap-1.5 bg-app-bg border border-app-border hover:border-app-text-muted px-3 py-1.5 rounded-lg text-xs font-semibold text-app-text transition-colors">
                <Terminal className="w-3 h-3" />
                Copy command
              </button>
              <button onClick={() => setGeneratedToken(null)} className="bg-app-accent hover:opacity-90 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-opacity">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden flex flex-col" style={{ width: '960px', height: '620px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-popover)' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="shrink-0 flex justify-between items-center" style={{ padding: '12px 20px', borderBottom: 'var(--border-hairline)', background: 'var(--bg-card)' }}>
          <h2 id="settings-modal-title" style={{ fontSize: 'var(--text-title3)', fontWeight: 'var(--font-semibold)', color: 'var(--text-app)' }}>Settings</h2>
          <div className="flex items-center gap-2">
            {message && <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: message.includes('saved') || message.includes('Saved') || message.includes('changed') || message.includes('cleared') || message.includes('Deleted') ? 'var(--apple-green)' : 'var(--apple-red)' }}>{message}</span>}
            <button onClick={handleClose} className="apple-press" style={{ padding: '8px', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
        </header>

        <div className="flex flex-row flex-1 overflow-hidden">
          {renderTabs('vertical')}
          <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ padding: 'var(--space-6)' }}>
            {renderContent()}
          </div>
        </div>

        {/* Footer */}
        <footer className="shrink-0 flex justify-between items-center" style={{ padding: '10px 20px', borderTop: '0.5px solid var(--separator)' }}>
          <div>
            {hasUnsavedChanges && (
              <span className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--apple-orange)' }}>
                <span className="animate-gentle-pulse" style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--apple-orange)' }} /> Unsaved changes
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={handleClose} className="apple-press" style={{ padding: '8px 16px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>Close</button>
            <button onClick={handleSave} disabled={saving || loading || !hasUnsavedChanges}
              className="apple-press text-white flex items-center gap-2" style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', background: 'var(--accent-app)', border: 'none', cursor: 'pointer', opacity: (saving || loading || !hasUnsavedChanges) ? 0.3 : 1 }}>
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </footer>
      </div>
    </ModalOverlay>
  )
}
