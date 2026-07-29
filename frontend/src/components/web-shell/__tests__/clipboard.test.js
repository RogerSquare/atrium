// Unit tests for terminal clipboard handling (bug-shell-clipboard-001).
//
// The single most important assertion in this file is that Ctrl+C with no
// selection still passes through to the PTY as SIGINT. Breaking that to make
// copy work would be a worse bug than the one being fixed — it is how you
// interrupt a runaway process.

import { describe, it, expect, vi } from 'vitest'
import {
  ACTION,
  decideKeyAction,
  writeClipboard,
  readClipboard,
  clipboardAvailable,
} from '../clipboard'

const keydown = (key, mods = {}) => ({
  type: 'keydown',
  key,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
})

describe('decideKeyAction — SIGINT must survive', () => {
  it('Ctrl+C with NO selection passes through as SIGINT', () => {
    expect(decideKeyAction(keydown('c', { ctrlKey: true }), false)).toBe(ACTION.PASS)
  })

  it('Ctrl+C with a selection copies', () => {
    expect(decideKeyAction(keydown('c', { ctrlKey: true }), true)).toBe(ACTION.COPY)
  })

  it('Cmd+C with no selection still passes through on mac', () => {
    expect(decideKeyAction(keydown('c', { metaKey: true }), false, true)).toBe(ACTION.PASS)
  })
})

describe('decideKeyAction — copy', () => {
  it('Ctrl+Shift+C copies even with nothing selected', () => {
    // Copying nothing is a no-op; it must not fall through to the PTY, where
    // Ctrl+Shift+C would be an unintended control sequence.
    expect(decideKeyAction(keydown('c', { ctrlKey: true, shiftKey: true }), false)).toBe(ACTION.COPY)
  })

  it('Cmd+C copies on mac when there is a selection', () => {
    expect(decideKeyAction(keydown('c', { metaKey: true }), true, true)).toBe(ACTION.COPY)
  })

  it('is case-insensitive — Shift changes the reported key', () => {
    expect(decideKeyAction(keydown('C', { ctrlKey: true, shiftKey: true }), true)).toBe(ACTION.COPY)
  })
})

describe('decideKeyAction — paste', () => {
  it('Ctrl+Shift+V pastes', () => {
    expect(decideKeyAction(keydown('v', { ctrlKey: true, shiftKey: true }), false)).toBe(ACTION.PASTE)
  })

  it('Cmd+V pastes on mac', () => {
    expect(decideKeyAction(keydown('v', { metaKey: true }), false, true)).toBe(ACTION.PASTE)
  })

  // Ctrl+V is literal-next in some readline configs; the shell expects it.
  it('bare Ctrl+V is NOT paste — it is a real control code', () => {
    expect(decideKeyAction(keydown('v', { ctrlKey: true }), false)).toBe(ACTION.PASS)
  })

  it('Cmd+V does not fire on non-mac', () => {
    expect(decideKeyAction(keydown('v', { metaKey: true }), false, false)).toBe(ACTION.PASS)
  })
})

describe('decideKeyAction — everything else passes through', () => {
  it('plain keys', () => {
    expect(decideKeyAction(keydown('a'), false)).toBe(ACTION.PASS)
    expect(decideKeyAction(keydown('Enter'), false)).toBe(ACTION.PASS)
  })

  it('other control combos', () => {
    expect(decideKeyAction(keydown('d', { ctrlKey: true }), false)).toBe(ACTION.PASS)
    expect(decideKeyAction(keydown('z', { ctrlKey: true }), false)).toBe(ACTION.PASS)
    expect(decideKeyAction(keydown('l', { ctrlKey: true }), false)).toBe(ACTION.PASS)
  })

  // Acting on keyup as well would fire copy/paste twice per keypress.
  it('ignores non-keydown events', () => {
    expect(decideKeyAction({ ...keydown('c', { ctrlKey: true, shiftKey: true }), type: 'keyup' }, true))
      .toBe(ACTION.PASS)
  })

  it('tolerates a malformed event', () => {
    expect(decideKeyAction(null, false)).toBe(ACTION.PASS)
    expect(decideKeyAction({ type: 'keydown' }, false)).toBe(ACTION.PASS)
  })
})

describe('writeClipboard', () => {
  it('uses the async API when available', async () => {
    const writeText = vi.fn().mockResolvedValue()
    const ok = await writeClipboard('hello', { navigator: { clipboard: { writeText } } })
    expect(ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('returns false for empty text without touching the clipboard', async () => {
    const writeText = vi.fn()
    expect(await writeClipboard('', { navigator: { clipboard: { writeText } } })).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  // The LAN case: navigator.clipboard is absent on a non-secure origin, which
  // is exactly how a containerized board gets reached from another machine.
  it('falls back to execCommand when the async API is missing', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    const el = { style: {}, setAttribute: vi.fn(), select: vi.fn() }
    const doc = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => el,
      execCommand,
    }
    const ok = await writeClipboard('fallback', { navigator: {}, document: doc })
    expect(ok).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(doc.body.removeChild).toHaveBeenCalled()
  })

  it('falls back when the async API rejects (permission denied)', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    const el = { style: {}, setAttribute: vi.fn(), select: vi.fn() }
    const doc = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => el,
      execCommand,
    }
    const nav = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } }
    expect(await writeClipboard('x', { navigator: nav, document: doc })).toBe(true)
    expect(execCommand).toHaveBeenCalled()
  })

  it('always removes the temporary textarea, even when copying throws', async () => {
    const el = { style: {}, setAttribute: vi.fn(), select: () => { throw new Error('boom') } }
    const doc = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: () => el,
      execCommand: vi.fn(),
    }
    expect(await writeClipboard('x', { navigator: {}, document: doc })).toBe(false)
    expect(doc.body.removeChild).toHaveBeenCalled()
  })
})

describe('readClipboard', () => {
  it('reads via the async API', async () => {
    const nav = { clipboard: { readText: vi.fn().mockResolvedValue('pasted') } }
    expect(await readClipboard({ navigator: nav })).toBe('pasted')
  })

  // There is no legacy read fallback — execCommand('paste') was never allowed.
  it('returns empty when the API is unavailable', async () => {
    expect(await readClipboard({ navigator: {} })).toBe('')
  })

  it('returns empty when the read is denied', async () => {
    const nav = { clipboard: { readText: vi.fn().mockRejectedValue(new Error('denied')) } }
    expect(await readClipboard({ navigator: nav })).toBe('')
  })
})

describe('clipboardAvailable', () => {
  it('requires BOTH a secure context and the API', () => {
    const nav = { clipboard: { readText: () => {} } }
    expect(clipboardAvailable({ navigator: nav, isSecureContext: true })).toBe(true)
    expect(clipboardAvailable({ navigator: nav, isSecureContext: false })).toBe(false)
    expect(clipboardAvailable({ navigator: {}, isSecureContext: true })).toBe(false)
  })
})

// --- getTerminalText / mouseTrackingActive -------------------------------
//
// These cover the actual reported failure: a TUI (Claude Code) turns on mouse
// tracking, xterm forwards drags to the application, no selection is ever
// made, and every copy binding appears dead. Copy then has to fall back to
// the buffer rather than copying nothing.

import { getTerminalText, mouseTrackingActive } from '../clipboard'

const fakeTerm = ({ selection = '', lines = [], modes = {} } = {}) => ({
  getSelection: () => selection,
  modes,
  buffer: {
    active: {
      length: lines.length,
      getLine: (i) => (lines[i] === undefined ? null : { translateToString: () => lines[i] }),
    },
  },
})

describe('getTerminalText', () => {
  it('prefers the selection when there is one', () => {
    expect(getTerminalText(fakeTerm({ selection: 'picked', lines: ['a', 'b'] }))).toBe('picked')
  })

  it('falls back to the buffer when nothing is selected', () => {
    expect(getTerminalText(fakeTerm({ lines: ['one', 'two'] }))).toBe('one\ntwo')
  })

  // The buffer is padded to the viewport height, so without trimming, every
  // copy ends in a screenful of blank lines.
  it('drops trailing blank lines', () => {
    expect(getTerminalText(fakeTerm({ lines: ['one', '', '', ''] }))).toBe('one')
  })

  it('keeps blank lines that sit between content', () => {
    expect(getTerminalText(fakeTerm({ lines: ['a', '', 'b'] }))).toBe('a\n\nb')
  })

  it('caps how much scrollback it takes', () => {
    const lines = Array.from({ length: 100 }, (_, i) => 'line' + i)
    const out = getTerminalText(fakeTerm({ lines }), 10)
    expect(out.split('\n')).toHaveLength(10)
    expect(out.startsWith('line90')).toBe(true)
  })

  it('returns empty rather than throwing on a disposed terminal', () => {
    expect(getTerminalText(null)).toBe('')
    expect(getTerminalText({})).toBe('')
  })
})

describe('mouseTrackingActive', () => {
  it('detects an application that has grabbed the mouse', () => {
    expect(mouseTrackingActive(fakeTerm({ modes: { mouseTrackingMode: 'any' } }))).toBe(true)
  })

  it('is false when the mouse is the terminal\'s own', () => {
    expect(mouseTrackingActive(fakeTerm({ modes: { mouseTrackingMode: 'none' } }))).toBe(false)
    expect(mouseTrackingActive(fakeTerm())).toBe(false)
    expect(mouseTrackingActive(null)).toBe(false)
  })
})

// --- Ctrl+Insert / Shift+Insert -----------------------------------------
//
// These exist because Ctrl+Shift+C is NOT reliable: Chrome and Edge bind it
// to the DevTools element picker and swallow it before the page sees a
// keydown, so the handler was never called and copy appeared broken.
// Ctrl+Insert / Shift+Insert are the classic terminal chords and no browser
// claims them.

describe('Insert-key bindings survive the browser', () => {
  it('Ctrl+Insert copies', () => {
    expect(decideKeyAction(keydown('Insert', { ctrlKey: true }), true)).toBe(ACTION.COPY)
  })

  it('Ctrl+Insert copies even with no selection — the buffer fallback covers it', () => {
    expect(decideKeyAction(keydown('Insert', { ctrlKey: true }), false)).toBe(ACTION.COPY)
  })

  it('Shift+Insert pastes', () => {
    expect(decideKeyAction(keydown('Insert', { shiftKey: true }), false)).toBe(ACTION.PASTE)
  })

  it('bare Insert is passed through to the PTY', () => {
    expect(decideKeyAction(keydown('Insert'), false)).toBe(ACTION.PASS)
  })

  it('Ctrl+Shift+Insert is ambiguous and passes through', () => {
    expect(decideKeyAction(keydown('Insert', { ctrlKey: true, shiftKey: true }), false)).toBe(ACTION.PASS)
  })
})
