# Container-first project standard

Every new project ships containerized from its first commit. This exists because
the alternative was tested: Atrium itself was retrofitted, and five of nine
registered services still cannot be started from a containerized board because
they have no image.

**Decisions taken** (open questions from `devops-project-container-standard-001`):

| Question | Decision | Why |
|---|---|---|
| Per-project compose, or one shared stack? | **Per-project** | Matches how Artifex already runs. A project stays independently startable, and one broken stack cannot block the others. Cross-project networking is rare enough to solve when it appears. |
| Hand-assigned ports, or documented ranges? | **Documented ranges** (below) | The Artifex/Atrium collision on 3002 was a direct symptom of ad-hoc assignment — two things bound the same port and which one answered depended on how the hostname resolved. |
| Hot reload in dev? | **Ship a `docker-compose.override.yml`** | Rebuild-on-change is too slow for frontend work. The override bind-mounts source; compose applies it automatically for local dev and ignores it in CI. |

## Port ranges

Pick the next free port **within your project's band** and record it in the
project README. Bands exist so a new project never silently collides with a
running one.

| Range | Purpose |
|---|---|
| 3000–3099 | Infrastructure (gitea, portainer, proxies) |
| 3100–3199 | Atrium and its own services |
| 3200–3999 | Application backends |
| 5100–5999 | Application frontends / dev servers |
| 8000–8999 | Third-party tools |

Check before claiming: `netstat -ano | grep ":<port>" | grep LISTENING`

## Required files

Copy from `templates/node-service/`. Four files, no exceptions:

1. **`Dockerfile`** — multi-stage if there's a build step. Slim runtime base.
   **Non-root user.** `HEALTHCHECK`. No secrets baked in, ever.
2. **`docker-compose.yml`** — `container_name` matching the project, so Atrium can
   address it. Ports published explicitly. State in a **named volume**, never the
   container's writable layer.
3. **`.dockerignore`** — see the traps below; this file is load-bearing, not hygiene.
4. **`.env.example`** — committed. Real `.env` gitignored.

## The four traps

Each of these was hit for real during Atrium's containerization. They are listed
with their **symptom**, because a rule without its failure mode gets discarded
the first time it seems inconvenient.

### 1. `node_modules` must be `.dockerignore`d

**Symptom:** the image builds fine, then the app crashes at runtime with
`Could not load the "sharp" module using the linux-x64 runtime`.

Host `node_modules` contain platform-specific binaries — `@img/sharp-win32-x64`
on a Windows host. Copying them into a Linux image ships binaries that cannot
load. Worse, they *shadow* the correct ones installed during the build.

Corollary: never run `npm install` inside a container against a **read-write
bind-mounted** source tree. It overwrites the host's `node_modules` with Linux
builds and breaks native development as the price of fixing the container.

### 2. `.env.*` in `.gitignore` also swallows `.env.example`

**Symptom:** `git add .env.example` refuses; a fresh clone has no template to
copy from, and nobody notices until someone else tries to run the project.

Add an explicit negation:

```gitignore
*.env
.env.*
!.env.example
```

### 3. Single-file bind mounts break on atomic writes

**Symptom:** the file mounts correctly, then edits stop propagating after the
first write — silently.

An app that writes via temp-file-then-rename replaces the inode, which detaches
the mount. Only bind-mount an individual file if it is written **in place**.
Prefer mounting the containing directory.

### 4. Bind-mounted git repos need `safe.directory`

**Symptom:** every git command fails with
`detected dubious ownership in repository`, and in Atrium's case the Changes
view rendered **no branch or PR badges at all with no visible error**, because
`lib/github.js` only logs a warning on git failure.

Host repos are owned by a different uid than the container user. Add to the
Dockerfile, after `USER`:

```dockerfile
RUN git config --global --add safe.directory '*'
```

## Register it in Atrium

Settings → Services → **Container**:

- **Container Name** — must match `container_name` in your compose file
- **Port** — optional; the real published port is read back from Docker

Then verify from the board: status shows `running`, stop works, start works,
logs appear.

Atrium must be running with the docker-services override for this to be
available:

```
docker compose -f docker-compose.yml -f docker-compose.docker-services.yml up -d
```

## Before calling it done

- [ ] `docker compose up -d --build` works from a clean clone
- [ ] Healthcheck reaches `healthy` (`docker ps` shows it)
- [ ] Container runs as **non-root** (`docker compose exec <svc> whoami`)
- [ ] Data survives `docker compose restart`
- [ ] No secrets in the image (`docker history --no-trunc <image> | grep -i -E 'key|token|secret|password'`)
- [ ] Start / stop / logs all work from the Atrium board
- [ ] `.env.example` is actually tracked (`git ls-files .env.example`)

## When NOT to containerize

Throwaway scripts, one-off experiments, and anything you expect to delete within
the week. The standard is for things that become services. Containerizing a
20-line script is cargo cult — skip it and don't register it.
