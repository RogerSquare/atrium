// Task↔file join for the Files view (feat-files-tasks-impl-001).
//
// Pure: tasks (with files_affected) × server resolutions (raw path →
// jail-verified rel path | null, from POST /api/files/resolve-paths) →
//   byPath:    Map<relPath, [{ task, ts }]>  newest-first per file
//   dirCounts: Map<dirRel, n>                touched-file count per ancestor
//   unmatched: [{ task, raw }]               checked by the server and MISSING
//
// A raw path absent from `resolutions` was never checked (fetch pending or
// failed) — it contributes nothing, including to `unmatched`: the "not in
// the tree" claim is only made on filesystem truth.

export function lastActivityTs(task) {
  const log = task.activity_log || []
  const last = log.length ? log[log.length - 1].timestamp : task.created_at
  const t = last ? new Date(last).getTime() : 0
  return Number.isNaN(t) ? 0 : t
}

export function buildFileTaskIndex(tasks = [], project = null, resolutions = {}) {
  const byPath = new Map()
  const dirCounts = new Map()
  const unmatched = []

  for (const task of tasks) {
    if (project && (task.project || 'Root') !== project) continue
    const fa = task.files_affected || []
    if (!fa.length) continue
    const ts = lastActivityTs(task)
    const seen = new Set() // two raw spellings resolving to one file count once
    for (const raw of fa) {
      if (!(raw in resolutions)) continue // unchecked — no claims either way
      const rel = resolutions[raw]
      if (!rel) { unmatched.push({ task, raw }); continue }
      if (seen.has(rel)) continue
      seen.add(rel)
      const list = byPath.get(rel) || []
      list.push({ task, ts })
      byPath.set(rel, list)
      const parts = rel.split('/')
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/')
        dirCounts.set(dir, (dirCounts.get(dir) || 0) + 1)
      }
    }
  }

  for (const list of byPath.values()) list.sort((a, b) => b.ts - a.ts)
  unmatched.sort((a, b) => lastActivityTs(b.task) - lastActivityTs(a.task))
  return { byPath, dirCounts, unmatched }
}
