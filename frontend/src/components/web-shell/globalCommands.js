// Copy-paste prompt registry for the GlobalShellPanel CommandCard.
//
// Same shape as ./commands.js (`{ id, label, build }`) but the prompts
// are creation-oriented — start a new project, draft an unassigned task,
// kick off a phased task, list the current todo backlog. The default
// per-task COMMANDS in ./commands.js assume a specific task is in scope;
// these do not.
//
// `build(ctx)` ignores `ctx` for every entry today. The signature is
// kept the same as commands.js so CommandCard can call it uniformly
// without branching on which list it received.
//
// Conventions for the prompt text mirror commands.js:
//   - Always start with "Use the atrium skill." so the agent loads
//     the skill rules instead of guessing the API shape.
//   - Be specific about the format the user wants back.

export const GLOBAL_COMMANDS = [
  {
    id: 'new-project',
    label: 'New project',
    build: () =>
      `Use the atrium skill. Help me create a new project — ask for the name, suggested folder, and any starter tasks. Then call atrium_create_task as needed once I've confirmed.`,
  },
  {
    id: 'new-task',
    label: 'New unassigned task',
    build: () =>
      `Use the atrium skill. Draft a new task in the Root project (unassigned). Ask me for title, scope, and acceptance criteria, then call atrium_create_task.`,
  },
  {
    id: 'start-research',
    label: 'Start research phase',
    build: () =>
      `Use the atrium skill. I want to start a research-phase task. Ask me for the area / question to research, then create a phase-research task via atrium_from_template.`,
  },
  {
    id: 'start-plan',
    label: 'Start plan phase',
    build: () =>
      `Use the atrium skill. Help me start a plan-phase task. Ask me which research task it depends on, then create a phase-plan task that pulls that research id into depends_on[0].`,
  },
  {
    id: 'start-implement',
    label: 'Start implement phase',
    build: () =>
      `Use the atrium skill. Help me start an implement-phase task. Ask me which plan task it depends on, then create a phase-implement task with the plan id in depends_on[0].`,
  },
  {
    id: 'todo-backlog',
    label: 'Show todo backlog',
    build: () =>
      `Use the atrium skill. List all tasks with status=todo across every project, grouped by project, sorted by priority. Just the list — no commentary.`,
  },
  {
    id: 'recent-activity',
    label: 'Recent activity',
    build: () =>
      `Use the atrium skill. Show me the last 24 hours of task activity (status changes, new tasks, comments) across all projects.`,
  },
];
