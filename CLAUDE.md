# System Instructions for Agent: Atrium

You are an autonomous developer agent. Your tasks are stored as Markdown files in the `backend/tasks` directory.

## Project Configuration:
Before creating any new project folders or starting work, check the `backend/settings.json` file for the `workingDirectory` value. Use this as your base path for implementation.

## Service Registration:
If you create a new application or service (Backend or Frontend), you MUST register it in the `backend/services.json` file. This allows the user to control the service from the UI.

**Registration Schema:**
```json
{
  "id": "unique-service-id",
  "name": "Display Name",
  "group": "Project Name",
  "port": 1234,
  "cwd": "C:\\Full\\Path\\To\\Project",
  "startCmd": "npm run dev"
}
```

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

1.  **Task ID**: You MUST provide a human-readable `id` when creating tasks via the API. Use the format `{category}-{descriptor}-{number}`, for example: `feat-auth-001`, `ui-filters-003`, `mobile-header-002`, `opt-perf-004`. Common category prefixes:
    - `feat-` — new features
    - `comp-` — component build/refactor
    - `ui-` — UI/UX improvements
    - `opt-` — optimization (perf, security, reliability, architecture)
    - `bug-` — bug fixes
    - `devops-` — infrastructure/deployment
    - `mobile-` — mobile-specific work

    If no `id` is provided, the backend falls back to auto-generating `task-{timestamp}` — avoid this.
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
You MUST only use the following four statuses. Any other status will cause the task to disappear from the visual board.

1.  **`todo`**: The task is waiting to be started.
2.  **`in_progress`**: You are actively working on this task.
3.  **`review`**: You have finished the work and are requesting human approval. **Agents MUST stop here.**
4.  **`done`**: Only the human may move a task to `done` after reviewing your work.

**Strict Rule**: Never use statuses like 'completed', 'finished', or 'archived'.

## Pre-Review Checklist (STRICT):
Before moving a task to `review`, you MUST complete the following checks:

### 1. Testing
- [ ] Run existing tests (`npm test`) and confirm all pass — **do not submit with failing tests**
- [ ] If you added a new API endpoint, verify it works with a curl test
- [ ] If you modified existing functionality, verify it still works as before

### 2. Security (for backend/API changes)
- [ ] New endpoints have proper auth (requireAuth / optionalAuth / public — choose deliberately)
- [ ] Input is validated (reject missing/invalid params with 400)
- [ ] Error responses do NOT leak stack traces or internal details
- [ ] Rate limiting is applied if the endpoint is public-facing
- [ ] Audit logging is added for state-changing operations (create, update, delete)

### 3. Mobile/Responsive (for frontend/UI changes)
- [ ] Test at mobile viewport width (375px) — no horizontal overflow
- [ ] Interactive elements have minimum 44px touch targets
- [ ] Fixed/sticky elements don't overlap scrollable content
- [ ] Bottom tab bar (if present) doesn't cover content

### 4. Cleanup Completeness (for database/file changes)
- [ ] If you added a new file field (e.g., `preview_path`, `analysis_path`), update ALL delete/cleanup paths
- [ ] If you added a new DB table/column, update the migration in db.js
- [ ] If you added a new column to images, check: single delete, bulk delete, user purge, orphan cleanup

### 5. Docker/Deployment (if applicable)
- [ ] If the project has a Dockerfile, verify the build still works
- [ ] Test with production env vars (NODE_ENV=production)
- [ ] No hardcoded paths that won't work in containers

### 6. Lint
- [ ] Run `npm run lint` (if configured) and fix any errors (warnings are acceptable)

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
