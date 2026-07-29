import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { API_URL, apiFetch } from '../config'

// Live PTY terminal for a loop agent run (feat-loopsv2-terminal-001).
// Replays the persisted log, then tails live `loopterm:*` socket events for
// the given runId. Read-only (the agent run is non-interactive).
export default function LoopTerminal({ loopId, runId, socketRef }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)

  // Create the xterm instance once.
  useEffect(() => {
    if (!hostRef.current) return undefined
    const term = new Terminal({
      convertEol: true,
      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      fontSize: 12,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 8000,
      theme: { background: '#1c1c1e' },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    try { fit.fit() } catch { /* not yet measurable */ }
    termRef.current = term
    const onResize = () => { try { fit.fit() } catch { /* ignore */ } }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); term.dispose(); termRef.current = null }
  }, [])

  // Load the log + subscribe to live output whenever the runId changes.
  useEffect(() => {
    const term = termRef.current
    if (!term) return undefined
    term.reset()
    if (!runId) { term.write('[2mNo run selected. Click "Run in terminal" to start one.[0m\r\n'); return undefined }

    let cancelled = false
    apiFetch(`${API_URL}/loops/${loopId}/terminal/runs/${runId}/log`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return
        if (d.log) term.write(d.log)
        if (!d.running) term.write('\r\n[2m[run finished][0m\r\n')
      })
      .catch(() => {})

    const socket = socketRef?.current
    const onOut = (e) => { if (e && e.runId === runId && termRef.current) termRef.current.write(e.data) }
    const onExit = (e) => { if (e && e.runId === runId && termRef.current) termRef.current.write(`\r\n[2m[exited ${e.code}][0m\r\n`) }
    if (socket) { socket.on('loopterm:output', onOut); socket.on('loopterm:exit', onExit) }
    return () => {
      cancelled = true
      if (socket) { socket.off('loopterm:output', onOut); socket.off('loopterm:exit', onExit) }
    }
  }, [runId, loopId, socketRef])

  return <div data-testid="loop-terminal" ref={hostRef} style={{ width: '100%', height: '340px', background: '#1c1c1e', borderRadius: 'var(--radius-sm)', padding: '6px', overflow: 'hidden' }} />
}
