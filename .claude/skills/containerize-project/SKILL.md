---
name: containerize-project
description: Scaffold a new project or service container-first, or retrofit an existing one. Load when creating a new project, adding a service, registering something in Atrium's services.json, or when asked to containerize / dockerize / "add a Dockerfile". Produces Dockerfile + compose + .dockerignore + .env.example and registers the result as a container service.
---

# Container-first project scaffolding

> **Source of truth:** `atrium/.claude/skills/containerize-project/SKILL.md`.
> The copies in `~/.claude/skills/` and inside the Atrium image are generated
> from it — run `npm run sync:skills` from the atrium repo after editing.
> Do not edit those copies directly; the next sync overwrites them.

Every project that becomes a service ships containerized. This is the default,
not a per-project decision.

**Copyable template** and the full standard live in the **atrium repo**:

- `docs/standards/templates/node-service/` — Dockerfile, compose, dev override,
  `.dockerignore`, `.env.example`
- `docs/standards/container-first-projects.md` — the reasoning, port ranges, and
  the done-checklist

Copy the template rather than writing from scratch when you can reach it. If you
cannot — different machine, different project, repo moved — everything you
actually need is restated below, so this skill stands alone.

Composes with `project-guardrails` (constraints and no-regression discipline);
they cover different things and both may fire on a new build.

## When this applies

- Creating a new project or service
- Adding a service to Atrium's registry
- Being asked to containerize / dockerize an existing project

## When it does NOT apply

Throwaway scripts, one-off experiments, anything expected to be deleted this
week. Containerizing a 20-line script is cargo cult. Skip it, and don't register
it as a service.

---

## Register it as a CONTAINER, not a process

The most common mistake, because older instructions describe the other shape.

```jsonc
// Correct — Atrium drives this through the Docker API
{
  "id": "my-service",
  "name": "My Service",
  "group": "My Project",
  "type": "container",
  "container_name": "my-service",   // must match compose's container_name
  "port": 3200                       // optional; real port read from Docker
}
```

A `{ cwd, startCmd }` entry is a **host process**. It cannot run when Atrium is
containerized — a container cannot spawn a process on its host. Use that shape
only when explicitly asked for a native-only service.

Register via Atrium Settings → Services → **Container**, or
`POST /api/services` with `type: "container"`.

## Ports — check before claiming

| Range | Purpose |
|---|---|
| 3000–3099 | Infrastructure (gitea, portainer, proxies) |
| 3100–3199 | Atrium and its own services |
| 3200–3999 | Application backends |
| 5100–5999 | Application frontends / dev servers |
| 8000–8999 | Third-party tools |

```
netstat -ano | grep ":3200" | grep LISTENING
```

Skipping this is how two services end up bound to the same port with the winner
decided by hostname resolution — `localhost` and `127.0.0.1` can then reach
*different* servers, which is a genuinely confusing afternoon.

---

## The four traps

Each was hit for real. The **symptom** is given because a rule without its
failure mode gets discarded the first time it looks inconvenient.

### 1. `node_modules` must be in `.dockerignore`

**Symptom:** image builds fine, app crashes at runtime with
`Could not load the "sharp" module using the linux-x64 runtime`.

Host `node_modules` hold platform-specific binaries (`@img/sharp-win32-x64` on
Windows). Copied into a Linux image they shadow the correct build.

**Never** run `npm install` inside a container against a read-write bind-mounted
source tree — it overwrites the host's `node_modules` with Linux binaries and
breaks native development as the price of fixing the container.

### 2. `.env.*` swallows `.env.example`

**Symptom:** `git add .env.example` refuses; a fresh clone has no template, and
nobody notices until someone else tries to run the project.

```gitignore
*.env
.env.*
!.env.example
```

Verify with `git ls-files .env.example` — no output means it is not tracked.

### 3. Single-file bind mounts break on atomic writes

**Symptom:** mounts fine, then edits silently stop propagating after the first
write.

Temp-file-then-rename replaces the inode and detaches the mount. Only bind-mount
an individual file if it is written **in place**; otherwise mount the directory.

### 4. Bind-mounted git repos need `safe.directory`

**Symptom:** every git command fails with `detected dubious ownership`. In
Atrium this surfaced as the Changes view rendering **nothing at all, with no
error**, because `lib/github.js` only logs a warning on git failure.

```dockerfile
RUN git config --global --add safe.directory '*'   # after USER
```

---

## Non-negotiables in the Dockerfile

- **Non-root user** — the `node` base images ship a `node` user (uid 1000)
- **No secrets baked in** — they come from `.env` at run time
- **`HEALTHCHECK`** — Node 22 has global `fetch`, so no extra binary is needed
- **`tini` as PID 1** — otherwise child processes accumulate as zombies
- **Named volume for state** — the writable layer is discarded on every rebuild

---

## Verify before calling it done

Run these. Do not tick them from reading the files.

- [ ] `docker compose up -d --build` from a clean clone
- [ ] `docker ps` shows the healthcheck reaching `healthy`
- [ ] `docker compose exec <svc> whoami` is **not** root
- [ ] Data survives `docker compose restart`
- [ ] No secrets in the image:
      `docker history --no-trunc <image> | grep -iE 'key|token|secret|password'`
- [ ] Start / stop / logs all work from the Atrium board
- [ ] `git ls-files .env.example` prints the file

If the service does something only the container reveals — spawning a PTY,
running git, writing state — exercise that specifically. A container that boots
is not a container that works.
