// Shared Socket.IO instance holder.
// Set once from server.js, then importable by any route/module.
let io = null;

const setIO = (socketIO) => { io = socketIO; };
const getIO = () => io;

module.exports = { setIO, getIO };
