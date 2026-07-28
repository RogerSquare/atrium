# System Instructions for Agent: Atrium

You are an autonomous developer agent. Your tasks are stored as Markdown files in the `backend/tasks` directory.

## Project Configuration:
Before creating any new project folders or starting work, check the `backend/settings.json` file for the `workingDirectory` value. Use this as your base path for implementation.

## Service Registration:
If you create a new application or service (Backend or Frontend), you MUST register it in the `backend/services.json` file so the user can control it from the UI.

**New projects are container-first.** Load the `containerize-project` skill and follow `docs/standards/container-first-projects.md`. Register the result as a **container** service:

```json
{
  "id": "unique-service-id",
  "name": "Display Name",
  "group": "Project Name",
  "type": "container",
  "container_name": "my-service",
  "port": 3200
}
```

`container_name` MUST match `container_name` in the project's `docker-compose.yml` — that is how Atrium addresses it. `port` is optional; the real published port is read back from Docker.

**Legacy host-process shape** (only when explicitly asked for a native-only service — it CANNOT run when Atrium itself is containerized, because a container cannot spawn a process on its host):

```json
{
  "id": "unique-service-id",
  "name": "Display Name",
  "group": "Project Name",
  "type": "process",
  "port": 1234,
  "cwd": "C:\Full\Path\To\Project",
  "startCmd": "npm run dev"
}
```

An entry with no `type` is treated as `process` for backward compatibility.

## Service Lifecycle (STRICT):
**NEVER start, stop, or restart services using raw shell commands** (e.g., `cd /path && npx vite --port 1234 &`). This bypasses the service registry, breaks the embedded preview browser, and creates orphaned processes.

You MUST use the backend API to control services:
- **Start**: `POST http://localhost:3001/api/services/<service-id>/start`
- **Stop**: `POST http://localhost:3001/api/services/<service-id>/stop`
- **Restart**: `POST http://localhost:3001/api/services/<service-id>/restart`

The service registry already stores the correct `startCmd`, `cwd`, and `port` for each service. The backend handles Windows compatibility, process tracking, and log capture automatically. If a service is not registered, register it first via `POST http://localhost:3001/api/services` before starting it.

## Lifecycle Management (STRICT):
The backend automatically manages IDs, Timestamps, and the `activity_log`. **DO NOT manually edit the Markdown YAML files directly.** You MUST use the backend API (`PUT http://localhost:3001/api/tasks/<task-id>`) for all task updates (status, assignee, priority, content, tags, project, files_affected, component, type). This ensures the backend properly records your changes in the `activity_log` and updates the timestamps:

**Safe API Usage (CRITICAL):**
When updating a task with complex content (multiple lines, code snippets, or special characters), **DO NOT pass the JSON string directly via CLI/curl.** Doing so often leads to corrupted formatting (e.g., literal `\n` or stripped `>`).
1.  **Use a Temporary JSON File**: Write your update payload to a local `.json` file.
2.  **Use the @ Flag**: Execute your `curl` command using the file reference: `curl -d @update.json`.
3.  **Cleanup**: Delete the temporary file immediately after the update succeeds.

**Batch Task Creation (STRICT):**
When creating multiple tasks at once:
1.  Use ASCII-safe JSON only — avoid Unicode characters in curl payloads.
2.  Limit batches to 10 tasks at a time to catch errors early.
3.  **Verify** each task after creation — confirm the `content` field is populated, not empty.
4.  If tasks are created with empty descriptions, update them immediately before proceeding.

1.  **Task ID (STRICT)**: Every task MUST have an `id` that matches this exact regex:

    ```
    ^(feat|bug|ui|opt|comp|devops|mobile)(-[a-z0-9]+)+-\d{3}$
    ```

    - **Format**: `{category}-{descriptor}-{NNN}` — e.g. `feat-auth-001`, `ui-filters-003`, `mobile-header-002`, `opt-perf-004`, `feat-project-archive-impl-007`.
    - **Category** (required, fixed set):
      - `feat-` — new features
      - `bug-` — bug fixes
      - `ui-` — UI/UX improvements
      - `opt-` — optimization (perf, security, reliability, architecture)
      - `comp-` — component build/refactor
      - `devops-` — infrastructure/deployment
      - `mobile-` — mobile-specific work
    - **Descriptor**: one or more lowercase hyphen-separated segments (a-z 0-9 only; no underscores, no uppercase).
    - **Number**: exactly 3 digits.

    **Enforcement**: `POST /api/tasks` returns **400** if the id is missing or malformed, with `expected_format` + `examples` in the response body. The MCP tool `atrium_create_task` fails the same way before the HTTP round-trip. There is no timestamp fallback — a task must have a valid id to exist.

    **Grandfathering**: tasks whose ids were created before this rule (e.g. `task-1763290321`, or unusual legacy formats) remain fully readable and updatable via GET / PUT / DELETE. Only CREATION is gated on the regex. If you spot a legacy id while working, prefer leaving it alone unless the human explicitly asks to rename.
2.  **Timestamps**:
    - `created_at`: Force-injected on task creation.
    - `started_at`: Automatically set when status moves to `in_progress`.
    - `reviewed_at`: Automatically set when status moves to `review`.
    - `done_at`: Automatically set when status moves to `done`.

## Duplicate Prevention (STRICT):
Before creating any task, **search existing tasks** for similar IDs, titles, or overlapping scope. Use `GET http://localhost:3001/api/tasks?project=<project>` and check for duplicates. If a similar task exists, update it instead of creating a new one.

## How to Work:
1. **Read**: Use the API (`GET http://localhost:3001/api/tasks`) to scan tasks. Note that files might be inside sub-directories which represent "projects". Prioritize files where `priority: high` and `status: todo`.
2. **Start Work**: Use the backend API (`PUT http://localhost:3001/api/tasks/<task-id>`) to change the `status` to `in_progress` AND set `assignee: <Your-Agent-Name>`. This properly logs the activity and signals to the human that you are actively modifying the file.
3. **Dynamic Priority**: If you discover a task is blocked or more complex than expected, use the API to update the `priority` field to `high` or `low` accordingly.

## The Task Lifecycle (STRICT):
You MUST only use the following five statuses. Any other status will cause the task to disappear from the visual board.

1.  **`draft`**: The task is being composed by a human — scope, files_affected, and acceptance criteria are still being refined. **Agents MUST NOT pick up draft tasks.** Only humans promote draft → todo when the spec is ready for dispatch.
2.  **`todo`**: The task is waiting to be started.
3.  **`in_progress`**: You are actively working on this task.
4.  **`review`**: You have finished the work and are requesting human approval. **Agents MUST stop here.**
5.  **`done`**: Only the human may move a task to `done` after reviewing your work.

**Strict Rule**: Never use statuses like 'completed', 'finished', or 'archived'.

**Draft rules (STRICT):**
- When polling for work via `GET /api/tasks?status=todo`, drafts are automatically excluded. Do not bypass this filter.
- Never transition a task directly from `draft → in_progress`. The human must promote it to `todo` first.
- If you encounter a task in `draft` status (e.g. via a direct task lookup), do not start it — return it to the queue.

## Mid-run Approval Checkpoints (STRICT):
When working a task and you hit a genuine ambiguity that would cause significant rework if guessed wrong, emit an approval request instead of picking. The request pauses the task in `waiting_input` until the human responds.

**When to emit an approval (examples):**
- Two non-trivial architectural directions, both defensible — you want the human to pick.
- Before a destructive operation the task description did not explicitly authorize (delete a migration, drop a column, force-push, etc.).
- When a requirement appears self-contradictory or the acceptance criteria omit an edge case you must handle.

**When NOT to emit an approval:**
- For routine formatting, naming, or minor style choices — just pick.
- For any decision the task description already makes ("use jsonwebtoken" — don't ask which library).
- For every step — over-asking defeats the point.

**How to emit an approval:**
```
POST /api/approvals/task/<task-id>
Content-Type: application/json
{
  "prompt": "Run the migration before or after the API deploy?",
  "context": {
    "files": ["backend/migrations/0042.sql"],
    "reasoning": "Migration adds a NOT NULL column; API must tolerate both schemas during rollout.",
    "code_snippet": "ALTER TABLE users ADD COLUMN..."
  },
  "options": ["before", "after", "cancel"]
}
```

The backend flips the task to `waiting_input` and emits a `approvalCreated` event. The human responds via UI; task flips back to `in_progress` with the decision appended to `activity_log`. Re-fetch the task to see the chosen response, then continue execution using it.

**Never** transition a task out of `waiting_input` manually. The approval response handler does it for you.

## Branch & PR Linkage (STRICT):
Atrium's **Changes view** (third segment on the kanban toolbar) is a git-style timeline that groups tasks by category and surfaces the git branch + GitHub PR each task produced. For a task to show its branch and PR badges, you MUST create work on a branch whose name **embeds the task id as a substring** and open a PR from it.

**When to create the branch:** immediately after you transition a task from `todo` → `in_progress`, before editing any code.

**Required commands (from the project's working directory, NOT from `backend/tasks/`):**
```bash
git checkout -b <task-id>                  # e.g. git checkout -b feat-auth-001
# ... make edits, stage, commit referencing the id in the trailer or body ...
git push -u origin <task-id>
gh pr create --title "<type>(<scope>): <summary>" --body "Task: <task-id>\n..."
```

**Branch-name rules:**
- The task id must appear literally somewhere in the branch name. The matcher is case-insensitive and prefers the longest id when multiple match, so prefix or suffix decorations are fine: `feat-auth-001`, `claude/feat-auth-001`, `feat-auth-001-followup` all resolve to `feat-auth-001`.
- Do NOT reuse a branch for multiple tasks. One branch per task keeps the Changes view readable.
- Do NOT land work directly on `main` for tasks tagged with a category prefix (`feat-`, `bug-`, `ui-`, `opt-`, `devops-`, `comp-`, `mobile-`) — the Changes view cannot surface a PR badge for work that never had a branch or PR.

**Commit + PR hygiene:**
- First line of the commit follows conventional-commit style: `<type>(<scope>): <summary>`.
- Include a `Task: <task-id>` trailer so the id is grep-able from `git log` even if the branch is deleted.
- The PR body should reference the task id, summarize the user-visible change, and include a test plan.

**What the Changes view does with this:**
- Each task renders on a vertical lane keyed by its category prefix (bug / feat / ui / opt / devops / comp / mobile) — not by branch.
- The right-hand side of each row shows a branch badge (links to the GitHub branch page) and a PR badge color-coded by state (green = OPEN, purple = MERGED, red = CLOSED).
- Backend endpoint: `GET /api/github/links?project=<id>&refresh=1`. Results are cached for 5 minutes; add `?refresh=1` after landing a PR if you want an immediate update.
- Tasks with `status: draft` are filtered out of the view entirely — drafts are not "changes" yet.

**When this rule does NOT apply:**
- Projects whose `workingDirectory` is not a GitHub repo (no `origin` remote, or a non-github.com remote). The Changes view still renders as a category timeline, but without branch/PR badges.
- Meta tasks that don't touch code (e.g. `opt-` tasks that only update documentation or `.md` files inside `backend/tasks/`). A no-op PR is acceptable but not required — call it out in the task's Comments if you skip the branch.

**Explicit override (when the branch-name convention doesn't fit):**
Add one or both of these optional fields to the task's YAML frontmatter and the backend links the task directly, bypassing the substring match:

```yaml
---
id: feat-project-archive-impl-007
title: Implement archive / restore for projects
...
github_branch: feat-project-archive-007     # bare branch name, no URL needed
github_pr_url: https://github.com/RogerSquare/atrium/pull/5   # optional; fills in PR badge + review state even if the branch is deleted locally
---
```

- `github_branch` takes a bare branch name. The backend builds the URL, cross-references the PR list, and pulls in state + review decision automatically.
- `github_pr_url` can stand alone — the backend parses the PR number from the URL, looks it up in `gh pr list`, and uses the PR's head branch as the lane. Useful for tasks whose local branch has already been deleted after merge.
- If both fields are present, `github_branch` wins for the branch badge; `github_pr_url` wins for the PR badge.
- If the named branch doesn't exist locally AND no PR references it, the row still renders with a muted **branch-missing** badge so you see the override is in place but unresolved — it does NOT silently fall back to substring matching.

**When to override vs. rename the branch:**
- **Rename the branch** when the mismatch happened at cut time and the PR is still active — keeps the convention intact for every future task.
- **Use `github_branch` / `github_pr_url`** when the branch is already merged/closed, or the branch legitimately can't fit the full id (phased-task `-plan-` / `-impl-` segments dropped, legacy branches pre-dating the convention, shared branches that cover multiple related tasks).

## Pre-Review Checklist (STRICT):
Before moving a task to `review`, you MUST complete the following checks:

### 1. Testing
- [ ] Run existing tests (`npm test`) and confirm all pass — **do not submit with failing tests**
- [ ] If you added a new API endpoint, verify it works with a curl test
- [ ] If you modified existing functionality, verify it still works as before

### 2. Branch & PR (ENFORCED on review transition)
**The backend now returns 400 on `PUT /api/tasks/:id` when transitioning to `review` without linkage. See `backend/lib/branchValidator.js`.**

- [ ] Work is on a branch whose name contains the task id as a **case-insensitive substring** (e.g. `feat/feat-auth-001` for task `feat-auth-001`) — this satisfies the validator
- [ ] Branch is pushed to `origin`
- [ ] PR is open, title follows conventional-commit style, body references the task id
- [ ] `github_branch` and/or `github_pr_url` are set on the task — **required**. Either field alone satisfies the validator; `github_pr_url` is the strongest signal.
- [ ] For **non-code tasks** (docs-only, pure-research, plan-only, config tweaks with no PR), add the `no-code` tag to opt out of the validator before moving to review.
- [ ] After pushing the final commit, hit `GET /api/github/links?project=<id>&refresh=1` (or the Refresh button in the Changes view) so the badge reflects current state

### 3. Security (for backend/API changes)
- [ ] New endpoints have proper auth (requireAuth / optionalAuth / public — choose deliberately)
- [ ] Input is validated (reject missing/invalid params with 400)
- [ ] Error responses do NOT leak stack traces or internal details
- [ ] Rate limiting is applied if the endpoint is public-facing
- [ ] Audit logging is added for state-changing operations (create, update, delete)

### 4. Mobile/Responsive (for frontend/UI changes)
- [ ] Test at mobile viewport width (375px) — no horizontal overflow
- [ ] Interactive elements have minimum 44px touch targets
- [ ] Fixed/sticky elements don't overlap scrollable content
- [ ] Bottom tab bar (if present) doesn't cover content

### 5. Cleanup Completeness (for database/file changes)
- [ ] If you added a new file field (e.g., `preview_path`, `analysis_path`), update ALL delete/cleanup paths
- [ ] If you added a new DB table/column, update the migration in db.js
- [ ] If you added a new column to images, check: single delete, bulk delete, user purge, orphan cleanup

### 6. Docker/Deployment (if applicable)
- [ ] If the project has a Dockerfile, verify the build still works
- [ ] Test with production env vars (NODE_ENV=production)
- [ ] No hardcoded paths that won't work in containers

### 7. Lint
- [ ] Run `npm run lint` (if configured) and fix any errors (warnings are acceptable)

## Wiki Documentation (STRICT):
When a task ships something **another agent or human would need to know to reuse it**, you MUST add or update an entry in `r-that-wiki` (the Starlight site at `C:\Users\RogerSquare\Documents\opencode\rog-wiki`, published to https://wiki.r-that.com) **before moving the task to `review`**. The wiki is the durable knowledge layer; task comments are transient context.

**What triggers a wiki entry (examples):**
- A new reusable UI component, hook, or utility that other pages/services could import
- A new architectural or integration pattern the codebase didn't have before (auth flow, rate limit strategy, background job shape, federation pattern, etc.)
- A non-obvious snippet that solved a real problem (shell one-liner for deploy, nginx config, SQL trigger, etc.)
- A new API endpoint whose contract, auth posture, or side effects are non-obvious

**What does NOT trigger a wiki entry:**
- Bug fixes that restore existing documented behavior
- Internal refactors that don't change the external contract
- Styling tweaks, copy changes, dependency bumps
- One-off debugging work that didn't produce a reusable pattern
- Anything already covered by an existing wiki page — **update the existing page instead of creating a duplicate**
- **Atrium-internal features that are tightly coupled to this repo's task/kanban model** and would not make sense to lift into another project (e.g. a kanban view that reads Atrium's `activity_log`, a setting tied to Atrium's `projects.json`). The r-that-wiki is a *cross-project* knowledge base; Atrium-shaped work belongs in this `CLAUDE.md`, in-code comments, and the task's Comments — not in the public wiki. When invoking this carve-out, add a bullet to the task's Comments explaining why (e.g. `- **Wiki:** skipped — feature is tightly coupled to Atrium's task model, not reusable elsewhere`).

**Where the entry lives:**
- `r-that-wiki/src/content/docs/components/<slug>.mdx` — reusable UI pieces
- `r-that-wiki/src/content/docs/patterns/<slug>.mdx` — architectural/integration patterns
- `r-that-wiki/src/content/docs/snippets/<slug>.mdx` — small copy-pasteable code/config blocks
- Slug: lowercase, hyphenated, descriptive (`sanitize-safe-path`, not `fix-001`).

**Required page shape (match existing entries):**
```markdown
---
title: Short human-readable title
description: One sentence someone skimming the sidebar can use to decide whether to click.
---

> **Source:** [repo/path/to/file.js](https://github.com/RogerSquare/<repo>/blob/main/<path>) — what this file is · [repo/path/to/other.js](...) — related
> **Category:** Pattern — auth  (or Component — layout, or Snippet — shell, etc.)

**<Name>** — one-sentence summary that leads with the tradeoff or key idea.

## What it is
Concrete, 2-4 sentences. No marketing voice.

## Why it exists
State the problem first, then the fix. If it's a pattern, name the alternatives you rejected.

## <Domain section(s)>
Code blocks, file paths, gotchas, example config — whatever a reuser needs to copy the pattern without re-reading the source.

## Gotchas / when not to use (if applicable)
```

**Sidebar registration (STRICT):**
The Starlight sidebar in `r-that-wiki/astro.config.mjs` is **hand-maintained** — adding a file is not enough; the slug must be added to the right `items:` array. Components/Patterns/Snippets are each grouped by sub-category (e.g. `Auth & security`, `Data & storage`). Pick the group that best fits; if none fit, flag it in the task comment and ask the human which group to extend or create.

**Build + deploy workflow:**
1. `cd C:\Users\RogerSquare\Documents\opencode\r-that-wiki`
2. `npm run dev` — preview locally at `http://localhost:4321` while writing
3. `npm run build` — generates `dist/`
4. `scp -P 2200 -r dist/* root@r-that.com:/var/www/wiki/` — deploy (already allow-listed in `settings.local.json`)
5. Verify the new entry loads at `https://wiki.r-that.com/<category>/<slug>/`

**Pre-Review Checklist addendum:**
Before moving a qualifying task to `review`, you MUST also confirm:
- [ ] Wiki entry created or updated under the correct category
- [ ] Sidebar entry added to `astro.config.mjs`
- [ ] `npm run build` succeeds with no broken-link warnings for the new slug
- [ ] Entry deployed to the VPS and verified at `wiki.r-that.com`
- [ ] The task's `### Comments` block includes a bullet like: `- **Wiki:** added/updated https://wiki.r-that.com/<category>/<slug>/`

**When in doubt — ask, don't skip.** If you're unsure whether something is wiki-worthy, err toward documenting it and surface the call in the task's approval checkpoint ("Wiki entry for X — worth documenting, or keep it internal?"). Under-documentation costs future agents far more than over-documentation costs you.

## Acceptance Criteria (STRICT):
Every task description MUST include specific, testable acceptance criteria. Use checkboxes:
```markdown
### Description
- [ ] Specific behavior 1
- [ ] Specific behavior 2
- [ ] Edge case handled
```
If a task is reopened because the implementation didn't match expectations, **update the description** with clarified criteria before restarting work.

## Dependency Tracking:
When a task modifies shared code (e.g., drag handlers, CSS layout, database schema, API response format), note in the task description which other features it may affect. Use the `parent_task` field for hierarchical dependencies and add a note in the description for lateral dependencies:
```markdown
**Affects**: feat-reorder-001 (shares drag event handlers), ui-grid-001 (same CSS container)
```

**Graph view edges**: the Graph view renders `parent_task` as a **solid arrow** (hierarchy) and `depends_on` as a **dashed arrow** (cross-project deps in amber). The `**Affects**:` line above is for human readers only — it is **not** parsed into graph edges. Populate `depends_on: [<id>, ...]` for any "blocked by" relationship you want to surface visually, not just phase chains. See the atrium skill ("Dependencies and the graph view") for the full guidance.

## Feature Engineering & Breakdown:
To optimize development, follow these architectural rules:
1.  **Categorization**: Every task MUST be tagged with a `type`: `frontend`, `backend`, `fullstack`, or `devops`.
2.  **Component-Based Task Generation**: When initiating a *new project* or large feature set, you MUST NOT create broad, generic tasks (e.g., "Build Backend", "Build UI"). Instead, you must immediately break the project down into granular tasks based on the specific **components** needed.
    - Identify core components (e.g., `App.jsx`, `Board.jsx`, `TaskCard.jsx`, `server.js`, `database`).
    - Create an individual task via the API for *each* identified component.
    - Ensure each task accurately utilizes the `component` field and lists specific files in the `files_affected` property.
3.  **Atomic Tasks**: If a specific component or feature is still too large, break it down further into sub-tasks. Use the `parent_task` field to link sub-tasks to the main feature ID.
4.  **Checklists**: Use Markdown checkboxes (`- [ ]`) in the description for sub-feature tracking. Update these as you progress.
5.  **Traceability**: Always list the exact file paths you plan to modify in the `files_affected` field.

## Phased Tasks (STRICT):
Non-trivial work should be split into three sequential phases via the `phase-research` / `phase-plan` / `phase-implement` tag. The goal: no agent jumps from "I read the description" to "I'm writing code" without an explicit research and plan step in between. Use the `phase-research`, `phase-plan`, and `phase-implement` templates from `backend/templates/`.

**For UI redesigns and refactors specifically**, invoke the `redesign-intake` skill at the start of `phase-research` (skill lives at `.claude/skills/redesign-intake/SKILL.md`). It produces a single intake document with a Design Direction section (external reference research with provenance-flagged tokens) and a Preservation Contract section (literal + implicit + uniqueness affordance survey). The contract closes the knowledge-gap failure mode where requestors forget to mention features they assume will keep working — the `BulkActionBar` and per-project Archive regressions during the recent facelift are the canonical failure cases this skill is built to catch.

**When you are assigned a task with tag `phase-research`:**
- Do NOT make an implementation plan.
- Do NOT write any code.
- Do NOT modify any source files (only update the task markdown).
- Return file paths with line numbers, existing patterns, and open questions ONLY.
- Move to `review` when findings are complete; the human decides if a plan task should follow.

**When you are assigned a task with tag `phase-plan`:**
- Read the research task referenced in `depends_on[0]` FIRST. If `depends_on` is empty, STOP and ask the human to link the research task.
- Share open questions and a phase outline with the human BEFORE writing the full plan.
- Produce a phased plan (Phase 1, Phase 2, …) with specific file edits, per-phase verification, and a rollback note.
- Do NOT write implementation code.
- Do NOT modify source files.

**When you are assigned a task with tag `phase-implement`:**
- Read the plan task referenced in `depends_on[0]` FIRST. The plan is the source of truth.
- Execute phase by phase in order. Run tests/lint/build at each phase boundary.
- Do NOT re-plan. Do NOT expand scope. If the plan is wrong, move the task back to review with a note — do not silently absorb the deviation.
- Capture any follow-ups as notes in the task's Comments; those become separate tasks later.

**General rules for phased tasks:**
- The `type` field (frontend/backend/fullstack/devops) still applies — it describes the kind of code being touched, not the phase.
- Phases are chained via `depends_on` (runtime pointer) and optionally `parent_task` (metadata).
- If a task has no `phase-*` tag, it is a regular single-phase task and these rules do not apply.

## Worker-loop mode (atrium_wait_for_next_todo)

The MCP tool `atrium_wait_for_next_todo` long-polls for tasks promoted to `todo` and atomically claims them (status → `in_progress`, assignee → caller). Use this when the user asks you to "watch" for tasks or "pick them up as they arrive". Loop: call tool → emit `Picked up <id>: <title>` → execute → call tool again. Server caps each call at ~5min (env `ATRIUM_WAIT_MAX_SECONDS`, default 300s); timeouts return `{ task: null, timeout: true }` — just re-call. Full spec in the Atrium skill at `~/.claude/skills/atrium/skill.md`.

## Test-Driven Development (opt-in via `tdd` tag)

For tasks tagged `tdd`, `phase-implement` follows red-green-refactor (inspired by Matt Pocock's tdd skill — github.com/mattpocock/skills/tree/main/tdd). Opt-in because docs, config, memory, and visual UI tweaks have no meaningful test surface.

**The loop:**
1. **Test list** from the plan → confirm with the human (via `atrium_create_approval`) if priority isn't obvious.
2. **Tracer bullet**: write ONE test for ONE behavior, verify it FAILS (red), write minimal code to pass (green), commit.
3. **Incremental loop**: repeat red → green per behavior, one at a time. Never refactor while red.
4. **Refactor at green**: extract duplication / deepen modules only once tests pass. Rerun tests after each refactor step.

**Anti-pattern — DO NOT DO**: "horizontal slicing" (all tests up front, then all code). It produces tests of imagined behavior that pass when real behavior breaks.

**Per-cycle checklist**: test names behavior not implementation · uses public interface only · survives internal refactor · production code is minimal · the test was RED before GREEN.

**Escape hatches**: no testable surface (note in comment, proceed) · user waives TDD explicitly · codebase untestable in the relevant area (STOP, `atrium_create_approval`, do not write bad tests against a bad seam).

TDD does NOT override existing phase rules, branch/PR/review rules, or the closing checklist. The full detailed spec lives in the Atrium skill at `~/.claude/skills/atrium/skill.md` under "Test-Driven Development".

## Format of the Text Files
Each task is a `.md` file with extended YAML frontmatter.

```markdown
---
id: feat-auth-001
title: Implement JWT Login
status: in_progress
priority: high
project: (Project Name)
assignee: Agent-FE
type: frontend
component: Auth Service
tags: [react, jwt, api]
parent_task: feature-user-management
files_affected: [src/components/Login.jsx, src/api/auth.js]
---

**Note:** Always specify the `project` field. If omitted, the task will be assigned to the "Root" project by default.

## Project Folder Semantics (STRICT):
The UI displays the `Root` folder as **"Unassigned"** in the Projects sidebar (see `frontend/src/components/Sidebar.jsx` — `folder === 'Root' ? 'Unassigned' : projName`). This is intentional: tasks without a specific project home belong there.

- **"Unassigned" project in UI** = `project: "Root"` in the task YAML, stored at `backend/tasks/*.md` (top-level, not in a subfolder)
- **Named project in UI** = `project: "<ProjectName>"` in the task YAML, stored at `backend/tasks/<ProjectName>/*.md`

When a user asks to "create an unassigned task" or "put this in the unassigned folder", they mean `project: "Root"`, NOT a named project with the task's `assignee` field left empty. The `assignee` field and the `project` field are independent concepts:
- **Unassigned** (no owner): `assignee` is empty or null
- **Unassigned project** (no project bucket): `project: "Root"`

**To move an existing task to the Unassigned/Root project**, use the API:
```
PUT /api/tasks/<task-id>  with body { "project": "Root" }
```
The backend will physically move the file from the subfolder to the top-level `backend/tasks/` directory.

**Archived projects** live under `backend/tasks/.archived/<ProjectName>/` — the dot-prefix keeps them out of the task scanner's walk (see `backend/lib/tasks.js scanDirectory`). Registry entries for archived projects stay in `projects.json` with `archived: true` + `archived_at: ISO`. `Root` is never archivable.

## Archived Projects (STRICT):
A project can be archived (soft-retired) via `POST /api/projects/:idOrName/archive`. Archive physically moves the folder to `backend/tasks/.archived/<ProjectName>/` and flips `archived: true` in the registry. Restore via `POST /api/projects/:idOrName/unarchive` reverses both the folder move and the flag. Both endpoints are idempotent.

**Agent contract (STRICT):**
- `GET /api/projects` default-excludes archived projects. Pass `?include=archived` to list only archived, `?include=all` for both.
- `GET /api/tasks` default-excludes tasks belonging to archived projects. Pass `?include=archived` or `?include=all` to opt in.
- `POST /api/tasks` returns **403** if the target project is archived. Agents MUST NOT create tasks in archived projects.
- `PUT /api/tasks/:id` returns **403** if the task's current project is archived, or if the update would move the task INTO an archived project. Agents MUST NOT transition tasks in archived projects.
- When you encounter a task in an archived project via a direct-by-id lookup (outside the default queue), return it to the queue — do NOT silently absorb or pick it up.
- The `Root` project cannot be archived. `POST /api/projects/root/archive` returns 400.

**When to archive:** shipped side projects, completed experiments, repos you don't want cluttering the sidebar. Archive is reversible — use it freely in place of delete unless you actually want the tasks gone.

**When NOT to archive:** active work, even if paused briefly. Use the task-level `status: draft` or `status: waiting_input` for short-term freezes; archive is for multi-week+ dormancy.

### Description
Implement the login form and token storage.
- [x] Create UI Form
- [ ] Connect to backend API
- [ ] Implement secure localStorage wrapper

**Affects**: feat-session-001 (shares auth context)

### Comments
```

## Commenting Rules (STRICT):
When you finish a task (or make a significant checkpoint), you MUST append a comment under the `### Comments` section in the task's `content` property using the `PUT` API. Follow this EXACT nested bullet structure:

- **[Agent]**: <High-level summary in simple English (1-2 sentences). No technical jargon.>
  - **Reasoning**: <Brief justification of *why* this approach was chosen or why this specific code was necessary.>
  - **Changes**:
    ```<language>
    <Concise snippet of the most critical code added/changed. Do not dump the whole file.>
    ```

**Important**: Ensure you indent the "Reasoning" and "Changes" bullet points with exactly two spaces so they nest properly under your main summary bullet.

## Common Pitfalls (Lessons Learned):
These are real issues encountered in production projects. Avoid them:

1. **CSS `overflow: hidden` breaks `position: sticky`** — if a parent has overflow hidden, sticky children won't work. Use flex layout with a scrollable middle section instead.
2. **Express 5 uses new path-to-regexp** — `app.get('*', ...)` doesn't work. Use `app.use((req, res, next) => ...)` for catch-all routes.
3. **Inline styles override Tailwind classes** — `style={{ padding: '16px' }}` beats `pb-20`. Use CSS classes or `!important` in a stylesheet for responsive overrides.
4. **Drag events bubble** — adding drag-upload on a parent element will intercept child drag-and-drop (reorder). Check `e.dataTransfer.types.includes('Files')` to differentiate external file drops from internal reorder drags.
5. **`useEffect` dependency typos** — `}, [theme])` instead of `}, [gridSize])` causes silent bugs. Always verify the dependency matches the state being saved.
6. **Docker volume paths** — Windows paths need special handling. Use env vars for DB paths, not hardcoded absolute paths.
7. **JWT secrets** — never hardcode fallback secrets. Generate on first boot, require via env var in production.
8. **`readFileSync` blocks the event loop** — use `createReadStream` for file hashing or any large file operation.
9. **ONNX model compatibility** — onnxruntime-node on Windows may not support newer ONNX opsets. Use Python subprocess as a fallback.
10. **Fixed elements eat viewport space** — when using fixed top/bottom bars on mobile, the scroll container must account for their height via padding or reduced container height.
