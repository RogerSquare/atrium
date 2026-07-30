# Atrium CLI tools

Command-line utilities shipped alongside atrium-backend.

## `atrium-mcp-setup`

Installs the Atrium skill and registers the stdio MCP server with Claude Code on the current machine.

### Prerequisites

1. Claude Code CLI installed and on PATH (`claude --version` should work).
2. Atrium backend running (`npm start` in the backend directory), default at http://localhost:3001.
3. An agent token — generate via the Atrium admin UI's "Agent Tokens" section, or `POST /api/agent-token`.

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

1. Verifies the token against `GET /api/verify`.
2. Probes `GET /api/instance` and records the URL the instance reports, so the
   MCP entry points at the real backend instead of assuming `localhost:3001`.
3. Copies the canonical `.claude/skills/atrium/SKILL.md` → `~/.claude/skills/atrium/SKILL.md`.
4. Registers the stdio server via `claude mcp add --transport stdio --scope user atrium ...`.
   An existing entry of the same name is left untouched unless you pass `--force`.
5. Runs a health check (skill installed / MCP entry present / Atrium reachable /
   token verified) and prints a pass-fail line for each.

Flags:

- `--dry-run` — print the intended actions and write nothing.
- `--force` — overwrite an existing MCP entry of the same name (default: skip it).
- `--url <url>` — backend URL to reach (default `http://localhost:3001`); the
  instance probe refines what gets written into the config.
- `--name <name>` — MCP server name in Claude's config (default `atrium`).

Re-running is idempotent: the skill copy is byte-identical and an existing MCP
entry is skipped, so a second run produces no config diff.

### After setup

Open a new `claude` session and ask e.g. "list atrium todo tasks" — Claude should call the `atrium_list_tasks` tool.

### Removing

```bash
claude mcp remove atrium
rm -rf ~/.claude/skills/atrium
```

And revoke the token via the Atrium admin UI (or `DELETE /api/agent-tokens/<jti>`).
