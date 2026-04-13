---
name: atrium
description: Orchestrate the Atrium task board. Load when the user mentions Atrium, tasks, task status, task tracking, task orchestration, managing projects, or when the user wants work tracked and documented. Provides lifecycle rules, approval checkpoints, and MCP tools for creating and updating tasks.
---

# Atrium Agent Playbook

You are interacting with **Atrium** — a local task board at http://localhost:3001 backed by markdown files and an HTTP API. Work you do should be tracked there so the human can observe progress from the web UI. Use the `atrium_*` MCP tools for all task operations. **Do not write directly to markdown files under `backend/tasks/`.**

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

**Logging progress:**
```
atrium_append_comment(id: "feat-x-001", comment: "- Phase 1 done. Verified. Moving to Phase 2.")
```

**Finishing:**
```
atrium_append_comment(id: "feat-x-001", comment: "### Summary ...")
atrium_update_task(id: "feat-x-001", fields: { status: "review" })
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
| `atrium_create_task` | New task (defaults to draft) |
| `atrium_update_task` | Change fields (status, priority, tags, content, etc.) |
| `atrium_append_comment` | Add to Comments without rewriting body |
| `atrium_create_approval` | Pause for human decision |
| `atrium_continue_task` | Spawn next phase of a phased task |
| `atrium_list_templates` / `atrium_from_template` | Scaffolded task creation |
