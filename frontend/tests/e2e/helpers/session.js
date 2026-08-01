// Login-gate bypass for e2e specs, passed to page.addInitScript(seedSession, opts).
//
// Specs used to seed `taskBoardUser` as a bare `{ username }`, but
// src/lib/session.js (bug-auth-expiry-detect-001) now DROPS any stored user
// whose token is missing, unparseable, or expired — so a tokenless seed lands
// on the login screen and the spec times out. The seed therefore has to be a
// real-shaped JWT. It is unsigned/forged, which is fine: the client only
// base64url-decodes the payload to read `exp` (verification is the server's
// job), and specs that need a real backend use ATRIUM_API_TOKEN instead.
//
// Runs INSIDE the page (addInitScript serializes it), so it must stay
// self-contained — no imports, no closures.
//
// IMPORTANT: a forged token only survives when the API is mocked. If a real
// backend is reachable through the Vite proxy, its 401 trips the session-
// expiry latch (config.js) and the app logs itself straight back out — so
// render-level specs pair seedSession with mockCoreApi below.
export function seedSession({ username = 'e2e', role = null, storage = {} } = {}) {
  const b64url = (obj) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const token = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ username, role, exp: Math.floor(Date.now() / 1000) + 86400 })}.e2e`;
  const user = { username, token };
  if (role) user.role = role;
  localStorage.setItem('taskBoardUser', JSON.stringify(user));
  localStorage.setItem('taskBoardThemeMigratedToOled', '1');
  for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
}

// Hermetic API for render-level specs: every endpoint answers with an empty
// but correctly-SHAPED payload, so the app boots identically whether or not a
// real backend happens to be running on the dev box. Register the catch-all
// first — Playwright matches routes in reverse registration order.
export async function mockCoreApi(page) {
  // Sockets are blocked outright: with a real backend running on the dev box,
  // the forged-token socket can otherwise connect (or half-connect on older
  // backends) and REAL broadcast traffic — chat join messages, presence —
  // leaks into the test page. The socket.io client just retries quietly.
  await page.route('**/socket.io/**', (route) => route.abort());
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/tasks**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/projects**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/services', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/loops**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/agents/active', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/chat/messages', (route) => route.fulfill({ json: [] }));
  // Without complete:true the first-run wizard overlays the whole app.
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: { complete: true } }));
}
