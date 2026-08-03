# Architecture

The map a contributor needs before touching code. Everything here describes
the shipped system — where state lives, what talks to what, and which
seams are load-bearing. Pointers go to source files; the source headers
carry the fine print.

## The one-paragraph version

Atrium is a **file-backed task board**: every task is a markdown file with
YAML frontmatter under the data dir, the Express backend
(`backend/server.js`) is the sole writer, and the React SPA
(`frontend/src`) is a live view over REST + socket.io. Agents talk to the
same REST API — directly or through the bundled MCP server — under the same
lifecycle rules as humans, with one deliberate asymmetry: agents can never
flip a task to `done` and must stop at `review`.

```
┌─ browser SPA (React/Vite) ─┐        ┌─ agents (Claude Code, …) ─┐
│  REST + socket.io          │        │  MCP server → REST        │
└──────────────┬─────────────┘        └─────────────┬─────────────┘
               ▼                                    ▼
┌──────────────────────── backend/server.js ────────────────────────┐
│  routes/*  (REST)     sockets/*  (chat, presence, preview,        │
│  lib/*     (domain)               web-shell PTYs)                 │
│  runners/* (test adapters)   mcp/ (stdio MCP server)              │
└──────┬──────────────┬───────────────┬────────────────┬────────────┘
       ▼              ▼               ▼                ▼
  data dir       host processes   Docker proxy     node-pty
  (markdown,     (Services,       (allow-listed    (web shell)
   JSON state)    native only)     socket sidecar)
```

## The data-dir model

`backend/lib/dataDir.js` (devops-docker-datadir-001). All mutable state
hangs off **one root**, `ATRIUM_DATA_DIR`, defaulting to `backend/` itself —
which reproduces the historical native layout exactly. A container mounts a
single volume instead of a dozen bind mounts.

Under the root: `tasks/` (the markdown files, one folder per project, plus
`.archived/` and `.history/`), `chat/`, `agent-tokens/`, `approvals/`,
`autoenter/`, `uploads/`, `settings.json`, `services.json`. Per-file env
overrides exist for the odd cases; see the module header.

Two rules follow from files-as-database:

1. **The backend is the only writer.** Direct edits to task markdown bypass
   the activity log, the socket broadcasts, and the in-memory task index —
   which is why every doc says "use the API". A stale index after an
   out-of-band write is a known failure shape (bug-approvals-stale-index-001).
2. **Sharing state = sharing the directory.** The shared-tasks compose
   override points the container at the native backend's tasks dir so both
   instances see one board. Approvals are per-instance (not shared) — an
   approval created on one instance cannot be answered on the other.

## Task lifecycle enforcement

The board's five statuses (`draft → todo → in_progress → review → done`,
plus `waiting_input` for mid-run approvals) are **enforced in the backend**,
not by convention:

- `backend/lib/branchValidator.js` — a task cannot enter `review` without
  `github_branch`/`github_pr_url` linkage (or a `no-code` tag). Branch names
  must contain the task id as a substring.
- `backend/lib/e2eValidator.js` — UI-touching tasks additionally need
  `e2e_status: 'passing'` (or a `no-e2e` tag) to enter `review`.
- Task ids are gated at creation against
  `^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$`.
- `atrium_wait_for_next_todo` long-polls and **atomically claims** promoted
  tasks (`lib/taskWaiters.js`), so two watching agents never grab the same
  card.

## Auth: three token kinds, one middleware

`backend/lib/authMiddleware.js`:

- **User JWTs** — minted at login, 24 h expiry, role/permissions re-read
  from the user file on every request.
- **Agent tokens** — `{ agent: true, jti, name }`, minted by admins
  (Settings → Agent tokens, or `POST /api/agent-token`), non-expiring by
  default, optional `expires_in_days`, revocable via a JTI blocklist.
- **Socket handshakes** — `lib/socketAuth.js` authenticates every socket.io
  connection *before* any handler runs (devops-socket-auth-001). Without it,
  the web-shell would be an unauthenticated remote PTY. Kill-switch:
  `ATRIUM_SOCKET_AUTH=off` (probes and tests only).

Rate limits: 300/min global, 5/min auth, 10/min batch. Behind a reverse
proxy, set `ATRIUM_TRUST_PROXY` (`lib/trustProxy.js`) or the auth limiter
keys every client to the proxy's address. CORS policy lives in
`lib/corsPolicy.js`: same-origin always allowed, `ALLOWED_ORIGINS` for real
cross-origin, missing-Origin (curl/MCP/agents) passes without a CORS grant.

## Service surfaces

The Services manager (`routes/services.js` + `services.json`) starts,
stops, and health-checks the user's *other* projects. Two entry types:

- **`process`** — spawn by `cwd` + `startCmd` on the host. Native only: a
  container cannot spawn a process on its host, so `lib/features.js` gates
  the whole surface (`ATRIUM_FEATURE_SERVICES`, default on; flags read as
  on unless explicitly off — a typo fails safe toward current behavior).
- **`container`** — control an existing Docker container by name. Works
  from inside the Atrium container *through the allow-list proxy* (below),
  never by mounting the raw Docker socket into Atrium itself.

`featureSnapshot()` is logged at boot and served at `/api/features` so the
frontend can explain which kinds of service this instance can act on.

## The Docker allow-list proxy

`docker/socket-allowlist-proxy.js` — a sidecar that owns the Docker socket
and forwards only an enumerated set of request shapes (inspect, start,
stop, restart, logs; plus the five job shapes below). Everything else is
403 + logged. `ALLOWED_CONTAINERS` narrows control to named containers —
empty means *any container on the host*, and the proxy warns loudly at boot
when that is the case. Atrium's backend gets `DOCKER_HOST=tcp://proxy:2375`
and never sees the real socket.

## Runner adapters (the Tests tab)

`backend/runners/` (feat-runner-* series). A project declares suites in
`atrium.tests.json`; `runners/index.js` orchestrates, adapters normalize:

- **Report formats**: `playwright-json`, `junit-xml`
  (`runners/junitCmd.js`, dependency-free parser), `exit-code`.
- **Targets**: `local` (spawn on the host — note Windows runs commands via
  cmd.exe, so POSIX `VAR=1 cmd` prefixes silently don't apply),
  `container:<image>` (ephemeral `atrium-job-*` containers through the
  proxy's job capability, gated by `ATRIUM_RUNNER_IMAGES`, source bind-
  mounted read-only, report streamed back between sentinel markers over
  the logs endpoint), `ssh:<host>` (remote exec; the XCUITest path).

Results attach to tasks as `e2e_run` records with provenance
(`source`/`suite`), which is what the e2e validator and the Tests tab read.

## Sockets

One socket.io server, four handler families, all behind socket auth:
`sockets/chat.js`, `sockets/presence.js` (who is viewing which task),
`sockets/preview.js`, `sockets/web-shell.js`. The web-shell speaks
`webshell:*`-prefixed events and multiplexes **N PTYs per socket** keyed by
`taskId` (background task shells survive navigation; a cap evicts the
oldest). The prefix is historical — it once coexisted with a second,
unprefixed terminal stack, deleted in opt-dead-terminal-stack-001.

Task mutations broadcast `task_updated` / `task_created` / `task_deleted`,
which is how every open browser stays live without polling (a 5-minute
poll remains as a backstop).

## The MCP server

`backend/mcp/` — a stdio MCP server whose tools (`atrium_list_tasks`,
`atrium_get_task`, `atrium_update_task`, `atrium_create_approval`,
`atrium_run_tests`, …) are thin wrappers over the REST API using
`ATRIUM_URL` + `ATRIUM_API_TOKEN`. It holds no state and enforces nothing
itself — the backend is the authority, so a raw-REST agent and an MCP agent
get identical rules. List responses are paginated
(opt-tasks-pagination-001); the web UI deliberately fetches unpaginated.

## Frontend shape

Vite + React 19, Tailwind 4. The shell is `components/shell/AppShell.jsx`:
top bar (project anchor, view switcher, approvals bell), one **side dock**
with a single occupant (shell > chat > task detail), and a mobile tab bar
under 768 px (`hooks/useIsMobile.js` exports the one breakpoint token).
Data flows from `hooks/useTasks.js` (fetch + socket merge + filters) through
`TaskContext`. Views: Board / List / Changes / Graph / Loops / Demos.

E2e specs (`frontend/tests/e2e/`) run fully mocked — 
`helpers/session.js` seeds a forged-but-decodable JWT and blocks
`**/socket.io/**`, so specs are hermetic even with a real backend running
on the dev box.

## Where to start reading

| If you want to change… | Start at |
|---|---|
| Task fields, lifecycle, validation | `backend/lib/tasks.js`, `routes/tasks.js` |
| Board/UI layout | `frontend/src/components/shell/AppShell.jsx` |
| Auth or exposure posture | `lib/authMiddleware.js`, `lib/socketAuth.js`, [security-remote.md](security-remote.md) |
| Test runners | `backend/runners/index.js`, [testing-junit.md](testing-junit.md), [testing-swift.md](testing-swift.md) |
| Agent behavior | [agents.md](agents.md), [mcp.md](mcp.md), `backend/mcp/` |
| Containers & compose | [install.md](install.md), `docker/socket-allowlist-proxy.js` |
