const fs = require('fs');
const { WORKSPACES_FILE } = require('./constants');

/**
 * Workspace Registry (feat-workspaces-impl-001)
 *
 * Workspaces are an ISOLATION boundary one level above projects: the client
 * shows only the active workspace's projects and their tasks. Membership
 * lives on the PROJECT side (projects.json entries carry `workspace: <id>`);
 * this file owns only the workspaces themselves.
 *
 * Format: { "personal": { "name": "Personal", "order": 0, "color": "#..." } }
 *
 * "personal" is the default workspace — the Root analogue: always exists,
 * renameable, never deletable. Root/Unassigned tasks belong to it by decree
 * (the requestor chose pinned-to-default over visible-everywhere), and every
 * pre-workspaces project entry is backfilled into it.
 */

const DEFAULT_WORKSPACE_ID = 'personal';
const ID_RE = /^[a-z0-9][a-z0-9-]{0,11}$/;

function load() {
  if (fs.existsSync(WORKSPACES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function save(registry) {
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

// Every read path funnels through this so "personal" exists from the first
// request on a fresh install — no separate migration step to forget.
function ensureDefault() {
  const registry = load();
  if (!registry[DEFAULT_WORKSPACE_ID]) {
    registry[DEFAULT_WORKSPACE_ID] = { name: 'Personal', order: 0 };
    save(registry);
  }
  return registry;
}

function generateId(name) {
  const words = name.replace(/[^a-zA-Z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean);
  let id;
  if (words.length <= 1) {
    id = (words[0] || '').toLowerCase().slice(0, 8);
  } else {
    const initials = words.map(w => w[0]).join('').toLowerCase();
    id = initials.length >= 2 ? initials.slice(0, 12) : words[0].toLowerCase().slice(0, 8);
  }
  if (!ID_RE.test(id)) id = 'ws';
  const registry = ensureDefault();
  let candidate = id;
  let counter = 1;
  while (registry[candidate]) {
    candidate = `${id}${counter}`;
    counter++;
  }
  return candidate;
}

function getAll() {
  const registry = ensureDefault();
  return Object.entries(registry)
    .map(([id, ws]) => ({
      id,
      name: ws.name,
      order: typeof ws.order === 'number' ? ws.order : 0,
      ...(ws.color ? { color: ws.color } : {}),
    }))
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
}

function getById(id) {
  const registry = ensureDefault();
  return registry[id] ? { id, ...registry[id] } : null;
}

// Two workspaces may not sanitize to the same on-disk directory name — the
// nested tasks layout (taskPaths.js) keys workspace dirs by sanitized name,
// and a collision would silently merge their project trees.
function dirCollides(registry, name, excludeId) {
  const { sanitizeWorkspaceDirName } = require('./taskPaths');
  const candidate = sanitizeWorkspaceDirName(name, '');
  return Object.entries(registry).some(([wid, ws]) =>
    wid !== excludeId && sanitizeWorkspaceDirName(ws.name, wid) === candidate
  );
}

// Returns the created workspace, or null when the name is empty/taken.
function create(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const registry = ensureDefault();
  const taken = Object.values(registry).some(
    ws => ws.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (taken || dirCollides(registry, trimmed, null)) return null;
  const id = generateId(trimmed);
  const maxOrder = Math.max(0, ...Object.values(registry).map(ws => ws.order ?? 0));
  registry[id] = { name: trimmed, order: maxOrder + 1 };
  save(registry);
  return { id, ...registry[id] };
}

function rename(id, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const registry = ensureDefault();
  if (!registry[id]) return false;
  const taken = Object.entries(registry).some(
    ([wid, ws]) => wid !== id && ws.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (taken || dirCollides(registry, trimmed, id)) return false;
  registry[id].name = trimmed;
  save(registry);
  return true;
}

// Empty/null clears the color.
function setColor(id, color) {
  const registry = ensureDefault();
  if (!registry[id]) return false;
  if (color) registry[id].color = String(color);
  else delete registry[id].color;
  save(registry);
  return true;
}

function setOrder(id, order) {
  if (typeof order !== 'number' || !Number.isFinite(order)) return false;
  const registry = ensureDefault();
  if (!registry[id]) return false;
  registry[id].order = order;
  save(registry);
  return true;
}

// Structured result so the route can say WHY: the default workspace is
// undeletable, and a workspace still holding projects must be emptied first
// (delete never cascades — reassigning projects is an explicit user act).
function remove(id) {
  if (id === DEFAULT_WORKSPACE_ID) return { ok: false, reason: 'default' };
  const registry = ensureDefault();
  if (!registry[id]) return { ok: false, reason: 'not_found' };
  // Lazy require: projectRegistry top-requires this module for the default id.
  const projectRegistry = require('./projectRegistry');
  const count = Object.values(projectRegistry.getAll({ include: 'all' }))
    .filter(p => (p.workspace || DEFAULT_WORKSPACE_ID) === id).length;
  if (count > 0) return { ok: false, reason: 'in_use', count };
  delete registry[id];
  save(registry);
  return { ok: true };
}

module.exports = {
  DEFAULT_WORKSPACE_ID,
  ensureDefault, getAll, getById, create, rename, setColor, setOrder, remove,
  generateId,
};
