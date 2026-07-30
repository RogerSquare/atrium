// Pure builder for GET /api/instance (feat-mcp-bootstrap-001).
//
// Lets an installer DISCOVER the URL and version of the instance it just
// reached instead of assuming http://localhost:3001. That assumption is exactly
// what silently breaks MCP config: the board's own container runs on 3100 with
// its own JWT secret, so an MCP entry hard-coded to :3001 authenticates against
// the wrong instance (or nothing). Reflecting the URL the client actually used
// makes the written config correct by construction.
//
// Pure + fully injectable so the route logic is unit-tested without a server.

function buildInstanceInfo({
  headers = {},
  protocol = 'http',
  host = null,
  port = null,
  version = null,
  name = 'Atrium',
} = {}) {
  // Honor a reverse proxy's forwarded headers so the URL reflects how the client
  // actually reached the server, not the internal bind address. Falls back to
  // the direct protocol/host when unproxied.
  const proto = headers['x-forwarded-proto'] || protocol || 'http';
  const resolvedHost = headers['x-forwarded-host'] || host || null;
  const url = resolvedHost ? `${proto}://${resolvedHost}` : null;

  return {
    name: name || 'Atrium',
    version: version || null,
    port: port ?? null,
    url,
  };
}

module.exports = { buildInstanceInfo };
