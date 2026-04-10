const path = require('path');

/**
 * Sanitize a filename/ID by stripping directory traversal characters.
 * Removes: .., /, \, null bytes. Only allows alphanumeric, hyphens, underscores, dots, and spaces.
 */
const sanitizeFilename = (name) => {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/\.\./g, '')        // strip ..
    .replace(/[/\\]/g, '')       // strip path separators
    .replace(/\0/g, '')          // strip null bytes
    .replace(/[^a-zA-Z0-9._\- ]/g, '') // whitelist safe chars
    .trim();
};

/**
 * Verify that a resolved file path is within the expected base directory.
 * Returns the resolved path if safe, or null if it escapes.
 */
const safePath = (baseDir, ...segments) => {
  const resolved = path.resolve(baseDir, ...segments);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    return null;
  }
  return resolved;
};

module.exports = { sanitizeFilename, safePath };
