# Atrium — Ubiquitous Language

_Updated 2026-04-23_

The shared vocabulary this repo uses. Terms here have **one canonical meaning** — if you see two things called the same name in practice, flag it. Agents load this file to align their language with the human's; humans skim it before grilling a plan.

Scope: Atrium's own domain. Per-project glossaries for Cairn, Loom, etc. are separate and generated on-demand via the `ubiquitous-language` skill.

---

## Task lifecycle

| Term | Definition |
|---|---|
| **Task** | A unit of work, stored as a markdown file with YAML frontmatter under `backend/tasks/` |
| **Status** | One of `draft` · `todo` · `in_progress` · `waiting_input` · `review` · `done` — the only valid values |
| **Promotion** | Human action of moving `draft → todo`; agents MUST NOT promote |
| **Review gate** | The `in_progress → review` transition, validator-enforced: requires `github_branch` or `github_pr_url` unless the task is tagged `no-code` |
| **Closing** | Agent's pre-review checklist — set `files_affected`, push a branch, open a PR, populate linkage fields |
| **Approval (human)** | Moving `review → done`; humans only |

## Phases

| Term | Definition |
|---|---|
| **phase-research** | Investigation task — read code, report findings, no planning, no code |
| **phase-plan** | Consumes a research task (via `depends_on`), produces a phased implementation plan; no code |
| **phase-implement** | Consumes a plan task, executes phase by phase; no re-planning |
| **Continuation** | `atrium_continue_task` MCP call that spawns the next phase with the parent's content injected into a `<details>` block |

## Tags

| Term | Definition |
|---|---|
| **tdd** | Opt-in tag that binds `phase-implement` to strict red-green-refactor |
| **no-code** | Opt-out tag for the review-transition branch validator — use for docs-only, research, and plan tasks |
| **phase-*** | `phase-research` / `phase-plan` / `phase-implement` as the phase marker on a task |

## Entities

| Term | Definition |
|---|---|
| **Project** | A folder under `backend/tasks/`; contains tasks. The `Root` project renders as **"Unassigned"** in the UI |
| **Agent** | An authenticated caller whose identity starts with `agent:` (e.g. `agent:claude-opus-4-7`); distinguished from humans via a JWT flag |
| **Activity log** | Auto-managed audit trail on each task — agents never edit it directly |
| **Comment** | Agent-authored structured entry in a task's `### Comments` section: summary bullet + nested **Reasoning** + **Changes** snippet |
| **files_affected** | The list of paths a task modifies; populated before `review` |
| **parent_task** | Metadata pointer for hierarchical tasks (does NOT drive runtime behavior) |
| **depends_on** | Runtime pointer used by phased chains — `plan.depends_on[0]` points at research, etc. |
| **Archived project** | A project soft-retired into `backend/tasks/.archived/`; its tasks are filtered out of default queries and the category scanner's walk |

## Mid-run decisions

| Term | Definition |
|---|---|
| **Approval (agent)** | An agent-emitted checkpoint that pauses a task in `waiting_input` until the human picks an option; the choice is appended to `activity_log` |
| **waiting_input** | The status a task sits in while an approval is pending |
| **Worker loop** | An agent watching for new `todo` tasks via `atrium_wait_for_next_todo`, atomically claiming them as they arrive |
| **Atomic claim** | The server-side operation performed by `atrium_wait_for_next_todo` that flips `todo → in_progress` and sets `assignee` in one write |

## Changes view

| Term | Definition |
|---|---|
| **Changes view** | The git-timeline tab in the UI — groups tasks by category prefix (feat/bug/ui/opt/devops/comp/mobile) and shows branch + PR badges |
| **github_branch** | Bare branch name stored in a task's YAML; overrides substring matching |
| **github_pr_url** | Full PR URL stored in YAML; overrides substring matching and drives the PR badge color |
| **Unlinked** | A branch in `origin` that doesn't substring-match any task id AND isn't referenced by any task's `github_branch` |
| **Substring matcher** | The resolver at `backend/lib/github.js` — case-insensitive, **longest-id-wins** when a branch could match multiple tasks |

---

## Relationships

- A **Task** has exactly one **Status**, one **Project**, zero-or-one **Assignee**, and zero-or-more **Tags**.
- **Phases** chain via `depends_on`: research → plan → implement. `parent_task` is metadata; `depends_on` is runtime.
- The **Review gate** is enforced on the `in_progress → review` transition; the **no-code** tag is the only way to bypass it.
- **Continuation** copies the parent's body into the child inside a `<details>` block so the child has prior-phase context without re-fetching.
- A **Worker loop** is one **Agent** performing repeated **Atomic claims** — not a separate entity.
- The **Changes view** resolves Task ↔ Branch via the **Substring matcher**, OR explicit `github_branch` / `github_pr_url` which bypass it.

## Example dialogue

> **Human**: "Promote that draft about the header rewrite."
> **Agent**: "I don't promote drafts — that's a human action. Once you move it to `todo`, I'll pick it up."

> **Human**: "Is this a phase task?"
> **Agent**: "Yes — tagged `phase-research`. I'll read the code, write findings, and stop at `review`. The plan phase spawns separately via `atrium_continue_task`."

> **Human**: "Why can't you move it to `review`?"
> **Agent**: "The **Review gate** rejects it — no `github_branch` set and no `no-code` tag. I'll push the branch, set `github_pr_url`, then retry."

> **Human**: "Watch for tasks."
> **Agent**: "Entering **Worker loop** mode — I'll call `atrium_wait_for_next_todo` and surface each **Atomic claim** with a `Picked up <id>` line."

## Flagged ambiguities

- **"Approval"** is overloaded. The human `review → done` action AND agent-emitted mid-run approvals both exist. This file distinguishes them as **Approval (human)** vs **Approval (agent)** — prefer the qualified form in conversation.
- **"Unassigned"** is also overloaded: the **Project** uses the literal `Root` value, while an unassigned **Task** has an empty `assignee`. Different concepts — ask which one is meant.
- **"Branch"** is shared with git. Here it specifically means the git branch a task's PR is cut from, resolved by the **Substring matcher** or the `github_branch` override.
- **"Phase"** vs **"type"** — the `phase-*` tag marks workflow position; `type` (frontend/backend/fullstack/devops) marks code kind. Orthogonal.
- **"Component"** is used loosely in tasks (file/module name). Not a formal entity; treat as free-text.

## Out of scope for this file

- Matt Pocock's generator **`ubiquitous-language` skill** — installed separately at `~/.claude/skills/ubiquitous-language/`. Use it to produce starting glossaries for other projects (Cairn, Loom, …).
- Per-project glossaries. Each downstream project owns its own `UBIQUITOUS_LANGUAGE.md`.
