const { loadChatMessages, saveChatMessages, onlineUsers, getUniqueOnlineUsers } = require('../lib/chat');
const { withLock } = require('../lib/lock');

const persistAndEmit = async (io, msg) => {
  await withLock('chat:messages', async () => {
    const messages = loadChatMessages();
    messages.push(msg);
    saveChatMessages(messages);
  });
  io.emit('chat_message', msg);
};

const registerChatHandlers = (io, socket) => {
  // No join/leave system messages (ui-chat-system-noise-001): reconnect churn
  // produced runs of "X joined/left" lines, and the online-users row already
  // shows presence. Only the chat_users broadcast carries join/leave now.
  socket.on('chat_join', async (data) => {
    const username = data?.username || 'Anonymous';
    onlineUsers.set(socket.id, { username, joinedAt: new Date().toISOString() });
    io.emit('chat_users', getUniqueOnlineUsers());
  });

  socket.on('chat_send', async (data) => {
    if (!data?.content?.trim()) return;
    const user = onlineUsers.get(socket.id);
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type: 'user',
      username: user?.username || data.username || 'Anonymous',
      content: data.content.trim(),
      timestamp: new Date().toISOString(),
      reactions: {}
    };
    await persistAndEmit(io, msg);
  });

  // GIF messages
  socket.on('chat_send_gif', async (data) => {
    if (!data?.url) return;
    const user = onlineUsers.get(socket.id);
    const msg = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type: 'gif',
      username: user?.username || data.username || 'Anonymous',
      content: data.url,
      timestamp: new Date().toISOString(),
      reactions: {}
    };
    await persistAndEmit(io, msg);
  });

  // Emoji reactions
  socket.on('chat_react', async (data) => {
    if (!data?.messageId || !data?.emoji) return;
    const user = onlineUsers.get(socket.id);
    const username = user?.username || data.username || 'Anonymous';

    await withLock('chat:messages', async () => {
      const messages = loadChatMessages();
      const msg = messages.find(m => m.id === data.messageId);
      if (!msg) return;

      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[data.emoji]) msg.reactions[data.emoji] = [];

      const idx = msg.reactions[data.emoji].indexOf(username);
      if (idx >= 0) {
        msg.reactions[data.emoji].splice(idx, 1);
        if (msg.reactions[data.emoji].length === 0) delete msg.reactions[data.emoji];
      } else {
        msg.reactions[data.emoji].push(username);
      }

      saveChatMessages(messages);
      io.emit('chat_reaction', { messageId: data.messageId, reactions: msg.reactions || {} });
    });
  });

  socket.on('chat_typing', (data) => {
    socket.broadcast.emit('chat_typing', {
      username: data?.username || onlineUsers.get(socket.id)?.username || 'Someone'
    });
  });

  socket.on('chat_stop_typing', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      socket.broadcast.emit('chat_stop_typing', { username: user.username });
    }
  });
};

const handleChatDisconnect = async (io, socket) => {
  const user = onlineUsers.get(socket.id);
  if (user) {
    onlineUsers.delete(socket.id);
    io.emit('chat_users', getUniqueOnlineUsers());
  }
};

module.exports = { registerChatHandlers, handleChatDisconnect };
