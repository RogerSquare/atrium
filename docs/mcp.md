# Atrium MCP server

A stdio [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes the task board to Claude Code as `atrium_*` tools, so an agent works the
board directly instead of shelling out to `curl`. Source: `backend/mcp/`.

This is the Claude-Code-native convenience layer. Any agent can use the plain
REST API instead — see [agents.md](agents.md).

---

## Install (recommended)

On the machine where your agent runs, with Atrium running:

```bash
node backend/cli/atrium-mcp-setup.js --token <agent-token> --url http://localhost:3001
```

It (1) verifies the token, (2) probes `GET /api/instance` and records the URL the
instance actually reports, (3) installs the canonical Atrium skill to
`~/.claude/skills/atrium/SKILL.md`, and (4) registers the MCP server with
`claude mcp add` at user scope. It is idempotent and won't overwrite an existing
entry of the same name unless you pass `--force`.

Useful flags: `--dry-run` (print, write nothing), `--name <name>` (config key,
default `atrium`), `--force`. Full reference: `backend/cli/README.md`.

Then open a new `claude` session and try: *"list atrium todo tasks"*.

## Configuration (env vars)

The server reads two variables (the setup CLI writes them into the MCP entry):

- `ATRIUM_API_TOKEN` (required) — an agent token (`POST /api/agent-token`, admin,
  or the Settings UI). Without it the server starts but every call returns 401.
- `ATRIUM_URL` (default `http://localhost:3001`) — the backend URL.

## Manual registration

If you'd rather not use the CLI:

```bash
claude mcp add atrium --transport stdio --scope user \
  -e ATRIUM_API_TOKEN=<token> -e ATRIUM_URL=http://localhost:3001 \
  -- node /absolute/path/to/backend/mcp/server.js
```

Or a repo-scoped `.mcp.json` (the repo ships one) that reads
`${ATRIUM_URL:-http://localhost:3001}` and `${ATRIUM_API_TOKEN}` from your
environment.

## Tools

Auto-discovered from `backend/mcp/tools/*.js` — each exports `{ name,
description, inputSchema, handler }`. Current set:

`atrium_list_tasks`, `atrium_get_task`, `atrium_create_task`,
`atrium_update_task`, `atrium_append_comment`, `atrium_create_approval`,
`atrium_continue_task`, `atrium_from_template` / `atrium_list_templates`,
`atrium_run_e2e`, `atrium_wait_for_next_todo`.

`atrium_wait_for_next_todo` long-polls for the next task promoted to `todo` and
atomically claims it — the basis of "worker loop" mode.

## Inside the container

The default `docker-compose.yml` passes `ATRIUM_URL=http://localhost:3001`
(the in-container backend) and `ATRIUM_API_TOKEN` (from your `.env`) so a terminal
*inside* the container gets the `atrium_*` tools automatically. Mint the token in
Settings → Agent Tokens and put it in `.env` before `docker compose up`.

## Removing

```bash
claude mcp remove atrium
rm -rf ~/.claude/skills/atrium
```

Then revoke the token in the admin UI (or `DELETE /api/agent-tokens/<jti>`).
