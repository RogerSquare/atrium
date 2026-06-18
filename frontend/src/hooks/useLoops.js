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
    return () => socket.off('loop_updated', onUpdated)
  }, [socket])

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

  return { loops, loading, error, refresh, createLoop, updateLoop, deleteLoop, runLoop }
}
