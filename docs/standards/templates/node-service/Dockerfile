# Template: Node service, container-first standard.
# Replace <SERVICE> and the port. Delete the frontend stage if there is no build.
#
# Two stages so the toolchain needed to compile native modules never reaches the
# runtime image. If the project has no native dependencies you can collapse
# these, but keeping them costs nothing and survives the first `npm i sharp`.

# --- deps: install with a full toolchain so native modules compile for LINUX ---
FROM node:22-bookworm AS deps
WORKDIR /build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
# Manifests first so this layer caches on dependency changes, not source edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- build: only if the project has a build step (vite, tsc, etc.) ------------
FROM node:22-bookworm AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Add only what the service actually needs at runtime. git is required if the
# app shells out to it; drop it otherwise.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# node_modules come from the deps stage — NEVER from the build context. The
# host's copy holds platform-specific binaries that cannot load here.
COPY --from=deps /build/node_modules ./node_modules
COPY . .
# Uncomment if using the build stage:
# COPY --from=build /build/dist ./dist

# The `node` user (uid 1000) ships with the base image.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

# Only needed if the service runs git against bind-mounted host repos —
# without it every git command fails with "dubious ownership".
# RUN git config --global --add safe.directory '*'

ENV NODE_ENV=production \
    PORT=3200

EXPOSE 3200
VOLUME ["/data"]

# Node 22 has global fetch, so no extra binary is needed to answer this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# tini as PID 1 so child processes are reaped rather than left as zombies.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
