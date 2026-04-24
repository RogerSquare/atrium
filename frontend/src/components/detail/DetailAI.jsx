// Facelift detail — AI tab.
//
// Wraps AIChatPanel as a tab. Active-agent indicator is handled by the
// parent DetailPane (it puts a dot on the tab icon when agentRunning).

import AIChatPanel from '../AIChatPanel'

export default function DetailAI({ task, currentUser, aiChatEnabled }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <AIChatPanel user={currentUser} task={task} noHeader aiChatEnabled={aiChatEnabled} />
    </div>
  )
}
