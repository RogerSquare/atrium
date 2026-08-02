// List-endpoint filtering + pagination (opt-tasks-pagination-001).
//
// Extracted from routes/tasks.js so the paging contract is unit-testable.
// The driving failure: the Atrium project alone holds 400+ tasks, one
// unfiltered list is ~103 KB, and the MCP list tool used to fetch ALL of it
// and filter client-side — blowing the agent's tool-result budget. Filters
// therefore run server-side and BEFORE pagination, so `total` counts what
// matched, not what happened to be on the page.

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

// Exact-match filters. Absent/empty params are skipped. `status` and
// `assignee` are new here; `project` stays in the route because it goes
// through the project registry (id → folder resolution).
function filterTasks(tasks, { status, assignee } = {}) {
  let out = tasks;
  if (status) out = out.filter((t) => t.status === status);
  if (assignee) out = out.filter((t) => t.assignee === assignee);
  return out;
}

// Back-compat contract: NO `limit` param → `{ paged: false }` and the caller
// returns the plain array exactly as before (the web UI and every pre-paging
// consumer depends on that shape). Any `limit` → paged envelope with a total.
function paginateTasks(tasks, { limit, offset } = {}) {
  if (limit === undefined || limit === null || limit === '') {
    return { paged: false, tasks };
  }
  const lim = Math.min(parseInt(limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  return {
    paged: true,
    total: tasks.length,
    offset: off,
    limit: lim,
    tasks: tasks.slice(off, off + lim),
  };
}

module.exports = { filterTasks, paginateTasks, MAX_LIMIT, DEFAULT_LIMIT };
