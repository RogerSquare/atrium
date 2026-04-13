# Atrium CLI tools

Command-line utilities shipped alongside atrium-backend.

## `atrium-mcp-setup`

Installs the Atrium skill and registers the stdio MCP server with Claude Code on the current machine.

### Prerequisites

1. Claude Code CLI installed and on PATH (`claude --version` should work).
2. Atrium backend running (`npm start` in the backend directory), default at http://localhost:3001.
3. An agent token — generate via the Atrium admin UI's "Agent Tokens" section, or `POST /api/auth/agent-token`.

### One-time setup per machine

From this repo:

```bash
# Make the command available globally (requires npm link or global install)
cd backend
npm link             # dev — creates a symlink in your global npm bin
# or:
npm install -g .     # install as a global package

# Then run:
atrium-mcp-setup --token <agent-token> --url http://localhost:3001
```

Or without global install, directly from the repo:

```bash
node backend/cli/atrium-mcp-setup.js --token <agent-token>
```

The command:

1. Verifies the token against `GET /api/auth/verify`.
2. Copies `backend/mcp/skill/SKILL.md` → `~/.claude/skills/atrium/SKILL.md`.
3. Calls `claude mcp add --transport stdio --scope user atrium ...` to register the MCP server.

### After setup

Open a new `claude` session and ask e.g. "list atrium todo tasks" — Claude should call the `atrium_list_tasks` tool.

### Removing

```bash
claude mcp remove atrium
rm -rf ~/.claude/skills/atrium
```

And revoke the token via the Atrium admin UI (or `DELETE /api/auth/agent-tokens/<jti>`).
