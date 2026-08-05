# Atrium container image (devops-docker-image-001).
#
# Three stages, for one reason: node-pty is a native module and needs a full
# C++ toolchain to compile, but shipping python3/make/g++ in the runtime image
# would roughly double its size for no runtime benefit. So the toolchain lives
# in a build stage and only the compiled artifacts are copied forward.
#
# The result is a single image serving both the API and the built SPA on one
# port (see backend/lib/staticSite.js), with all mutable state rooted at
# ATRIUM_DATA_DIR (see backend/lib/dataDir.js) so a container mounts one volume.

# ---------------------------------------------------------------------------
# Stage 1 — native dependencies
# ---------------------------------------------------------------------------
# Full bookworm (not slim): node-pty's node-gyp build needs python3, make, and
# g++. `npm ci` here produces a node_modules with node-pty compiled for LINUX —
# copying the Windows host's node_modules would ship a .node binary the
# container cannot load.
FROM node:22-bookworm AS native-deps

WORKDIR /build/backend

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Copy manifests first so this layer caches on dependency changes only, not on
# every source edit.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

# The MCP server is a SEPARATE package with its own dependency
# (@modelcontextprotocol/sdk) and its own lockfile. It was previously missed
# entirely: .dockerignore strips every node_modules, and nothing installed
# these, so `node backend/mcp/server.js` in a container terminal died on
# MODULE_NOT_FOUND — the atrium_* tools simply never loaded for any agent
# working inside the container.
WORKDIR /build/backend/mcp
COPY backend/mcp/package.json backend/mcp/package-lock.json ./
RUN npm ci --omit=dev
WORKDIR /build/backend

# ---------------------------------------------------------------------------
# Stage 2 — frontend build
# ---------------------------------------------------------------------------
# Needs devDependencies (vite, tailwind, the react plugin), so no --omit=dev.
FROM node:22-bookworm AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# git + gh: required by backend/lib/github.js for the Changes view.
# bash:      the interactive shell for the web-shell terminal
#            (backend/lib/shellDefaults.js resolves /bin/bash on non-win32).
# tini:      PID 1 that reaps children — PTYs and spawned claude processes
#            would otherwise accumulate as zombies.
# ca-certificates + curl: TLS roots and the gh apt-repo fetch below.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git bash tini ca-certificates curl gnupg \
 && mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && apt-get purge -y --auto-remove gnupg \
 && rm -rf /var/lib/apt/lists/*

# Claude Code CLI. backend/lib/claudeBin.js resolves it via PATH (`which
# claude`) after checking ~/.local/bin, so a global npm install is found.
# The ARG is a deliberate cache-buster: Docker caches this layer, so with the
# self-updater disabled below the CLI would otherwise drift stale forever.
# Refresh with:  docker compose build --build-arg CLAUDE_CODE_VERSION=<ver|latest>
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} \
 && npm cache clean --force

# The install above runs as root but the container runs as `node` (uid 1000),
# so the CLI's self-updater can never write /usr/local/lib/node_modules — it
# fails with EACCES and every web-shell session shows "Auto-update failed".
# Containers update via image rebuild (the install line always fetches
# latest), so disable self-update outright. Web-shell PTYs inherit this via
# `...process.env` (backend/sockets/web-shell.js).
ENV DISABLE_AUTOUPDATER=1

WORKDIR /app

# Compiled node_modules from stage 1 — NOT reinstalled here, so the runtime
# image never needs the toolchain.
COPY --from=native-deps /build/backend/node_modules ./backend/node_modules
COPY backend/ ./backend/
# Must come AFTER `COPY backend/`, or the source copy would overwrite it.
COPY --from=native-deps /build/backend/mcp/node_modules ./backend/mcp/node_modules

# Built SPA from stage 2. staticSite.js defaults to ../frontend/dist relative
# to backend/, which this layout satisfies.
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# CLAUDE.md is source, not state — constants.js INSTRUCTIONS_FILE reads it from
# the repo root, one level above backend/. (It replaced the deleted
# instructions.md in devops-agent-contract-001; the optional per-operator
# CLAUDE.local.md overlay is untracked and deliberately NOT baked in.)
COPY CLAUDE.md ./CLAUDE.md

# Agent skills, baked in so they travel with the IMAGE rather than depending on
# whatever the host's ~/.claude happens to contain. A container started from
# this image on any machine has them.
#
# Interaction with the compose mount, stated plainly: docker-compose.yml mounts
# the host's ~/.claude over /home/node/.claude read-only, which SHADOWS this
# copy. That is fine and intended for the normal setup — the host's skills are
# richer (atrium, project-guardrails, ...) and shadowing them would lose the
# task-lifecycle skill. Mounting per-skill instead does not work: the parent
# mount is read-only, so Docker cannot create a mountpoint for a skill the host
# does not already have.
#
# So this copy is the fallback that makes the image self-sufficient: run
# WITHOUT the .claude mount and the skills are still there.
COPY .claude/skills /home/node/.claude/skills

# The `node` user (uid 1000) ships with the base image. /data is the volume
# mount point; create and chown it so the non-root user can write on first boot
# even when the volume is empty.
RUN mkdir -p /data /workspace \
 && chown -R node:node /app /data /home/node/.claude

USER node

# Bind-mounted host repos are owned by a different uid than `node`, so git
# refuses them with "detected dubious ownership" and every command fails.
# lib/github.js only logs a warning on git failure, so without this the
# Changes view silently renders no branch/PR badges with no visible cause.
#
# '*' rather than a fixed path because the workspace mount point is the
# operator's choice; the container is single-tenant and only ever sees
# repositories its operator deliberately mounted.
RUN git config --global --add safe.directory '*'

ENV NODE_ENV=production \
    PORT=3001 \
    ATRIUM_DATA_DIR=/data \
    ATRIUM_SHELL=/bin/bash

EXPOSE 3001
VOLUME ["/data"]

# Node 22 has global fetch, so the healthcheck needs no extra binary.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1. Without it, node runs as PID 1 and does not reap orphaned
# children — every terminal session and spawned agent would leak a zombie.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/server.js"]
