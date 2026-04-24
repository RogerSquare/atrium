// Facelift detail — Agent Log tab.
//
// Wraps AgentLogPanel. Exists as its own tab so the live log stream has
// predictable real estate rather than competing with chat for space.

import AgentLogPanel from '../AgentLogPanel'

export default function DetailAgentLog({
  task,
  socket,
  agentRunning,
  onStartAgent,
  onStopAgent,
  currentUser,
  agentsEnabled,
  canRunAgents,
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <AgentLogPanel
        task={task}
        socket={socket}
        agentRunning={agentRunning}
        onStartAgent={onStartAgent}
        onStopAgent={onStopAgent}
        currentUser={currentUser}
        agentsEnabled={agentsEnabled}
        canRunAgents={canRunAgents}
      />
    </div>
  )
}
