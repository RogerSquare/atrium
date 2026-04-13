// Thin HTTP client for the Atrium REST API. All requests carry the agent token.
// Exits the process with a clear message if required env vars are missing at boot.

const ATRIUM_URL = process.env.ATRIUM_URL || 'http://localhost:3001';
const ATRIUM_API_TOKEN = process.env.ATRIUM_API_TOKEN;

if (!ATRIUM_API_TOKEN) {
  process.stderr.write('[atrium-mcp] ATRIUM_API_TOKEN env var is required. Run `atrium-mcp-setup --token <token>` to configure.\n');
  process.exit(1);
}

const baseHeaders = () => ({
  'Authorization': `Bearer ${ATRIUM_API_TOKEN}`,
  'Content-Type': 'application/json',
});

async function request(method, path, body) {
  const url = `${ATRIUM_URL}${path}`;
  const init = { method, headers: baseHeaders() };
  if (body !== undefined) init.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new Error(`Atrium API unreachable at ${ATRIUM_URL}: ${err.message}. Is atrium-backend running?`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON response */ }
  if (!res.ok) {
    const msg = (json && json.error) || text || `HTTP ${res.status}`;
    throw new Error(`Atrium API ${method} ${path}: ${msg}`);
  }
  return json;
}

module.exports = {
  ATRIUM_URL,
  apiGet: (path) => request('GET', path),
  apiPost: (path, body) => request('POST', path, body),
  apiPut: (path, body) => request('PUT', path, body),
  apiDelete: (path) => request('DELETE', path),
};
