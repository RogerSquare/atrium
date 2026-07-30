---
name: atrium
description: Orchestrate the Atrium task board. Load when the user mentions Atrium, tasks, task status, task tracking, task orchestration, managing projects, or when the user wants work tracked and documented. Provides lifecycle rules, approval checkpoints, and MCP tools for creating and updating tasks.
---

# Atrium Agent Playbook

You are interacting with **Atrium** — a local task board at http://localhost:3001 backed by markdown files and an HTTP API. Work you do should be tracked there so the human can observe progress from the web UI. Use the `atrium_*` MCP tools for all task operations. **Do not write directly to markdown files under `backend/tasks/`.**

**Domain terms** — when a word's meaning is unclear (e.g. "approval", "unassigned", "phase"), consult the project's `UBIQUITOUS_LANGUAGE.md` (for Atrium: `atrium/UBIQUITOUS_LANGUAGE.md`). For projects without one, invoke the `ubiquitous-language` skill to extract a starting glossary from the current conversation.

## Task lifecycle (STRICT)

Valid statuses, in order:

1. **`draft`** — being composed by a human (or by you, pending human promotion). Agents MUST NOT pick up draft tasks as work. You may create tasks in draft status and ask the human to promote.
2. **`todo`** — ready to start.
3. **`in_progress`** — actively being worked.
4. **`waiting_input`** — paused for a mid-run human decision (see Approvals below). Set automatically by `atrium_create_approval`.
5. **`review`** — work finished, awaiting human approval. **Agents MUST stop here.**
6. **`done`** — only humans flip to done.

**Never**:
- Move `draft → in_progress` directly. Human must promote to `todo` first.
- Move a task to `done`.
- Bypass the `review` gate.

## Task format

Each task has:

- `id` (e.g. `feat-auth-001`, `bug-login-002`, `opt-perf-003`) — format: `{category}-{descriptor}-{number}`
- `title`, `status`, `priority` (low/medium/high)
- `project` (e.g. "Atrium", "Cairn", "Artifex"); "Root" = unassigned
- `type` — one of: `frontend`, `backend`, `fullstack`, `devops` (describes kind of code, NOT workflow phase)
- `tags` — free-form; workflow phases live here: `phase-research`, `phase-plan`, `phase-implement`
- `component`, `files_affected`, `parent_task`, `depends_on`
- `content` — markdown body with `### Description`, optional sections, `### Comments`

## Task content format (STRICT)

Every task's `content` field MUST follow this structure. No freeform prose.

### Required sections

```markdown
### Description
Brief scope statement, then acceptance criteria as checkboxes:
- [ ] Uncompleted criterion
- [x] Completed criterion
- [ ] Another criterion

**Affects**: feat-other-001 (optional cross-reference to related tasks)

### Comments
```

### Rules

1. **`### Description`** — always required. Contains scope + `- [ ]` / `- [x]` checkboxes for every testable acceptance criterion. Mark `[x]` when shipped; leave `[ ]` for deferred items.
2. **`### Comments`** — always required, always last. Agents append here using `atrium_append_comment` with the structured format below. Never write freeform text in comments.
3. **`**Affects**: <task-id>`** — include in Description when a task impacts or depends on another task (beyond `depends_on` metadata).

### Comment format (when using `atrium_append_comment`)

Every comment MUST follow this nested-bullet structure:

```markdown
- **[agent:<name>]**: High-level summary in 1-2 sentences.
  - **Reasoning**: Brief justification of why this approach was chosen.
  - **Changes**:
    ```<language>
    Concise snippet of the most critical code added/changed.
    ```
```

Indent `Reasoning` and `Changes` with exactly two spaces for proper nesting. Do NOT dump entire files — show only the critical change.

### Template-first rule

- **Prefer `atrium_from_template`** over `atrium_create_task` — templates scaffold the right sections automatically.
- When using `atrium_create_task` directly, the `content` param MUST still include `### Description` (with checkboxes) and `### Comments`.

## Dependencies and the graph view

The Graph view (one of the top-level views alongside Board / List / Changes) renders tasks as a force-directed graph. Edges come from two task fields — populate them when they're true so the graph shows real relationships instead of isolated dots:

- **`parent_task: <id>`** → **solid arrow** from parent to child. Use for true hierarchical relationships (sub-task of a feature, child step of a multi-part task). Intra-project by convention.
- **`depends_on: [<id>, ...]`** → **dashed arrow** from this task to each dep. Use for any "blocked by" relationship — **not just phase chains**. Cross-project deps render in amber and stretch farther so they don't pull clusters together; intra-project deps stay short.

The `**Affects**: <id>` markdown line in the Description is for **human readers only** — it is **not** parsed into graph edges. If you want a relationship to surface visually, it must go in `depends_on` (or `parent_task` for hierarchies). Keep `**Affects**:` for impact notes that aren't a hard "blocked by".

**Default rule**: when creating or updating a task, if completing this task requires another task to be done first, add that task's id to `depends_on`. Empty arrays are common today only because the original docs limited `depends_on` to the research → plan → implement chain — that limit no longer applies.

### Git branching (STRICT)

Every task that produces code changes MUST use a dedicated branch. **Never commit directly to `main`.** **Never merge to `main` yourself — the human reviews and merges.**

#### Creating a branch

**Always branch from the latest `main`** — stale branches cause merge conflicts when the human merges other PRs first.

```
git checkout main
git pull origin main        # ← get any PRs the human merged since last time
git checkout -b <branch>    # ← branch from the UPDATED main
```

1. **Create a branch** when claiming the task:
   - Bug fixes: `fix/<task-id>` (e.g., `fix/bug-loom-003`)
   - Features: `feat/<task-id>` (e.g., `feat/feat-loom-019`)
   - Optimizations: `opt/<task-id>` (e.g., `opt/opt-loom-001`)
2. **Implement on the branch.** All commits go here.
3. **Verify** (tests, clippy, tsc, build) on the branch.
4. **Push the branch**: `git push origin <branch>`.
5. **Create a PR** via `gh pr create --base main --head <branch>` with a summary of changes.
6. **Set `github_branch`** on the Atrium task to the feature branch name.
7. **Set `github_pr_url`** on the Atrium task to the PR URL returned by `gh pr create`.
8. **Do NOT merge.** The human reviews the PR and merges when satisfied.

#### Keeping branches conflict-free

If a PR has been sitting open while the human merged other PRs, **rebase before asking for review**:

```
git checkout main
git pull origin main
git checkout <open-branch>
git rebase main
# resolve any conflicts, then:
git push origin <open-branch> --force-with-lease
```

**Why conflicts happen:** Two branches that modify the same file region (e.g., both append CSS after the same rule) will conflict when one is merged and the other is still based on the old `main`. Rebasing replays the branch's commits on top of the updated `main`, resolving the conflict once and keeping the PR mergeable.

**Rule of thumb:** Run `git pull origin main` before EVERY `git checkout -b`. If in doubt, rebase.

This ensures `main` only receives human-approved code and each task's changes are reviewable via PR.

### `no-code` tag (opt-out for non-code tasks)

Tasks that don't ship code (docs-only, pure-research, plan-only, config tweaks with no PR) should be tagged `no-code` BEFORE moving to review. This opts them out of the branch-linkage validator described in the closing checklist below.

### `no-e2e` tag (opt-out for code tasks without UI surface)

Tasks that ship code but have no testable UI surface (backend-only changes, refactors, infrastructure, build config) should be tagged `no-e2e` BEFORE moving to review. This opts them out of the Playwright e2e validator (`backend/lib/e2eValidator.js` in atrium). Without it, the validator requires `e2e_status === 'passing'` on the `→ review` transition. Mirrors the `no-code` opt-out pattern.

### Closing checklist (before moving to `review`)

When finishing a task, ensure ALL of these are set:

1. `files_affected` — list actual files touched (not empty).
2. **`github_branch` (or `github_pr_url`) — ENFORCED** by the backend for review transitions. Branch name MUST contain the task ID as a case-insensitive substring (e.g., `fix/bug-loom-003` for task `bug-loom-003`). If you hit a 400 with `github_branch required`, either fix the branch name OR set `github_pr_url` OR add the `no-code` tag and retry.
3. `github_pr_url` — strongest signal; accepted alone without a branch.
4. All completed acceptance criteria marked `- [x]`.
5. At least one structured comment logged via `atrium_append_comment`.
6. Branch pushed and PR created via `gh pr create`. Do NOT merge — human reviews.
7. **`e2e_status === 'passing'` — ENFORCED** by the backend on review transitions. Run `cd frontend && npm run test:e2e` from the project's working directory; once green, set `e2e_status: 'passing'` via `atrium_update_task`. If the task has no testable UI surface (backend-only, refactor, infra), add the `no-e2e` tag instead.

## Phased tasks (STRICT)

Non-trivial work splits into three sequential phases via tags:

**`phase-research`** — you read the codebase and report findings:
- Return file paths + line numbers, existing patterns, open questions.
- Do NOT write an implementation plan.
- Do NOT write code. Do NOT modify source files.

**`phase-plan`** — consumes a completed research task (via `depends_on[0]`):
- Read the research task FIRST (use `atrium_get_task`).
- Surface open questions to the human BEFORE writing the full plan.
- Produce a phased implementation plan with per-phase verification.
- Do NOT write code.

**`phase-implement`** — consumes a completed plan task:
- Read the plan FIRST. The plan is the source of truth.
- Execute phase by phase; run tests/lint/build at boundaries.
- Do NOT re-plan. Do NOT expand scope.
- If the plan is wrong, move task back to review with a note — do not silently absorb deviations.

After finishing a research or plan task, call `atrium_continue_task` to spawn the next phase with context injected.

## Worker-loop mode (atrium_wait_for_next_todo)

For sessions where the user plans to compose tasks in the Atrium UI and have the agent pick them up as they land, use the `atrium_wait_for_next_todo` MCP tool. The tool **long-polls** — the agent's turn stays open while the backend holds the request; when a matching task is promoted to `todo`, the backend returns it already claimed (status set to `in_progress`, assignee set to the caller).

**Invocation prompt** the user will typically paste:
> Use the atrium skill. Watch for new todo tasks (assignee=agent:<my-name>) and work on them as they arrive.

**The loop (when the user asks to "watch" or "pick up tasks as they arrive"):**

1. Call `atrium_wait_for_next_todo({ assignee: '<your-agent-name>', timeout_seconds: 270 })`. Optionally include `project` to filter.
2. On response with a task: emit a short visible line to the user — `Picked up <task-id>: <title>` — then execute the task per its phase rules (research / plan / implement or single-phase).
3. When done (task moved to review), call `atrium_wait_for_next_todo` again to keep watching. Stop only if the user says to, or if several consecutive timeouts indicate nothing's coming.
4. On response with `{ task: null, timeout: true }`: just call again. Timeouts are normal; they bound the HTTP request, not the work.

**Notes**:
- The tool atomically claims the task before returning, so two watching agents won't pick up the same task.
- An unassigned task matches any assignee filter — so agents can grab unassigned work too.
- Server-side cap is 300s (env: `ATRIUM_WAIT_MAX_SECONDS`). Default per-call is 270s. Keep re-calling.

## Test-Driven Development (opt-in via `tdd` tag)

Inspired by Matt Pocock's tdd skill (github.com/mattpocock/skills/tree/main/tdd). When a task has the `tdd` tag, follow red-green-refactor inside `phase-implement`. The tag is opt-in because docs, config, memory updates, and visual UI tweaks have no testable surface — don't force the loop on them.

**Why**: from _The Pragmatic Programmer_, "the rate of feedback is your speed limit." TDD stops the LLM from outrunning its headlights by making every production line answer to a failing test.

**The loop (strict when `tdd` tag is present):**

1. **Confirm the test list**: from the plan, enumerate behaviors to test at public interfaces. If the priority order is non-obvious, gate with `atrium_create_approval` before writing any test.
2. **Tracer bullet**: write ONE test for ONE behavior. Run it — verify it FAILS (red). Write minimal code to make it pass (green). Commit.
3. **Incremental loop**: for each remaining behavior, red → green, one at a time. Never refactor while red.
4. **Refactor at green**: once a cycle is green, extract duplication or deepen modules. Run tests after each refactor step.

**Anti-pattern — DO NOT DO**: writing all tests up front, then all implementation ("horizontal slicing"). This produces tests of *imagined* behavior — they pass when real behavior breaks and fail on harmless refactors. Always one-at-a-time, vertical slices.

**Per-cycle checklist:**
- [ ] Test names the behavior, not the implementation
- [ ] Test uses the public interface only (no private methods, no internal collaborators mocked)
- [ ] Test would survive an internal refactor
- [ ] Production code is minimal — no speculative features added
- [ ] The test was RED before it was GREEN (you saw the failure, not inferred it)

**Escape hatches** — leaving the loop is allowed when:
- The task has no testable behavior (docs-only, config-only, skill/CLAUDE.md edits, memory updates). Note the reason in a comment and proceed normally.
- The user waives TDD explicitly via the task description or a mid-run message.
- The codebase is untestable in the relevant area (shallow modules, hard-to-mock deps). **STOP**, flag to the human via `atrium_create_approval` — do not silently write bad tests against a bad seam.

**What this does NOT override**: existing phase rules (no re-planning or scope expansion in implement), the branch/PR/review rules, the closing checklist.

## Approval checkpoints (mid-run human decisions)

Call `atrium_create_approval` when you hit a genuine ambiguity that would cause significant rework if guessed wrong. Examples:

- Two non-trivial architectural directions, both defensible.
- Before a destructive operation the task didn't explicitly authorize.
- When acceptance criteria omit an edge case you must handle.

**Do NOT** emit approvals for:
- Routine formatting / naming / minor style.
- Decisions the task description already makes.
- Every step — over-asking defeats the point.

The tool transitions the task to `waiting_input`. After the human responds in the UI, re-fetch the task with `atrium_get_task` to see the chosen option, then continue.

## When to auto-create tasks (heuristic)

- **Multi-step request** ("let's build X", "I want to refactor Y") → **offer to create a draft task**. Wait for human confirmation, then create with status `draft`. Human promotes to `todo` when scope feels right.
- **Specific task ID mentioned** ("work on feat-x-001") → fetch it, confirm, start.
- **One-off question / read-only lookup** ("how does X work?") → do NOT create a task. No overhead for casual use.

## MCP tool cookbook

**Starting work:**
```
atrium_list_tasks(status: "todo")     → see what's pickable
atrium_get_task(id: "feat-x-001")     → load context
atrium_update_task(id: "feat-x-001", fields: { status: "in_progress", assignee: "agent:<your-name>" })
```

**Logging progress (use structured comment format):**
```
atrium_append_comment(id: "feat-x-001", comment: "- **[agent:claude-opus-4-6]**: Phase 1 complete — auth service + JWT middleware.\n  - **Reasoning**: Split login from token refresh to keep middleware stateless.\n  - **Changes**:\n    ```ts\n    // auth.service.ts\n    export async function login(creds) { ... }\n    ```")
```

**Finishing (set files_affected + github fields, then review):**
```
atrium_update_task(id: "feat-x-001", fields: {
  status: "review",
  files_affected: ["src/auth.service.ts", "src/middleware/jwt.ts"],
  github_branch: "main",
  github_pr_url: "https://github.com/org/repo"
})
```

**Mid-run approval:**
```
atrium_create_approval(
  task_id: "feat-x-001",
  prompt: "Run migration before or after API deploy?",
  options: ["before", "after", "cancel"],
  context: { files: ["db/migrations/0042.sql"], reasoning: "..." }
)
# task now in waiting_input; poll with atrium_get_task to see the response
```

**Phase pipeline:**
```
# After finishing a phase-research task
atrium_continue_task(id: "feat-x-001")   # spawns feat-x-001-plan with research injected
```

**Creating a phased task from scratch:**
```
atrium_from_template(
  template_id: "phase-research",
  overrides: { title: "Refactor auth middleware", project: "Atrium" }
)
```

## Quick reference — tools

| Tool | Purpose |
|---|---|
| `atrium_list_tasks` | Filter by status/project/assignee |
| `atrium_get_task` | Full task detail |
| `atrium_create_task` | New task (defaults to draft). Content MUST use `### Description` (checkboxes) + `### Comments` format. Prefer `atrium_from_template` instead. |
| `atrium_update_task` | Change fields. On `review`: set `files_affected`, `github_branch`, `github_pr_url`. |
| `atrium_append_comment` | Add to Comments. MUST use structured format: `**[agent:name]**:` → `**Reasoning**:` → `**Changes**:` |
| `atrium_create_approval` | Pause for human decision |
| `atrium_continue_task` | Spawn next phase of a phased task |
| `atrium_list_templates` / `atrium_from_template` | Scaffolded task creation |
