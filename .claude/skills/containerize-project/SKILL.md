---
name: containerize-project
description: Scaffold a new project or service container-first, or retrofit an existing one. Load when creating a new project, adding a service to Atrium, registering something in services.json, or when asked to containerize / dockerize / "add a Dockerfile". Produces Dockerfile + compose + .dockerignore + .env.example and registers the result as a container service.
---

# Container-first project scaffolding

Every project that becomes a service ships containerized. The full rationale,
port ranges, and done-checklist live in `docs/standards/container-first-projects.md`
in the atrium repo — read it if you need the reasoning. This skill is the
executable version.

**Copy the template** from `docs/standards/templates/node-service/` rather than
writing files from scratch. It already encodes everything below.

## When this applies

- Creating a new project or service
- Adding a service to Atrium's registry
- Being asked to containerize / dockerize an existing project

## When it does NOT apply

Throwaway scripts, one-off experiments, anything you expect to delete this week.
Containerizing a 20-line script is cargo cult. Skip it and don't register it.

---

## Register it as a CONTAINER, not a process

This is the part most likely to be got wrong, because the older instructions
describe the other shape.

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

A `{ cwd, startCmd }` entry is a **host process**. It cannot run when Atrium
itself is containerized — the container has no way to spawn a process on its
host. Only use that shape when explicitly asked for a native-only service.

Register via Settings → Services → **Container**, or
`POST /api/services` with `type: "container"`.

---

## The four traps

Each was hit for real. The **symptom** is given because a rule without its
failure mode gets discarded the first time it looks inconvenient.

### 1. `node_modules` must be in `.dockerignore`

**Symptom:** image builds fine, app crashes at runtime with
`Could not load the "sharp" module using the linux-x64 runtime`.

Host `node_modules` hold platform-specific binaries (`@img/sharp-win32-x64` on
Windows). Copied in, they shadow the correct Linux build.

**Never** run `npm install` inside a container against a read-write bind-mounted
source tree — it overwrites the host's `node_modules` and breaks native dev.

### 2. `.env.*` swallows `.env.example`

**Symptom:** `git add .env.example` refuses; a fresh clone has no template.

```gitignore
*.env
.env.*
!.env.example
```

Verify with `git ls-files .env.example` — if it prints nothing, it is not tracked.

### 3. Single-file bind mounts break on atomic writes

**Symptom:** mounts fine, then edits silently stop propagating after the first write.

Temp-file-then-rename replaces the inode and detaches the mount. Only bind-mount
an individual file if it is written **in place**; otherwise mount the directory.

### 4. Bind-mounted git repos need `safe.directory`

**Symptom:** every git command fails with `detected dubious ownership`. In Atrium
this surfaced as the Changes view rendering **nothing, with no error**, because
`lib/github.js` only warns on git failure.

```dockerfile
RUN git config --global --add safe.directory '*'   # after USER
```

---

## Ports

Pick from the band in the standard and **check it is free first**:

```
netstat -ano | grep ":3200" | grep LISTENING
```

Backends 3200–3999, frontends 5100–5999, Atrium 3100–3199, infra 3000–3099.

Skipping this check is how two services end up bound to the same port, with the
winner decided by hostname resolution — a genuinely confusing failure.

---

## Verify before moving the task to review

Do not tick these from reading the files. Run them.

- [ ] `docker compose up -d --build` from a clean clone
- [ ] `docker ps` shows the healthcheck reaching `healthy`
- [ ] `docker compose exec <svc> whoami` is **not** root
- [ ] Data survives `docker compose restart`
- [ ] No secrets in the image:
      `docker history --no-trunc <image> | grep -iE 'key|token|secret|password'`
- [ ] Start / stop / logs all work from the Atrium board
- [ ] `git ls-files .env.example` prints the file

If the service does something at runtime that only the container reveals —
spawning a PTY, running git, writing state — exercise that specifically. A
container that boots is not a container that works.
