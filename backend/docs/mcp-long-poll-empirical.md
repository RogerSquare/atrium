# Claude Code MCP Tool-Call Timeout — Empirical Findings

_Last probed: 2026-04-23 (PARTIAL — see deferred section below)_

Context: the `atrium_wait_for_next_todo` feature holds an MCP tool call open
while it waits for a `todo` task to appear. The server-side timeout cap must
be set below Claude Code's actual tool-call timeout. That timeout is
**undocumented** in the public Claude Code docs as of 2026-04-23
(only `MCP_TIMEOUT` for server startup is documented, not per-call execution).

This doc captures empirical findings. Retest **at least annually** since
Claude Code behavior may change.

## Test protocol

Install the temporary `atrium_debug_sleep` MCP tool at
`backend/mcp/tools/_debug_sleep.js`. Restart the Atrium backend AND the
Claude Code session that has Atrium's MCP loaded (Claude Code needs to
re-enumerate tools on startup). Then from a fresh Claude Code chat:

```
Call atrium_debug_sleep with seconds=60.
Call atrium_debug_sleep with seconds=300.
Call atrium_debug_sleep with seconds=600.
# If all three succeed, try seconds=1800.
```

Record: did each call return? What error (if any) fired? Did the agent
receive a partial response, hang silently, or see a clean timeout?

## Findings

### Session-of-record (2026-04-23) — DEFERRED

**Tests 1–4 not run in this session.** The implement agent couldn't block its own
current chat for 10+ minutes without disrupting active user work. Tests are
deferred to an operational follow-up run by the human (or a dedicated test
session).

### Planned tests

| Duration | Expected: pass/timeout | Observed | Notes |
|---|---|---|---|
| 60s | pass | not yet tested | — |
| 300s (5min) | ? | not yet tested | — |
| 600s (10min) | ? | not yet tested | — |
| 1800s (30min) | ? | not yet tested | only if 10min passes |

### User-assisted tests (both also pending)

- **ESC cancellation**: start a long block, press ESC mid-block. Does the
  server-side handler get a cancellation signal (e.g., a rejected Promise),
  or does the handler run to completion while the agent has already moved on?
- **Laptop sleep**: start a long block, close the lid for 60s, reopen. Does
  the call survive or fail? Stdio transport is NOT auto-reconnected by
  Claude Code (only HTTP/SSE is).

## Current server-side timeout choice

Without empirical data, **the feature ships with a conservative cap of
270 seconds (~4.5min) for the default request, and an absolute server-side
maximum of 300 seconds (5min) via `ATRIUM_WAIT_MAX_SECONDS` env var**.

- Default per-call timeout: 270s
- Hard cap: 300s (env: `ATRIUM_WAIT_MAX_SECONDS`, override to `600` etc.
  once empirically verified)
- If real tests show Claude Code tolerates 10+ minutes, bump the cap and
  update this doc.

## Removal checklist

Before merging the long-poll feature PR:

- [ ] This doc stays (reference value); `_debug_sleep.js` is DELETED.
- [ ] Final timeout cap decision recorded above.
- [ ] Follow-up task `opt-todo-watcher-resilience-001` captured to actually
      run the probes.
