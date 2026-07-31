# Installing Atrium

Two supported paths: **Docker** (recommended) and **native** (for developing
Atrium itself). Both self-heal on first boot — every state directory, plus
`settings.json`, `services.json`, and `chat-messages.json`, is created for you.

---

## Docker (recommended)

**Prerequisites:** Docker Desktop, or Docker Engine + Compose v2.

```bash
git clone https://github.com/RogerSquare/atrium.git
cd atrium
cp .env.example .env
docker compose up -d
open http://localhost:3001        # or your ATRIUM_PORT
```

### Required `.env` values

`docker compose up` aborts unless these are set (they have no safe default):

| Var | What it is |
|---|---|
| `JWT_SECRET` | Signs user + agent JWTs. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. Changing it invalidates every login and agent token. |
| `ATRIUM_WORKSPACE` | Absolute host path to the folder holding your repos. Bind-mounted to `/workspace`; this is what the Changes view and the web terminal operate on. |

If you use Claude Code inside the container's terminal, also set
`ATRIUM_CLAUDE_CONFIG` (your `~/.claude`) and `ATRIUM_CLAUDE_JSON` (your
`~/.claude.json`). These are **optional** — omit them (and their volume lines in
`docker-compose.yml`) if you don't. Everything else in `.env.example` is
optional and documented inline.

### Ports

`ATRIUM_PORT` (default `3001`) is the host port. The container always listens on
`3001` internally; `ATRIUM_PORT` only maps the host side, so
`ATRIUM_PORT=3100` → open `http://localhost:3100`. Same-origin means you do **not**
need an `ALLOWED_ORIGINS` entry just because you changed the port.

### Optional compose overrides

Layer these onto the base file with `-f`:

| Override | Purpose |
|---|---|
| `docker-compose.fresh.yml` | Throwaway empty-state sandbox on its own volume/project — try Atrium without touching your data. Set `ATRIUM_PORT` on the CLI. |
| `docker-compose.shared-tasks.yml` | Point the container at a **native** install's live `backend/tasks` + `projects.json` instead of its own volume. Read the file's header first — the risk is lost updates if both instances edit the same task at once. |
| `docker-compose.docker-services.yml` | Add the socket allow-list proxy so `type: container` services can be started/stopped from the board. Restrict names with `ATRIUM_ALLOWED_CONTAINERS`. |

Example: `docker compose -f docker-compose.yml -f docker-compose.docker-services.yml up -d`.

---

## Native (development)

For hacking on Atrium's own code. **Prerequisites:** Node 18+ and a C++
toolchain for `node-pty` (Windows: VS Build Tools; macOS: `xcode-select
--install`; Linux: `sudo apt install build-essential`).

```bash
cd backend && npm install && npm start        # :3001
cd frontend && npm install && npm run dev      # :5173, proxies /api -> :3001
```

Open `http://localhost:5173`. On Windows, `./start.bat` opens both. No config
copying needed — `settings.json` / `services.json` / `projects.json` auto-create
on first boot; the `*.example.json` files are annotated reference templates.

In development, `JWT_SECRET` is auto-generated and persisted to
`backend/.jwt-secret`. In production (`NODE_ENV=production`) it is **required**.

---

## First run

1. **Register** — the first account becomes the **admin** (`routes/auth.js`);
   later accounts are members.
2. **Working directory** — the first-run wizard, or Settings → Project, sets it.
   The container defaults it to `/workspace`.
3. **Connect an agent (optional)** — see [agents.md](agents.md) and [mcp.md](mcp.md).

The first-run wizard is a prompt, not a gate: you can browse the board without
completing it.

---

## Upgrading an existing install

`backend/projects.json`, `backend/settings.json`, and `backend/services.json` are
gitignored — they hold your machine's data, not shipped defaults. If you have an
**older clone where `projects.json` was tracked**, back it up before pulling this
change: git removes the previously-tracked file on merge, and an unmodified
working copy is deleted with it.

```bash
cp backend/projects.json backend/projects.json.bak   # before pulling
git pull                                              # projects.json is now untracked
cp backend/projects.json.bak backend/projects.json    # restore if git removed it
```

A fresh clone has no `projects.json`; the backend starts with an empty registry
and you add projects from the UI.

## Troubleshooting

- **`JWT_SECRET is required`** on `docker compose up` — you didn't fill in `.env`.
- **API is up but the page is blank / 503 "no frontend build"** (native) — run
  `npm run build` in `frontend/`, or use the Vite dev server on `:5173`.
- **PR badges are missing in the Changes view** — set `GH_TOKEN` (needs `repo`
  scope for private repos). Git history still works without it.
- **Port already in use** — another Atrium (or anything on `3001`) is running;
  set `ATRIUM_PORT`.
- **API docs** — Swagger UI is at `http://localhost:<port>/api/docs`.
- **Health** — `GET /api/health` (liveness), `GET /api/health/ready` (readiness),
  `GET /api/instance` (name/version/port/url).
