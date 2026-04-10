const pty = require('node-pty');
const { logger } = require('../lib/logger');

const registerTerminalHandlers = (socket) => {
  let ptyProcess = null;

  socket.on('start_terminal', (config) => {
    try {
      if (ptyProcess) {
        ptyProcess.kill();
      }

      const cwd = config.cwd || process.env.USERPROFILE || 'C:\\';
      const shell = 'cmd.exe';

      logger.info({ cwd, socketId: socket.id }, 'Starting PTY session');

      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: config.cols || 80,
        rows: config.rows || 24,
        cwd: cwd,
        env: process.env
      });

      ptyProcess.onData((data) => {
        socket.emit('terminal_output', data);
      });

      ptyProcess.onExit(({ exitCode }) => {
        socket.emit('terminal_output', `\r\n\x1b[33m--- Shell Exited ---\x1b[0m\r\n`);
        ptyProcess = null;
      });

      if (config.command) {
        setTimeout(() => {
          ptyProcess.write(config.command + '\r');
        }, 500);
      }

    } catch (err) {
      logger.error({ err }, 'PTY spawn error');
      socket.emit('terminal_output', `\r\n\x1b[31mError starting terminal: ${err.message}\x1b[0m\r\n`);
    }
  });

  socket.on('terminal_input', (data) => {
    if (ptyProcess) {
      ptyProcess.write(data);
    }
  });

  socket.on('resize', (size) => {
    if (ptyProcess && size) {
      try {
        ptyProcess.resize(size.cols, size.rows);
      } catch (err) {
        // Ignored
      }
    }
  });

  // Return cleanup function
  return () => {
    if (ptyProcess) {
      ptyProcess.kill();
    }
  };
};

module.exports = { registerTerminalHandlers };
