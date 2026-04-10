// Simple in-memory async mutex for protecting read-modify-write file operations.
// Keyed by resource name so different resources can be locked independently.

const locks = new Map();

/**
 * Acquire a lock for a given key. Returns a release function.
 * If the lock is already held, waits until it's released.
 *
 * Usage:
 *   const release = await acquireLock('task:feat-001');
 *   try {
 *     // ... read-modify-write ...
 *   } finally {
 *     release();
 *   }
 */
const acquireLock = (key) => {
  if (!locks.has(key)) {
    locks.set(key, Promise.resolve());
  }

  let release;
  const newLock = new Promise((resolve) => {
    release = resolve;
  });

  // Chain onto the existing lock — we wait for it, then we hold the lock
  const prevLock = locks.get(key);
  locks.set(key, prevLock.then(() => newLock));

  // Return a promise that resolves to the release function once the previous lock clears
  return prevLock.then(() => release);
};

/**
 * Convenience wrapper: run a function while holding a lock.
 * The lock is always released, even if fn throws.
 *
 * Usage:
 *   const result = await withLock('task:feat-001', async () => {
 *     // ... read-modify-write ...
 *     return data;
 *   });
 */
const withLock = async (key, fn) => {
  const release = await acquireLock(key);
  try {
    return await fn();
  } finally {
    release();
  }
};

module.exports = { acquireLock, withLock };
