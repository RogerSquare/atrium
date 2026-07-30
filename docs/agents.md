# Connecting an agent

Atrium's task board is driven entirely over a REST API. **Any** agent — Claude
Code, another LLM harness, a script, a human with `curl` — can participate by
following the contract below. Claude Code gets first-class ergonomics through the
[MCP server](mcp.md) and the bundled skill, but nothing here requires it.

The authoritative, exhaustive protocol is [`CLAUDE.md`](../CLAUDE.md) at the repo
root. This page is the minimum an integrator needs.

---

## 1. Authenticate

Mint an **agent token** in the UI: Settings → Agent Tokens (admin only). It is
shown once. Agent tokens are long-lived and revocable by `jti`.

Send it as a bearer token on every request:

```bash
curl -H "Authorization: Bearer $ATRIUM_TOKEN" http://localhost:3001/api/tasks
```

Verify a token with `GET /api/verify`. Discover the instance (name, version,
port, reachable URL) with `GET /api/instance` — use it instead of hard-coding a
URL.

## 2. The task lifecycle

Six statuses, and only these:

```
draft → todo → in_progress → waiting_input → review → done
```

- **draft** — being composed. Agents MUST NOT start drafts. A human promotes
  `draft → todo`.
- **todo** — ready to pick up.
- **in_progress** — an agent is working it (set `assignee`).
- **waiting_input** — paused on a human decision (an *approval*).
- **review** — work finished; **agents stop here**.
- **done** — human-only.

Two transitions are human-only: `draft → todo` (promotion) and `review → done`
(approval). Don't skip `draft → in_progress`.

## 3. Do the work

```
GET  /api/tasks?status=todo         # find work (drafts are excluded)
GET  /api/tasks/:id                 # load full context
PUT  /api/tasks/:id                 # claim: { "status": "in_progress", "assignee": "agent:my-bot" }
PUT  /api/tasks/:id                 # progress: content, files_affected, tags, ...
POST /api/tasks                     # create (id must match the format below)
```

**Task id format** (enforced on create): `^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$`
— e.g. `feat-auth-001`, `bug-login-002`.

Leave a structured comment when you finish a chunk (append to the task's
`### Comments`). See `CLAUDE.md` for the exact comment shape.

## 4. The review gate

`PUT /api/tasks/:id` with `status: "review"` is **validated**. It requires:

1. **A git branch or PR** whose name contains the task id (`github_branch` or
   `github_pr_url` on the task) — unless the task is tagged **`no-code`**.
2. **A passing e2e run** (`e2e_status: "passing"`) — unless the task is tagged
   **`no-e2e`**.

So for a docs-only or backend-only task with no UI, tag it `no-code` and/or
`no-e2e` before moving to review. These two tags are the escape hatches; without
them the gate returns `400`.

## 5. Approvals (optional)

When you hit an ambiguity a human should resolve, create an approval instead of
guessing:

```
POST /api/approvals/task/:id
{ "prompt": "...", "options": ["a", "b", "cancel"], "context": { ... } }
```

The task moves to `waiting_input`; poll `GET /api/tasks/:id` for the chosen
option, then continue.

---

## Real-time

The board broadcasts changes over Socket.IO. Connecting a socket **requires the
same JWT** — pass it in the handshake: `io(url, { auth: { token } })`. An
unauthenticated socket is rejected (the terminals it can open are real shells).

## Full protocol

Phased tasks (research → plan → implement), TDD, branch/PR conventions, the
worker-loop long-poll (`atrium_wait_for_next_todo`), archived projects, and the
structured comment format are all in [`CLAUDE.md`](../CLAUDE.md). Interactive API
reference: `http://localhost:<port>/api/docs`.
