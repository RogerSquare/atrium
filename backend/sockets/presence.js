// Track which users are viewing which tasks
// Map<taskId, Map<socketId, { username }>>
const taskViewers = new Map();

const getViewersForTask = (taskId) => {
  const viewers = taskViewers.get(taskId);
  if (!viewers || viewers.size === 0) return [];
  // Deduplicate by username
  const unique = [...new Map(Array.from(viewers.values()).map(v => [v.username, v])).values()];
  return unique.map(v => v.username);
};

const getAllTaskViewers = () => {
  const result = {};
  for (const [taskId, viewers] of taskViewers.entries()) {
    const names = getViewersForTask(taskId);
    if (names.length > 0) result[taskId] = names;
  }
  return result;
};

const registerPresenceHandlers = (io, socket) => {
  socket.on('task_view_start', (data) => {
    if (!data?.taskId || !data?.username) return;

    // Remove from any previously viewed task first
    for (const [tid, viewers] of taskViewers.entries()) {
      if (viewers.has(socket.id)) {
        viewers.delete(socket.id);
        if (viewers.size === 0) taskViewers.delete(tid);
        io.emit('task_viewers', { taskId: tid, viewers: getViewersForTask(tid) });
      }
    }

    // Add to new task
    if (!taskViewers.has(data.taskId)) {
      taskViewers.set(data.taskId, new Map());
    }
    taskViewers.get(data.taskId).set(socket.id, { username: data.username });

    io.emit('task_viewers', { taskId: data.taskId, viewers: getViewersForTask(data.taskId) });
  });

  socket.on('task_view_end', (data) => {
    if (!data?.taskId) return;

    const viewers = taskViewers.get(data.taskId);
    if (viewers) {
      viewers.delete(socket.id);
      if (viewers.size === 0) taskViewers.delete(data.taskId);
    }

    io.emit('task_viewers', { taskId: data.taskId, viewers: getViewersForTask(data.taskId) });
  });
};

const handlePresenceDisconnect = (io, socket) => {
  // Remove from all tasks this socket was viewing
  for (const [taskId, viewers] of taskViewers.entries()) {
    if (viewers.has(socket.id)) {
      viewers.delete(socket.id);
      if (viewers.size === 0) taskViewers.delete(taskId);
      io.emit('task_viewers', { taskId, viewers: getViewersForTask(taskId) });
    }
  }
};

module.exports = { registerPresenceHandlers, handlePresenceDisconnect, getAllTaskViewers };
