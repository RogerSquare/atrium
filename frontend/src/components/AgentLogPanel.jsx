import { useState, useEffect, useRef } from 'react'
import { Square, Loader2, Play, Trash2, AlertTriangle, Lock } from 'lucide-react'

export default function AgentLogPanel({ task, socket, agentRunning, onStartAgent, onStopAgent, currentUser, agentsEnabled = true, canRunAgents = true }) {
  const [logs, setLogs] = useState([])
  const [completed, setCompleted] = useState(false)
  const [exitCode, setExitCode] = useState(null)
  const [confirmStart, setConfirmStart] = useState(false)
  const logsEndRef = useRef(null)

  useEffect(() => {
    if (!socket) return
    const handleOutput = (data) => { if (data.taskId === task.id) { setLogs(prev => [...prev, data.data]); setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50) } }
    const handleComplete = (data) => { if (data.taskId === task.id) { setCompleted(true); setExitCode(data.exitCode) } }
    const handleError = (data) => { if (data.taskId === task.id) { setLogs(prev => [...prev, `\nError: ${data.error}\n`]); setCompleted(true) } }
    socket.on('agent_output', handleOutput)
    socket.on('agent_complete', handleComplete)
    socket.on('agent_error', handleError)
    return () => { socket.off('agent_output', handleOutput); socket.off('agent_complete', handleComplete); socket.off('agent_error', handleError) }
  }, [socket, task.id])

  useEffect(() => { if (agentRunning) { setLogs([]); setCompleted(false); setExitCode(null) } }, [agentRunning])

  const handleStart = async () => { setConfirmStart(false); setLogs([]); setCompleted(false); setExitCode(null); await onStartAgent(task.id) }

  return (
    <div className="overflow-hidden" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)' }}>
      {/* Controls bar */}
      <div className="flex items-center justify-between" style={{ padding: '10px 14px' }}>
        <div className="flex items-center gap-2">
          {agentRunning ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent-app)' }} />
          ) : completed ? (
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: exitCode === 0 ? 'var(--apple-green)' : 'var(--apple-red)' }} />
          ) : (
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gray-3)' }} />
          )}
          <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: agentRunning ? 'var(--accent-app)' : completed ? (exitCode === 0 ? 'var(--apple-green)' : 'var(--apple-red)') : 'var(--text-muted)' }}>
            {agentRunning ? 'Agent Running' : completed ? (exitCode === 0 ? 'Completed' : 'Failed') : 'Agent'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {logs.length > 0 && !agentRunning && (
            <button onClick={() => setLogs([])} className="apple-press" style={{ padding: '5px', borderRadius: 'var(--radius-xs)', color: 'var(--text-tertiary)' }} title="Clear logs">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          {agentRunning ? (
            <button onClick={() => onStopAgent(task.id)} className="apple-press flex items-center gap-1.5" style={{ padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-red)', background: 'color-mix(in srgb, var(--apple-red) 10%, transparent)' }}>
              <Square className="w-3 h-3" fill="currentColor" /> Stop
            </button>
          ) : !agentsEnabled ? (
            <span className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>
              <Lock className="w-3 h-3" /> Disabled
            </span>
          ) : !canRunAgents ? (
            <span className="flex items-center gap-1.5" style={{ fontSize: 'var(--text-caption1)', color: 'var(--text-tertiary)' }}>
              <Lock className="w-3 h-3" /> No permission
            </span>
          ) : confirmStart ? (
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--apple-orange)' }} />
              <span style={{ fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-orange)' }}>Run?</span>
              <button onClick={handleStart} className="apple-press" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--apple-green)', background: 'color-mix(in srgb, var(--apple-green) 10%, transparent)' }}>Yes</button>
              <button onClick={() => setConfirmStart(false)} className="apple-press" style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-medium)', color: 'var(--text-muted)' }}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setConfirmStart(true)} className="apple-press flex items-center gap-1.5" style={{ padding: '5px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-caption1)', fontWeight: 'var(--font-semibold)', color: 'var(--accent-app)', background: 'color-mix(in srgb, var(--accent-app) 10%, transparent)' }}>
              <Play className="w-3 h-3" fill="currentColor" /> Run Agent
            </button>
          )}
        </div>
      </div>

      {/* Logs */}
      {(logs.length > 0 || agentRunning) && (
        <div className="custom-scrollbar" style={{ maxHeight: '200px', overflowY: 'auto', padding: 'var(--space-3)', borderTop: '0.5px solid var(--separator)', background: 'var(--bg-app)' }}>
          {logs.length === 0 ? (
            <div className="flex items-center justify-center" style={{ padding: 'var(--space-6)', fontSize: 'var(--text-footnote)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              Waiting for output...
            </div>
          ) : (
            <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-caption1)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: '1.6', margin: 0 }}>
              {logs.join('')}
            </pre>
          )}
          <div ref={logsEndRef} />
        </div>
      )}
    </div>
  )
}
