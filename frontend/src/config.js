// Configuration for API and Socket communication
// Using relative paths to leverage Vite's proxy in development
// and standard same-origin behavior in production/domain access.

import { isSessionExpiredResponse } from './lib/session';

export const API_BASE = '';
export const API_URL = '/api';

/** Dispatched once when the server rejects the session. AuthContext listens. */
export const SESSION_EXPIRED_EVENT = 'atrium:session-expired';

// One expiry, one logout. The board fires many requests at once (tasks,
// services, github links, health), so an expired token produces a BURST of
// 401s. Without this latch each one would dispatch, and the user would get a
// pile of duplicate logouts and toasts for a single event.
let expiryAnnounced = false;

/** Called by AuthContext after a successful login so the latch can re-arm. */
export function resetSessionExpiryLatch() {
  expiryAnnounced = false;
}

function announceSessionExpired() {
  if (expiryAnnounced) return;
  expiryAnnounced = true;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

// Read the stored session JWT, or null. Shared by apiFetch (Authorization
// header) AND every Socket.IO connection (handshake auth), so a socket identity
// means the same thing as a REST identity. Before devops-socket-auth-001 the
// sockets sent no token at all. (devops-socket-auth-001)
export function getStoredToken() {
  try {
    const saved = localStorage.getItem('taskBoardUser');
    if (!saved) return null;
    const user = JSON.parse(saved);
    return user && user.token ? user.token : null;
  } catch {
    return null;
  }
}

// Authenticated fetch wrapper — auto-attaches JWT token from stored user
export function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  const token = getStoredToken();
  const usedSessionToken = !!token;
  if (token) headers['Authorization'] = `Bearer ${token}`;

  return fetch(url, { ...options, headers }).then((res) => {
    // Central expiry detection. There was previously no 401 handling anywhere
    // in the app, so an expired token left the board running against a dead
    // session with no indication — the only way out was a manual logout.
    //
    // Scoped deliberately: only a 401, and only when this request actually
    // carried the user's session token. A 403 is a permissions error and a 401
    // on an unauthenticated call is not the user's session dying; treating
    // either as expiry would turn an ordinary error into a surprise logout.
    if (isSessionExpiredResponse(res.status, { usedSessionToken })) {
      announceSessionExpired();
    }
    return res;
  });
}
