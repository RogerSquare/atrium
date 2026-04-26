// Help content for the Atrium Help modal.
// Edit either constant to update what users see — the modal renders the
// active tab's content via ReactMarkdown.
// Bump VERSION_STAMP whenever you materially edit anything.

export const VERSION_STAMP = 'Updated 2026-04-26 (v4)'
export const SOURCE_URL = 'https://github.com/RogerSquare/atrium/blob/main/CLAUDE.md'

// Tab definitions. Order matters — first tab is the default open state.
export const HELP_TABS = [
  { id: 'web-ui', label: 'Web UI' },
  { id: 'terminal', label: 'Terminal prompts' },
]

export const HELP_CONTENT_WEB_UI = `Atrium is a task board for collaborating with AI agents. Tasks are stored as markdown files on disk; the web UI is a live view on top. Most everyday work falls into two flows: **managing tasks here in the web UI**, or **running an agent from the terminal** (see the Terminal prompts tab).

> Press \`?\` anywhere to open this panel.

### The 5-status lifecycle

Every task moves through these statuses in order. The board has a column per status.

- **draft** — being composed. Scope, acceptance criteria, and files_affected are still being refined. Agents MUST NOT pick up draft tasks.
- **todo** — waiting to be started. Promoted from draft by a human when the spec is ready.
- **in_progress** — an agent is actively working on it.
- **waiting_input** — paused for a mid-run decision from you (see _Approvals_ below).
- **review** — agent finished the work and is requesting your approval. Agents stop here.
- **done** — you approved the work. Only humans move a task to done.

**Two human-only transitions** — agents cannot make these:
- \`draft → todo\` (you promote)
- \`review → done\` (you approve)

### Creating tasks

Two paths:
1. **Quick-create** — the \`+ New Task\` button in the top bar. Good for small, self-contained work.
2. **Template-based** — pick a template (\`phase-research\`, \`phase-plan\`, \`phase-implement\`, \`bug-fix\`, \`ui-component\`) when scope is non-trivial. Templates scaffold the right sections automatically.

Task IDs follow a strict format: \`{category}-{descriptor}-{NNN}\` (e.g. \`feat-auth-001\`). Categories are \`feat | bug | ui | opt | comp | devops | mobile\`. Malformed IDs are rejected.

### Promoting a draft

When a draft's scope feels complete, click into the task and change the status to **todo**. Agents only pick up tasks in todo (and only those whose priority/project/assignee filters they're looking at). Until promoted, drafts are invisible to the \`status=todo\` polling agents use.

### Reading the activity log + comments

Every status change, assignee change, and content edit is logged automatically in the task's **Activity** section. Agent progress notes go into the **Comments** section in a structured format:

- **[agent:name]** — high-level summary (1-2 sentences)
  - **Reasoning** — why this approach
  - **Changes** — a concise code snippet of the critical change

Scan comments top-to-bottom to follow an agent's trajectory without opening the diff.

### Mid-run approvals (\`waiting_input\`)

When an agent hits a genuine ambiguity that would cause rework if guessed wrong, it can emit an approval request. The task auto-transitions to **waiting_input** and surfaces the question + options in the UI.

- Click the approval card, pick one of the options, submit.
- The task goes back to **in_progress** and the agent continues with your answer.
- Common cases: "rotate key now or after deploy?", "use library A or B?", "include feature X in scope?"

### Reviewing agent work (the closing checklist)

When an agent moves a task to **review**, verify before moving it to **done**:

- \`files_affected\` lists the actual files touched (not empty)
- **\`github_branch\` (or \`github_pr_url\`) is ENFORCED** — the backend rejects review transitions without one of them. Branch name must contain the task ID as a case-insensitive substring (e.g. \`feat/feat-auth-001\`). Non-code tasks opt out via a \`no-code\` tag.
- All completed acceptance criteria in the description are marked \`- [x]\`
- At least one structured comment explaining the work
- The PR builds / tests pass (if applicable)

If anything is missing, move the task back to **in_progress** with a note — don't silently patch it yourself.

### Phased tasks

Non-trivial work splits into three sequential phases via tags:

1. **phase-research** — read the codebase, report findings. No plan, no code.
2. **phase-plan** — consume the research task, produce a phased implementation plan with verification per phase. No code.
3. **phase-implement** — consume the plan, execute phase by phase. No re-planning.

After a research or plan task lands in **review**, the next phase is spawned automatically via \`atrium_continue_task\`, which injects the prior phase's content into the new task.

### Test-Driven Development (opt-in)

Tag any implement-phase task \`tdd\` to make the agent follow red-green-refactor: write one failing test, make it pass, refactor at green, repeat. Best for pure functions and clearly-specified behavior. Skip for docs, config, or visual UI tweaks — those have no meaningful test surface.

### Filters

The sidebar has filters for project, assignee, type (frontend/backend/fullstack/devops), priority, today-only, and stale. The active filter count is shown next to the filter icon — click **Reset** to clear everything.
`

export const HELP_CONTENT_TERMINAL = `Copy any of these into a fresh Claude Code chat. The Atrium skill auto-loads when a message mentions "atrium", "task", or "project". If you start your prompt with \`Use the atrium skill.\` it's guaranteed to load.

### Start a new initiative

Use when you want to kick off something new and have the agent shape it into a tracked task.

\`\`\`text
I want to build X in project Y. Use the atrium skill and create a phased research task (draft) so I can promote it when I'm ready.
\`\`\`

### Pick up a specific task

\`\`\`text
Use the atrium skill. Please work on task <task-id>.
\`\`\`

### Work on a task with TDD

Pairs with the \`tdd\` tag. Forces red-green-refactor during implement.

\`\`\`text
Use the atrium skill. Please work on task <task-id>. The task is tagged \`tdd\` so follow red-green-refactor strictly.
\`\`\`

### Continue a phased task (research → plan → implement)

Spawn the next phase after a research or plan task is in review.

\`\`\`text
Use the atrium skill. Task <task-id> is in review. Spawn the next phase via atrium_continue_task.
\`\`\`

### Respond to a mid-run approval

When a task is paused in \`waiting_input\` waiting on a decision from you.

\`\`\`text
Use the atrium skill. Task <task-id> is in \`waiting_input\` status. I picked option <N>. Continue.
\`\`\`

### Survey open PRs tied to tasks

Useful at the end of a work session to see what's ready to merge.

\`\`\`text
Use the atrium skill. List tasks in review status and show their github_pr_url fields.
\`\`\`

### Worker loop — pick up tasks as you promote them

Long-polls via \`atrium_wait_for_next_todo\`. Say "watch" once, then compose tasks in the UI and promote them to \`todo\`; the agent picks them up automatically. Server holds each call for up to ~5min; timeouts just re-call.

\`\`\`text
Use the atrium skill. Watch for new todo tasks assigned to me (or unassigned) and work on them as they arrive. Use atrium_wait_for_next_todo in a loop with timeout_seconds=270. Emit a "Picked up <id>: <title>" line before each task.
\`\`\`

---

_Content drawn from Atrium's \`CLAUDE.md\` and the Atrium Claude Code skill. Those are the source of truth if anything here looks stale — update them, then update this file to match._
`
