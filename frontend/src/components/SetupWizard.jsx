// First-run setup (feat-first-run-setup-001).
//
// A fresh container silently depends on a working directory, a GitHub token,
// and a Claude Code login. This walks through all three and — importantly —
// VERIFIES each one rather than just describing it. Every step reflects real
// server-side state, so a green tick means the thing actually works.
//
// Deliberately a prompt, not a gate. Someone who only wants to read the board
// should not have to configure anything first, so Skip is always available.

import { useState, useEffect, useCallback } from 'react'
import { Check, Circle, AlertTriangle, Terminal, GitBranch, FolderOpen, X, RefreshCw, ExternalLink, Bot, Copy } from 'lucide-react'
import { API_URL, apiFetch } from '../config'
import { useAuth } from '../contexts/AuthContext'
import ModalOverlay from './ModalOverlay'

const ICONS = { workspace: FolderOpen, agent: Bot, github: GitBranch, terminal: Terminal }

export default function SetupWizard({ onClose, onOpenTerminal }) {
  const [status, setStatus] = useState(null)
  const [activeId, setActiveId] = useState('workspace')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Local inputs for the two steps that take one
  const [workingDirectory, setWorkingDirectory] = useState('')
  const [githubToken, setGithubToken] = useState('')

  // Agent step (feat-setup-wizard-v2-001): admins mint a token here, then run
  // the setup command; the step goes green when the agent authenticates.
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [agentToken, setAgentToken] = useState(null)
  const [instanceUrl, setInstanceUrl] = useState('')
  const [copied, setCopied] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/setup/status`)
      if (!res.ok) return null
      const data = await res.json()
      setStatus(data)
      return data
    } catch { return null }
  }, [])

  useEffect(() => {
    fetchStatus().then((data) => {
      if (!data) return
      // Open on the first thing that still needs doing rather than always
      // starting at step one — re-opening the wizard should not re-walk it.
      const next = data.steps.find((s) => !s.complete)
      if (next) setActiveId(next.id)
      const ws = data.steps.find((s) => s.id === 'workspace')
      if (ws?.complete) setWorkingDirectory(ws.detail || '')
    })
  }, [fetchStatus])

  // The Claude sign-in AND the agent connection both happen outside this
  // component (in a terminal / on another machine), so the only way to notice
  // them is to keep asking. Polling stops as soon as the active step goes green.
  useEffect(() => {
    if (activeId !== 'terminal' && activeId !== 'agent') return
    const step = status?.steps?.find((s) => s.id === activeId)
    if (step?.complete) return
    const id = setInterval(fetchStatus, 3000)
    return () => clearInterval(id)
  }, [activeId, status, fetchStatus])

  // The MCP setup command needs the URL the agent should point at. /api/instance
  // reports the URL this client actually reached, so it's correct behind a proxy
  // or a non-default port (feat-mcp-bootstrap-001).
  useEffect(() => {
    apiFetch(`${API_URL}/instance`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.url) setInstanceUrl(d.url) })
      .catch(() => {})
  }, [])

  const steps = status?.steps || []
  const step = steps.find((s) => s.id === activeId) || steps[0]
  const doneCount = steps.filter((s) => s.complete).length
  const allComplete = steps.length > 0 && doneCount === steps.length

  const saveWorkingDirectory = async () => {
    setBusy(true); setMessage('')
    try {
      const res = await apiFetch(`${API_URL}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDirectory: workingDirectory.trim() }),
      })
      if (!res.ok) { setMessage('Could not save'); return }
      const data = await fetchStatus()
      const ws = data?.steps?.find((s) => s.id === 'workspace')
      setMessage(ws?.complete ? '' : (ws?.problem || 'Saved, but that path was not found'))
    } catch { setMessage('Could not reach the server') } finally { setBusy(false) }
  }

  const saveGithubToken = async () => {
    setBusy(true); setMessage('')
    try {
      const res = await apiFetch(`${API_URL}/github/auth`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: githubToken.trim() }),
      })
      const data = await res.json()
      if (!res.ok) { setMessage(data.error || 'Could not connect'); return }
      setGithubToken('')
      await fetchStatus()
    } catch { setMessage('Could not reach the server') } finally { setBusy(false) }
  }

  const mintAgentToken = async () => {
    setBusy(true); setMessage('')
    try {
      const res = await apiFetch(`${API_URL}/agent-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'setup-wizard' }),
      })
      const data = await res.json()
      if (!res.ok) { setMessage(data.error || 'Could not mint a token'); return }
      setAgentToken(data.token) // shown ONCE — the server never returns it again
    } catch { setMessage('Could not reach the server') } finally { setBusy(false) }
  }

  const agentUrl = instanceUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')
  const agentCommand = agentToken
    ? `node backend/cli/atrium-mcp-setup.js --token ${agentToken} --url ${agentUrl}`
    : ''

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(agentCommand)
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    } catch { setMessage('Copy failed — select and copy manually') }
  }

  const finish = async () => {
    try { await apiFetch(`${API_URL}/setup/complete`, { method: 'POST' }) } catch { /* closing anyway */ }
    onClose()
  }

  const goNext = () => {
    const i = steps.findIndex((s) => s.id === activeId)
    if (i >= 0 && i < steps.length - 1) { setActiveId(steps[i + 1].id); setMessage('') }
    else finish()
  }

  if (!status) return null

  return (
    <ModalOverlay onClose={onClose}>
      <div
        className="bg-app-surface border border-app-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-app-border">
          <div>
            <h2 className="text-base font-semibold text-app-text">Set up Atrium</h2>
            <p className="text-[11px] text-app-text-muted mt-0.5">
              {doneCount} of {steps.length} done — you can skip and finish later from Settings.
            </p>
          </div>
          <button onClick={onClose} className="text-app-text-muted hover:text-app-text transition-colors" title="Close">
            <X size={18} />
          </button>
        </div>

        <div className="flex" style={{ minHeight: '320px' }}>
          {/* Step rail */}
          <nav className="w-56 shrink-0 border-r border-app-border p-3 space-y-1">
            {steps.map((s) => {
              const Icon = ICONS[s.id] || Circle
              const active = s.id === activeId
              return (
                <button
                  key={s.id}
                  onClick={() => { setActiveId(s.id); setMessage('') }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    active ? 'bg-app-bg text-app-text' : 'text-app-text-muted hover:text-app-text'
                  }`}
                >
                  <span className="shrink-0">
                    {s.complete
                      ? <Check size={15} className="text-green-500" />
                      : s.problem
                        ? <AlertTriangle size={15} className="text-amber-500" />
                        : <Icon size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium truncate">{s.title}</span>
                    {s.optional && !s.complete && (
                      <span className="block text-[10px] text-app-text-muted">Optional</span>
                    )}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Step body */}
          <div className="flex-1 p-6 min-w-0">
            {allComplete ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <div className="w-11 h-11 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-3">
                  <Check size={20} className="text-green-500" />
                </div>
                <h3 className="text-sm font-semibold text-app-text mb-1">You&apos;re all set</h3>
                <p className="text-xs text-app-text-muted max-w-xs">
                  Create your first project from the project switcher (top-left), then add work with New Task.
                </p>
                <button onClick={finish}
                  className="mt-4 px-4 py-2 text-sm rounded-lg bg-app-accent text-white font-medium hover:opacity-90 transition-opacity">
                  Get started
                </button>
              </div>
            ) : step && (
              <>
                <h3 className="text-sm font-semibold text-app-text mb-1">{step.title}</h3>
                <p className="text-[11px] text-app-text-muted mb-4">{step.description}</p>

                {step.complete && (
                  <div className="flex items-center gap-2 text-xs text-green-500 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2.5 mb-4">
                    <Check size={14} className="shrink-0" />
                    <span className="truncate">{step.detail || 'Done'}</span>
                  </div>
                )}

                {step.problem && !step.complete && (
                  <div className="flex items-start gap-2 text-xs text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2.5 mb-4">
                    <AlertTriangle size={14} className="shrink-0 mt-px" />
                    <span>{step.problem}</span>
                  </div>
                )}

                {/* Workspace */}
                {step.id === 'workspace' && !step.complete && (
                  <div className="space-y-2">
                    <input
                      type="text" value={workingDirectory}
                      onChange={(e) => setWorkingDirectory(e.target.value)}
                      placeholder="/workspace"
                      className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
                    />
                    <p className="text-[10px] text-app-text-muted">
                      Running in Docker? Use <code className="text-app-text">/workspace</code> — that is where your projects are mounted.
                    </p>
                    <button onClick={saveWorkingDirectory} disabled={busy || !workingDirectory.trim()}
                      className="px-4 py-2 text-sm rounded-lg bg-app-accent text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
                      {busy ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                )}

                {/* Agent — mint a token here, run the command elsewhere, then
                    watch for the connection. Verified, not assumed. */}
                {step.id === 'agent' && !step.complete && (
                  <div className="space-y-3">
                    {!isAdmin ? (
                      <p className="text-xs text-app-text-muted">
                        Ask an admin to mint an agent token (Settings → Agent Tokens), then run the
                        <code className="text-app-text bg-app-bg px-1.5 py-0.5 rounded mx-1">atrium-mcp-setup</code>
                        command on the machine where your agent runs.
                      </p>
                    ) : !agentToken ? (
                      <>
                        <p className="text-xs text-app-text-muted">
                          Mint a token, then run the printed command where your agent lives — Claude Code, a
                          script, anything that speaks MCP or the REST API.
                        </p>
                        <button onClick={mintAgentToken} disabled={busy}
                          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-app-accent text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
                          <Bot size={14} /> {busy ? 'Minting…' : 'Mint an agent token'}
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-app-text-muted">Shown once — copy it now, then run it where your agent lives:</p>
                        <div className="relative">
                          <pre className="text-[11px] text-app-text bg-app-bg border border-app-border rounded-lg p-3 pr-10 overflow-x-auto whitespace-pre-wrap break-all">{agentCommand}</pre>
                          <button onClick={copyCommand} title="Copy command"
                            className="absolute top-2 right-2 text-app-text-muted hover:text-app-text transition-colors">
                            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                          </button>
                        </div>
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-app-text-muted">
                          <RefreshCw size={11} className="animate-spin" /> Watching for the agent to connect…
                        </span>
                      </>
                    )}
                  </div>
                )}

                {/* GitHub */}
                {step.id === 'github' && !step.complete && (
                  <div className="space-y-2">
                    <input
                      type="password" value={githubToken} autoComplete="off" spellCheck="false"
                      onChange={(e) => setGithubToken(e.target.value)} placeholder="ghp_..."
                      className="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2.5 text-sm text-app-text focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent"
                    />
                    <div className="flex items-center gap-3">
                      <button onClick={saveGithubToken} disabled={busy || !githubToken.trim()}
                        className="px-4 py-2 text-sm rounded-lg bg-app-accent text-white font-medium disabled:opacity-40 hover:opacity-90 transition-opacity">
                        {busy ? 'Checking…' : 'Connect'}
                      </button>
                      <a href="https://github.com/settings/tokens/new?scopes=repo&description=Atrium"
                        target="_blank" rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-app-text-muted hover:text-app-accent transition-colors">
                        Create a token <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                )}

                {/* Terminal — this one cannot be completed from the UI, so it
                    hands off to the shell and watches for the result. */}
                {step.id === 'terminal' && !step.complete && (
                  <div className="space-y-3">
                    <ol className="text-xs text-app-text-muted space-y-1.5 list-decimal list-inside">
                      <li>Open the terminal</li>
                      <li>Run <code className="text-app-text bg-app-bg px-1.5 py-0.5 rounded">claude</code></li>
                      <li>Follow the login prompts</li>
                    </ol>
                    <div className="flex items-center gap-3">
                      <button onClick={() => onOpenTerminal?.()}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-app-accent text-white font-medium hover:opacity-90 transition-opacity">
                        <Terminal size={14} /> Open terminal
                      </button>
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-app-text-muted">
                        <RefreshCw size={11} className="animate-spin" /> Watching for sign-in…
                      </span>
                    </div>
                    <p className="text-[10px] text-app-text-muted">
                      This is detected automatically — leave the wizard open and it will tick itself.
                    </p>
                  </div>
                )}

                {message && <p className="text-[11px] text-amber-500 mt-3">{message}</p>}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-app-border">
          <button onClick={finish} className="text-[11px] text-app-text-muted hover:text-app-text transition-colors">
            Skip for now
          </button>
          <button onClick={goNext}
            className="px-4 py-2 text-sm rounded-lg border border-app-border text-app-text hover:border-app-text-muted transition-colors">
            {steps.findIndex((s) => s.id === activeId) === steps.length - 1 ? 'Finish' : 'Next'}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}
