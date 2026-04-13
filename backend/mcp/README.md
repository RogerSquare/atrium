# atrium-mcp-server

Stdio MCP server that exposes Atrium task-board operations to Claude Code sessions. Registered per-user via `claude mcp add`; the recommended way to install is the `atrium-mcp-setup` CLI (see `backend/cli/`).

## Configuration (env vars)

- `ATRIUM_API_TOKEN` (required) — a long-lived agent token minted via the Atrium admin UI or `POST /api/auth/agent-token`.
- `ATRIUM_URL` (default: `http://localhost:3001`) — base URL of the Atrium backend.

## Development

```bash
cd backend/mcp
npm install
ATRIUM_API_TOKEN=<token> node server.js
```

The process reads JSON-RPC from stdin and writes to stdout. To drive it manually for smoke testing, pipe an `initialize` request in.

## Tools

Each tool lives in `./tools/<name>.js` and exports:

```js
module.exports = {
  name: 'atrium_xxx',
  description: 'Short description Claude sees.',
  inputSchema: { type: 'object', properties: { ... }, required: [ ... ] },
  handler: async (args) => { /* returns anything JSON-serializable or a string */ },
};
```

New tools are auto-discovered — drop a file and restart the server.
