// Copy-paste prompt registry for the Shell-tab CommandCard.
//
// Each entry exposes:
//   id     — unique key (used by the React list + the copy-feedback state)
//   label  — short verb shown on the button face
//   build  — pure function: (task) → string. Receives the open task and
//            returns the full prompt to copy. Keep build() pure and
//            side-effect-free; the component calls it both at render
//            (for the always-visible preview line) and at click (for
//            the clipboard payload).
//
// Adding a command: append a new entry. Editing existing prompts:
// change `build` here only — the component reads from this list and
// doesn't hardcode any prompt strings.
//
// Conventions for the prompt text:
//   - Always start with "Use the atrium skill." so the agent loads the
//     skill rules instead of guessing the API shape.
//   - Mention the task id explicitly (substring is what the agent
//     greps for in scratch state).
//   - Be specific about the format the user wants back ("summarize",
//     "dump verbatim", etc.) — atrium tasks have rich content and
//     vague asks waste a turn.

export const COMMANDS = [
  {
    id: 'read',
    label: 'Read this task',
    build: (task) =>
      `Use the atrium skill. Read task ${task.id} and summarize the description, current status, and any open questions.`,
  },
  {
    id: 'start',
    label: 'Start work',
    build: (task) =>
      `Use the atrium skill. Claim task ${task.id} (set status=in_progress, assignee=agent:claude-opus-4-7) and read it. Walk through the phase rules before touching any code.`,
  },
  {
    id: 'comment',
    label: 'Update progress',
    build: (task) =>
      `Use the atrium skill. Append a structured comment to task ${task.id} summarizing what's been done so far. Use the standard "[agent:name]: ..." format with Reasoning + Changes sections.`,
  },
  {
    id: 'review',
    label: 'Move to review',
    build: (task) =>
      `Use the atrium skill. Move task ${task.id} to review. Set files_affected to the actual touched paths and ensure github_branch + github_pr_url are populated.`,
  },
  {
    id: 'related',
    label: 'List related tasks',
    build: (task) =>
      `Use the atrium skill. List tasks where parent_task=${task.id} or depends_on contains ${task.id}, plus any tasks whose Affects line mentions ${task.id}.`,
  },
  {
    id: 'comments',
    label: 'Show all comments',
    build: (task) =>
      `Use the atrium skill. Read task ${task.id} and dump every Comments-section entry verbatim so I can see the history.`,
  },
];
