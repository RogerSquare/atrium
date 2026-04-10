// Configuration for API and Socket communication
// Using relative paths to leverage Vite's proxy in development
// and standard same-origin behavior in production/domain access.

export const API_BASE = '';
export const API_URL = '/api';

// Authenticated fetch wrapper — auto-attaches JWT token from stored user
export function apiFetch(url, options = {}) {
  const headers = { ...options.headers };
  try {
    const saved = localStorage.getItem('taskBoardUser');
    if (saved) {
      const user = JSON.parse(saved);
      if (user.token) {
        headers['Authorization'] = `Bearer ${user.token}`;
      }
    }
  } catch (e) { /* ignore parse errors */ }
  return fetch(url, { ...options, headers });
}
