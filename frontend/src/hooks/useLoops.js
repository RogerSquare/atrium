import { useState, useEffect, useCallback } from 'react'
import { API_URL, apiFetch } from '../config'

/**
 * Data hook for GitHub-watcher loops (feat-loops-ui-global-001).
 * Fetches /api/loops, exposes CRUD + run-now, and live-updates from the
 * `loop_updated` socket event the engine emits each tick.
 */
export default function useLoops(socketRef) {
  const [loops, setLoops] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [runsByLoop, setRunsByLoop] = useState({}) // loopId -> run[] (AI summary runs)

  const upsertRun = useCallback((run) => {
    if (!run || !run.loop_id) return
    setRunsByLoop((prev) => {
      const list = prev[run.loop_id] || []
      const idx = list.findIndex((r) => r.id === run.id)
      const next = idx === -1 ? [run, ...list] : list.map((r) => (r.id === run.id ? run : r))
      return { ...prev, [run.loop_id]: next }
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_URL}/loops`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setLoops(await res.json())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // Live updates: the engine emits `loop_updated` on every tick + status flip.
  const socket = socketRef?.current
  useEffect(() => {
    if (!socket) return
    const onUpdated = (loop) => {
      if (!loop || !loop.id) return
      setLoops((prev) => {
        const idx = prev.findIndex((l) => l.id === loop.id)
        if (idx === -1) return [...prev, loop]
        const next = prev.slice()
        next[idx] = loop
        return next
      })
    }
    socket.on('loop_updated', onUpdated)
    // AI-summary runs stream in live (running -> done/error) as the agent works.
    const onRun = (run) => upsertRun(run)
    socket.on('loop_run_updated', onRun)
    return () => { socket.off('loop_updated', onUpdated); socket.off('loop_run_updated', onRun) }
  }, [socket, upsertRun])

  const mutate = useCallback(async (url, method, body) => {
    const res = await apiFetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`)
      err.details = data.details
      throw err
    }
    return data
  }, [])

  const createLoop = useCallback(async (body) => {
    const { loop } = await mutate(`${API_URL}/loops`, 'POST', body)
    setLoops((prev) => [...prev, loop])
    return loop
  }, [mutate])

  const updateLoop = useCallback(async (id, body) => {
    const { loop } = await mutate(`${API_URL}/loops/${id}`, 'PUT', body)
    setLoops((prev) => prev.map((l) => (l.id === id ? loop : l)))
    return loop
  }, [mutate])

  const deleteLoop = useCallback(async (id) => {
    await mutate(`${API_URL}/loops/${id}`, 'DELETE')
    setLoops((prev) => prev.filter((l) => l.id !== id))
  }, [mutate])

  const runLoop = useCallback(async (id) => {
    const { loop } = await mutate(`${API_URL}/loops/${id}/run`, 'POST')
    if (loop) setLoops((prev) => prev.map((l) => (l.id === id ? loop : l)))
    return loop
  }, [mutate])

  // AI-summary run records (full context + output) for review.
  const fetchRuns = useCallback(async (id) => {
    try {
      const res = await apiFetch(`${API_URL}/loops/${id}/runs`)
      if (!res.ok) return
      const data = await res.json()
      setRunsByLoop((prev) => ({ ...prev, [id]: data }))
    } catch { /* leave as-is */ }
  }, [])

  const summarize = useCallback(async (id, body) => {
    const { run } = await mutate(`${API_URL}/loops/${id}/summarize`, 'POST', body || {})
    if (run) upsertRun(run)
    return run
  }, [mutate, upsertRun])

  // Instructions (generated default + per-loop override + effective) for review/edit.
  const fetchInstructions = useCallback(async (id) => {
    const res = await apiFetch(`${API_URL}/loops/${id}/instructions`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }, [])

  // Reusable instruction-template library.
  const [templates, setTemplates] = useState([])
  const fetchTemplates = useCallback(async () => {
    try { const res = await apiFetch(`${API_URL}/loop-templates`); if (res.ok) setTemplates(await res.json()) } catch { /* ignore */ }
  }, [])
  const createTemplate = useCallback(async (name, body) => {
    const { template } = await mutate(`${API_URL}/loop-templates`, 'POST', { name, body })
    setTemplates((prev) => [template, ...prev])
    return template
  }, [mutate])
  const deleteTemplate = useCallback(async (id) => {
    await mutate(`${API_URL}/loop-templates/${id}`, 'DELETE')
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }, [mutate])

  // Live PTY terminal runs (feat-loopsv2-terminal-001).
  const startTerminalRun = useCallback(async (id, body) => {
    const data = await mutate(`${API_URL}/loops/${id}/terminal/start`, 'POST', body || {})
    return data.run_id
  }, [mutate])
  const fetchTerminalRuns = useCallback(async (id) => {
    const res = await apiFetch(`${API_URL}/loops/${id}/terminal/runs`)
    return res.ok ? res.json() : []
  }, [])

  return {
    loops, loading, error, refresh, createLoop, updateLoop, deleteLoop, runLoop,
    runsByLoop, fetchRuns, summarize,
    fetchInstructions, templates, fetchTemplates, createTemplate, deleteTemplate,
    startTerminalRun, fetchTerminalRuns,
  }
}
