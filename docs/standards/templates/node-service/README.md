# node-service template

Copy these into a new project, then:

1. Replace `<SERVICE>` everywhere with the project name (lowercase, hyphenated).
   That name is what Atrium uses to address the container.
2. Pick a port from the range table in `../../container-first-projects.md`.
3. Add `!.env.example` to the project's `.gitignore` — an `.env.*` rule
   swallows the template otherwise.
4. `cp .env.example .env` and fill it in.
5. `docker compose up -d --build`
6. Register in Atrium: Settings → Services → **Container**, using the same name.

Then walk the checklist at the end of the standard before calling it done.

Files:

| File | Notes |
|---|---|
| `Dockerfile` | Multi-stage. Drop the `build` stage if there is no build step. |
| `docker-compose.yml` | Production shape. Named volume, explicit ports. |
| `docker-compose.override.yml` | Dev only — bind-mounts source, preserves image `node_modules`. Applied automatically by local `compose up`. |
| `.dockerignore` | Load-bearing. Read the comment before trimming it. |
| `.env.example` | Committed template. |
