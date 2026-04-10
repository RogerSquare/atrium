const fs = require('fs');
const path = require('path');
const { getServices } = require('../lib/services');
const { logger } = require('../lib/logger');

// Track active watchers: Map<serviceId, { watcher, timeout, subscribers: Set<socketId> }>
const activeWatchers = new Map();

const WATCH_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.json', '.vue', '.svelte']);
const DEBOUNCE_MS = 500;
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

function shouldWatch(filename) {
  const ext = path.extname(filename).toLowerCase();
  return WATCH_EXTENSIONS.has(ext);
}

function startWatcher(io, serviceId, cwd) {
  if (activeWatchers.has(serviceId)) return;

  try {
    const watcher = fs.watch(cwd, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      // Skip ignored directories
      const parts = filename.split(path.sep);
      if (parts.some(p => IGNORE_DIRS.has(p))) return;

      // Only trigger on relevant file types
      if (!shouldWatch(filename)) return;

      const entry = activeWatchers.get(serviceId);
      if (!entry) return;

      // Debounce
      if (entry.timeout) clearTimeout(entry.timeout);
      entry.timeout = setTimeout(() => {
        io.emit('preview_reload', { serviceId, file: filename });
      }, DEBOUNCE_MS);
    });

    activeWatchers.set(serviceId, { watcher, timeout: null, subscribers: new Set() });
  } catch (err) {
    // cwd may not exist or be inaccessible
    logger.error({ err, serviceId }, 'Preview watcher failed');
  }
}

function stopWatcher(serviceId) {
  const entry = activeWatchers.get(serviceId);
  if (!entry) return;

  if (entry.timeout) clearTimeout(entry.timeout);
  entry.watcher.close();
  activeWatchers.delete(serviceId);
}

function registerPreviewHandlers(io, socket) {
  // Client opens a preview for a service
  socket.on('preview_watch_start', ({ serviceId }) => {
    const services = getServices();
    const service = services.find(s => s.id === serviceId);
    if (!service || !service.cwd) return;

    const entry = activeWatchers.get(serviceId);
    if (entry) {
      entry.subscribers.add(socket.id);
    } else {
      startWatcher(io, serviceId, service.cwd);
      const newEntry = activeWatchers.get(serviceId);
      if (newEntry) newEntry.subscribers.add(socket.id);
    }
  });

  // Client closes a preview
  socket.on('preview_watch_stop', ({ serviceId }) => {
    const entry = activeWatchers.get(serviceId);
    if (!entry) return;

    entry.subscribers.delete(socket.id);
    if (entry.subscribers.size === 0) {
      stopWatcher(serviceId);
    }
  });
}

function handlePreviewDisconnect(io, socket) {
  // Remove socket from all watcher subscriber lists
  for (const [serviceId, entry] of activeWatchers) {
    entry.subscribers.delete(socket.id);
    if (entry.subscribers.size === 0) {
      stopWatcher(serviceId);
    }
  }
}

module.exports = { registerPreviewHandlers, handlePreviewDisconnect };
