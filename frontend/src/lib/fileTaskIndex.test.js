import { describe, it, expect } from 'vitest'
import { buildFileTaskIndex, lastActivityTs } from './fileTaskIndex'

const task = (id, project, files, ts) => ({
  id, project, files_affected: files,
  activity_log: ts ? [{ timestamp: ts, action: 'x' }] : [],
  created_at: '2026-01-01T00:00:00Z',
})

const RES = {
  'backend/server.js': 'backend/server.js',
  'ai-gallery/backend/db.js': 'backend/db.js', // stale prefix, rescued
  'gone/away.js': null,                        // checked and missing
}

describe('buildFileTaskIndex', () => {
  it('joins resolved paths, aggregates ancestors, sorts newest-first', () => {
    const old = task('t-old', 'Alpha', ['backend/server.js'], '2026-02-01T00:00:00Z')
    const fresh = task('t-new', 'Alpha', ['backend/server.js', 'ai-gallery/backend/db.js'], '2026-03-01T00:00:00Z')
    const { byPath, dirCounts } = buildFileTaskIndex([old, fresh], 'Alpha', RES)

    expect(byPath.get('backend/server.js').map((e) => e.task.id)).toEqual(['t-new', 't-old'])
    expect(byPath.get('backend/db.js').map((e) => e.task.id)).toEqual(['t-new'])
    expect(dirCounts.get('backend')).toBe(3) // server.js×2 + db.js×1
  })

  it('two raw spellings of one file count once per task', () => {
    const t = task('t-1', 'Alpha', ['backend/server.js', 'ai-gallery/backend/db.js', 'backend/db.js'], null)
    const res = { ...RES, 'backend/db.js': 'backend/db.js' }
    const { byPath } = buildFileTaskIndex([t], 'Alpha', res)
    expect(byPath.get('backend/db.js')).toHaveLength(1)
  })

  it('unmatched holds only server-checked misses; unchecked paths make no claims', () => {
    const t = task('t-1', 'Alpha', ['gone/away.js', 'never/checked.js'], null)
    const { unmatched, byPath } = buildFileTaskIndex([t], 'Alpha', RES)
    expect(unmatched).toHaveLength(1)
    expect(unmatched[0].raw).toBe('gone/away.js')
    expect(byPath.size).toBe(0)
  })

  it('scopes to the given project (Root default) and skips fileless tasks', () => {
    const a = task('t-a', 'Alpha', ['backend/server.js'], null)
    const b = task('t-b', 'Beta', ['backend/server.js'], null)
    const rootTask = { ...task('t-r', undefined, ['backend/server.js'], null), project: undefined }
    const none = task('t-n', 'Alpha', [], null)
    expect(buildFileTaskIndex([a, b, none], 'Alpha', RES).byPath.get('backend/server.js')).toHaveLength(1)
    expect(buildFileTaskIndex([rootTask], 'Root', RES).byPath.get('backend/server.js')).toHaveLength(1)
  })

  it('lastActivityTs prefers the newest activity entry, falls back to created_at', () => {
    expect(lastActivityTs(task('x', 'p', [], '2026-05-01T00:00:00Z'))).toBe(new Date('2026-05-01T00:00:00Z').getTime())
    expect(lastActivityTs(task('x', 'p', [], null))).toBe(new Date('2026-01-01T00:00:00Z').getTime())
  })
})
