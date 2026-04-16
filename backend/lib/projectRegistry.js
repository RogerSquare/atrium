const fs = require('fs');
const path = require('path');
const { PROJECTS_FILE, TASKS_DIR, ARCHIVED_DIR } = require('./constants');

/**
 * Project Registry
 *
 * Manages a projects.json file that maps short IDs to project folder names.
 * Format: { "atrium": { "name": "Atrium", "folder": "Atrium" }, ... }
 *
 * The "Root" project always has id "root" and cannot be modified.
 */

function load() {
  if (fs.existsSync(PROJECTS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function save(registry) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(registry, null, 2), 'utf8');
}

function generateId(name) {
  if (name === 'Root') return 'root';
  // Take initials or abbreviation from name
  const words = name.replace(/[^a-zA-Z0-9\s-]/g, '').split(/[\s-]+/).filter(Boolean);
  let id;
  if (words.length === 1) {
    id = words[0].toLowerCase().slice(0, 8);
  } else {
    // Use first letters of each word, or first word if short enough
    const initials = words.map(w => w[0]).join('').toLowerCase();
    id = initials.length >= 2 ? initials : words[0].toLowerCase().slice(0, 8);
  }
  // Ensure uniqueness
  const registry = load();
  let candidate = id;
  let counter = 1;
  while (registry[candidate]) {
    candidate = `${id}${counter}`;
    counter++;
  }
  return candidate;
}

function getAll({ include = 'active' } = {}) {
  const registry = load();
  const isArchived = (proj) => proj && proj.archived === true;
  const result = {};
  // Root is never archivable; always include it when active/all requested
  if (include === 'active' || include === 'all') {
    result.root = { name: 'Root', folder: 'Root' };
  }
  for (const [id, proj] of Object.entries(registry)) {
    if (include === 'active' && isArchived(proj)) continue;
    if (include === 'archived' && !isArchived(proj)) continue;
    result[id] = proj;
  }
  return result;
}

function getById(id) {
  if (id === 'root') return { name: 'Root', folder: 'Root' };
  const registry = load();
  return registry[id] || null;
}

function getByFolder(folder) {
  if (folder === 'Root') return { id: 'root', name: 'Root', folder: 'Root' };
  const registry = load();
  for (const [id, proj] of Object.entries(registry)) {
    if (proj.folder === folder) return { id, ...proj };
  }
  return null;
}

function getByName(name) {
  if (name === 'Root') return { id: 'root', name: 'Root', folder: 'Root' };
  const registry = load();
  for (const [id, proj] of Object.entries(registry)) {
    if (proj.name === name || proj.folder === name) return { id, ...proj };
  }
  return null;
}

function resolve(idOrName) {
  // Try by ID first, then by name/folder
  const byId = getById(idOrName);
  if (byId) return { id: idOrName, ...byId };
  const byName = getByName(idOrName);
  if (byName) return byName;
  return null;
}

function register(folder, customId) {
  if (folder === 'Root') return { id: 'root', name: 'Root', folder: 'Root' };
  const registry = load();

  // Check if already registered
  for (const [id, proj] of Object.entries(registry)) {
    if (proj.folder === folder) return { id, ...proj };
  }

  const id = customId || generateId(folder);
  // Validate custom ID
  if (customId && registry[customId]) {
    return null; // ID already taken
  }

  const entry = { name: folder, folder };
  registry[id] = entry;
  save(registry);
  return { id, ...entry };
}

function updateId(oldId, newId) {
  if (oldId === 'root' || newId === 'root') return false;
  if (!/^[a-z0-9][a-z0-9-]{0,11}$/.test(newId)) return false;
  const registry = load();
  if (!registry[oldId]) return false;
  if (registry[newId]) return false;
  registry[newId] = registry[oldId];
  delete registry[oldId];
  save(registry);
  return true;
}

function setName(id, name) {
  if (id === 'root') return false;
  const registry = load();
  if (!registry[id]) return false;
  registry[id].name = name;
  save(registry);
  return true;
}

function remove(id) {
  if (id === 'root') return false;
  const registry = load();
  if (!registry[id]) return false;
  delete registry[id];
  save(registry);
  return true;
}

/**
 * Sync registry with actual project directories on disk.
 * Registers any unregistered folders and removes entries for deleted folders.
 * NOTE: `tasksDirs` should be the ACTIVE project folders only (i.e. direct
 * children of TASKS_DIR, excluding dot-prefixed dirs like `.archived/`).
 * Archived entries stay in the registry even though their folder lives under
 * ARCHIVED_DIR — we check that location before removing them.
 */
function syncWithDisk(tasksDirs) {
  const registry = load();
  const existingActive = new Set(tasksDirs);
  let changed = false;

  // Remove entries for deleted folders — but keep archived entries whose folder
  // physically lives under ARCHIVED_DIR.
  for (const [id, proj] of Object.entries(registry)) {
    if (existingActive.has(proj.folder)) continue;
    const archivedPath = path.join(ARCHIVED_DIR, proj.folder);
    if (fs.existsSync(archivedPath)) continue;
    delete registry[id];
    changed = true;
  }

  // Register new folders (active side only)
  const registeredFolders = new Set(Object.values(registry).map(p => p.folder));
  for (const folder of tasksDirs) {
    if (folder !== 'Root' && !registeredFolders.has(folder)) {
      const id = generateId(folder);
      registry[id] = { name: folder, folder };
      changed = true;
    }
  }

  if (changed) save(registry);
  return registry;
}

function archive(id) {
  if (id === 'root') return null;
  const registry = load();
  const proj = registry[id];
  if (!proj) return null;
  if (proj.archived === true) return { id, ...proj };
  const src = path.join(TASKS_DIR, proj.folder);
  const dst = path.join(ARCHIVED_DIR, proj.folder);
  if (!fs.existsSync(ARCHIVED_DIR)) fs.mkdirSync(ARCHIVED_DIR, { recursive: true });
  if (fs.existsSync(src)) {
    if (fs.existsSync(dst)) {
      throw new Error(`Destination already exists: ${dst}`);
    }
    fs.renameSync(src, dst);
  }
  proj.archived = true;
  proj.archived_at = new Date().toISOString();
  save(registry);
  return { id, ...proj };
}

function unarchive(id) {
  if (id === 'root') return null;
  const registry = load();
  const proj = registry[id];
  if (!proj) return null;
  if (proj.archived !== true) return { id, ...proj };
  const src = path.join(ARCHIVED_DIR, proj.folder);
  const dst = path.join(TASKS_DIR, proj.folder);
  if (fs.existsSync(src)) {
    if (fs.existsSync(dst)) {
      throw new Error(`Destination already exists: ${dst}`);
    }
    fs.renameSync(src, dst);
  }
  proj.archived = false;
  delete proj.archived_at;
  save(registry);
  return { id, ...proj };
}

function getArchived() {
  const all = getAll({ include: 'archived' });
  return all;
}

module.exports = {
  getAll, getById, getByFolder, getByName, resolve,
  register, updateId, setName, remove, syncWithDisk, generateId,
  archive, unarchive, getArchived
};
