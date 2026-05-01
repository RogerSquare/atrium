// Unit tests for AutoEnterToggle's pure prompt-detection helpers.
// Keeps the regex list honest by pinning expected matches against
// representative shell output.

import { describe, it, expect } from 'vitest'
import {
  PROMPT_PATTERNS,
  stripAnsi,
  tailMatchesPrompt,
} from '../web-shell/autoEnterPatterns.js'

describe('stripAnsi', () => {
  it('removes CSI sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text')
  })

  it('removes OSC title sequences (BEL terminator)', () => {
    expect(stripAnsi('\x1b]0;title\x07hello')).toBe('hello')
  })

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })
})

describe('tailMatchesPrompt — should fire', () => {
  it.each([
    ['(y/N) literal', 'Continue? (y/N) '],
    ['(Y/n) flipped default', 'Are you sure? (Y/n) '],
    ['[y/N] bracketed', 'Delete file? [y/N] '],
    ['Press Enter prompt', 'Press Enter to continue...'],
    ['Continue? alone', 'All done. Continue? '],
    ['Proceed? alone', 'About to overwrite. Proceed? '],
    ['Are you sure', 'This is destructive. Are you sure? '],
    ['Claude Code "Do you want to proceed"',
      'Do you want to proceed?\n  1. Yes\n  2. No\n  ❯ 1. Yes'],
    ['Claude Code "Do you want to make this edit"',
      'Do you want to make this edit to README.md?\n  1. Yes\n'],
    // bug-autoenter-claude-prompts-001 — broadened "do you want to" verb
    ['Claude Code "Do you want to allow ... fetch"',
      'Do you want to allow Claude to fetch this content?\n  1. Yes\n  ❯ 2. Yes, and don\'t ask again\n  3. No'],
    ['Claude Code "Do you want to run"',
      'Do you want to run this command?\n  1. Yes\n  2. No'],
    // Numbered-menu cursor — fires even if the question text doesn't match
    ['cursor on option 1',
      '  ❯ 1. Yes\n    2. No'],
    ['cursor on option 2 (sticky variant highlighted)',
      '  1. Yes\n  ❯ 2. Yes, and don\'t ask again for raw.githubusercontent.com\n  3. No'],
    ['ANSI-wrapped prompt', '\x1b[1m\x1b[33mContinue?\x1b[0m '],
  ])('matches: %s', (_label, output) => {
    expect(tailMatchesPrompt(output)).toBe(true)
  })
})

describe('tailMatchesPrompt — should NOT fire', () => {
  it.each([
    ['empty string', ''],
    ['null buffer', null],
    ['undefined', undefined],
    ['plain output', 'Cloning into atrium...\nremote: Counting objects: 100%'],
    ['code-style output', "const result = doThing('foo', 'bar')"],
    ['file listing', 'README.md  package.json  src/'],
    ['version banner', 'Node.js v20.10.0\nnpm 10.2.3'],
    // Plain numbered list without the ❯ cursor must NOT trigger the
    // menu-cursor rule — false-positive guard for regular CLI output.
    ['plain numbered list', '1. First step\n2. Second step\n3. Third step'],
  ])('does not match: %s', (_label, output) => {
    expect(tailMatchesPrompt(output)).toBe(false)
  })
})

describe('tailMatchesPrompt — windowing', () => {
  it('only scans the last 200 chars', () => {
    // Place a (y/N) early, then bury it behind 250 chars of noise.
    const noise = 'x'.repeat(250)
    const buf = 'Continue? (y/N) ' + noise
    expect(tailMatchesPrompt(buf)).toBe(false)
  })

  it('matches a prompt that lands inside the tail window', () => {
    const noise = 'x'.repeat(190)
    const buf = noise + 'Continue? (y/N) '
    expect(tailMatchesPrompt(buf)).toBe(true)
  })
})

describe('PROMPT_PATTERNS shape', () => {
  it('is a non-empty list of RegExp instances', () => {
    expect(PROMPT_PATTERNS.length).toBeGreaterThan(0)
    PROMPT_PATTERNS.forEach((re) => expect(re).toBeInstanceOf(RegExp))
  })
})
