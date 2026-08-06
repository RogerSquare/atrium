// AI chat stream rooms (feat-ai-chat-stream-001).
//
// Clients join `ai:task:<id>` / `ai:user:<username>` rooms to receive the
// chunk/done/error events routes/ai.js emits during a generation. The join
// ack carries the current in-flight snapshot so a client attaching
// mid-generation (page refresh, panel re-open) renders the accumulated text
// before live deltas resume — nothing is emitted socket-wide.
//
// Authorization: the handshake middleware (lib/socketAuth.js) already
// verified the JWT, so `socket.user` is trustworthy. Task threads are
// shared surfaces (same visibility as the task itself) — any authenticated
// socket may join. User threads are private: only the same username, an
// admin, or an agent identity may join. With ATRIUM_SOCKET_AUTH=off
// socket.user is null and joins are allowed, matching the REST escape hatch.

const { roomForKey, snapshot } = require('../lib/aiChatSessions');

const keyForJoin = (data) => {
  if (data?.taskId) return `task:${data.taskId}`;
  if (data?.username) return `user:${data.username}`;
  return null;
};

const canJoin = (socketUser, data) => {
  if (!socketUser) return true; // auth explicitly disabled
  if (data?.taskId) return true;
  return (
    socketUser.username === data?.username
    || socketUser.role === 'admin'
    || socketUser.role === 'agent'
  );
};

const registerAiChatHandlers = (io, socket) => {
  socket.on('ai_chat_join', (data, ack) => {
    const key = keyForJoin(data);
    if (!key || !canJoin(socket.user, data)) {
      if (typeof ack === 'function') ack({ error: 'Not authorized for this thread' });
      return;
    }
    socket.join(roomForKey(key));
    if (typeof ack === 'function') ack({ session: snapshot(key) });
  });

  socket.on('ai_chat_leave', (data) => {
    const key = keyForJoin(data);
    if (key) socket.leave(roomForKey(key));
  });
};

module.exports = { registerAiChatHandlers };
