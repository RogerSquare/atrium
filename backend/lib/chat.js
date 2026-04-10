const fs = require('fs');
const { CHAT_FILE, MAX_CHAT_MESSAGES } = require('./constants');

const loadChatMessages = () => {
  try {
    return JSON.parse(fs.readFileSync(CHAT_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
};

const saveChatMessages = (messages) => {
  const trimmed = messages.slice(-MAX_CHAT_MESSAGES);
  fs.writeFileSync(CHAT_FILE, JSON.stringify(trimmed, null, 2));
  return trimmed;
};

// Track connected chat users: Map<socketId, { username, joinedAt }>
const onlineUsers = new Map();

const getUniqueOnlineUsers = () => {
  return [...new Map(Array.from(onlineUsers.values()).map(u => [u.username, u])).values()];
};

module.exports = { loadChatMessages, saveChatMessages, onlineUsers, getUniqueOnlineUsers };
