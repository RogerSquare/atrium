// Unit tests for listColumns (ui-list-usability-001).
//
// The behaviour worth pinning down is recovery: a stored column set can
// outlive the registry that produced it (that is exactly what happened to
// `due_date`), and a user must never be able to persist themselves into an
// unusable table.

import { describe, it, expect } from 'vitest'
import {
  ALL_COLUMNS,
  DEFAULT_VISIBLE,
  LOCKED,
  loadVisibleColumns,
  saveVisibleColumns,
  toggleColumn,
  resolveColumns,
  phaseOf,
} from '../listColumns'

// Minimal localStorage stand-in — the real one isn't present in the unit env.
const fakeStorage = (initial = null) => {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_k, v) => { value = v },
    read: () => value,
  }
}

describe('registry', () => {
  it('has no due_date column — it was empty on all 769 tasks', () => {
    expect(ALL_COLUMNS.find(c => c.key === 'due_date')).toBeUndefined()
    expect(DEFAULT_VISIBLE).not.toContain('due_date')
  })

  it('locks id and title so a row can always be identified', () => {
    expect(LOCKED).toEqual(['id', 'title'])
  })

  it('every default is a real column', () => {
    const known = new Set(ALL_COLUMNS.map(c => c.key))
    for (const key of DEFAULT_VISIBLE) expect(known.has(key)).toBe(true)
  })

  it('marks non-orderable columns unsortable rather than letting clicks no-op', () => {
    expect(ALL_COLUMNS.find(c => c.key === 'pr').sortable).toBe(false)
    expect(ALL_COLUMNS.find(c => c.key === 'tags').sortable).toBe(false)
  })
})

describe('loadVisibleColumns', () => {
  it('falls back to defaults with nothing stored', () => {
    expect(loadVisibleColumns(fakeStorage(null))).toEqual(DEFAULT_VISIBLE)
  })

  it('falls back on malformed JSON instead of throwing', () => {
    expect(loadVisibleColumns(fakeStorage('{not json'))).toEqual(DEFAULT_VISIBLE)
  })

  it('falls back when the stored value is not an array', () => {
    expect(loadVisibleColumns(fakeStorage('"status"'))).toEqual(DEFAULT_VISIBLE)
  })

  // The due_date case, concretely: a set persisted before the column was
  // removed must not strand the view on a column that no longer renders.
  it('drops columns that no longer exist in the registry', () => {
    const out = loadVisibleColumns(fakeStorage('["id","title","due_date","status"]'))
    expect(out).not.toContain('due_date')
    expect(out).toContain('status')
  })

  it('forces locked columns back in if they were stripped out', () => {
    const out = loadVisibleColumns(fakeStorage('["status"]'))
    expect(out).toContain('id')
    expect(out).toContain('title')
  })

  it('falls back when every stored column is unknown', () => {
    expect(loadVisibleColumns(fakeStorage('["nope","gone"]'))).toEqual(DEFAULT_VISIBLE)
  })

  it('round-trips through save', () => {
    const s = fakeStorage()
    saveVisibleColumns(['id', 'title', 'phase'], s)
    expect(loadVisibleColumns(s)).toEqual(['id', 'title', 'phase'])
  })

  it('survives storage being unavailable', () => {
    const throwing = { getItem: () => { throw new Error('disabled') } }
    expect(loadVisibleColumns(throwing)).toEqual(DEFAULT_VISIBLE)
    expect(() => saveVisibleColumns(['id'], throwing)).not.toThrow()
  })
})

describe('toggleColumn', () => {
  it('adds and removes', () => {
    expect(toggleColumn(['id', 'title'], 'type')).toContain('type')
    expect(toggleColumn(['id', 'title', 'type'], 'type')).not.toContain('type')
  })

  it('refuses to remove a locked column', () => {
    expect(toggleColumn(['id', 'title'], 'id')).toEqual(['id', 'title'])
    expect(toggleColumn(['id', 'title'], 'title')).toEqual(['id', 'title'])
  })

  // Otherwise the header order would depend on the order you happened to
  // click things in, and two users would see different tables.
  it('keeps registry order regardless of click order', () => {
    const order = ALL_COLUMNS.map(c => c.key)
    let visible = ['id', 'title']
    visible = toggleColumn(visible, 'tags')
    visible = toggleColumn(visible, 'status')
    const positions = visible.map(k => order.indexOf(k))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})

describe('resolveColumns', () => {
  it('returns definitions in registry order', () => {
    const cols = resolveColumns(['tags', 'status', 'id'])
    expect(cols.map(c => c.key)).toEqual(['id', 'status', 'tags'])
  })
})

describe('phaseOf', () => {
  it('extracts the phase from a phase-* tag', () => {
    expect(phaseOf({ tags: ['tdd', 'phase-implement'] })).toBe('implement')
  })

  it('returns null when there is no phase tag', () => {
    expect(phaseOf({ tags: ['docker', 'no-e2e'] })).toBeNull()
    expect(phaseOf({ tags: [] })).toBeNull()
    expect(phaseOf({})).toBeNull()
    expect(phaseOf(null)).toBeNull()
  })

  it('ignores non-string tags rather than throwing', () => {
    expect(phaseOf({ tags: [null, 42, 'phase-plan'] })).toBe('plan')
  })
})
