// Unit tests for AutoEnterToggle's pure prompt-detection helpers.
// Keeps the regex list honest by pinning expected matches against
// representative shell output.

import { describe, it, expect } from 'vitest'
import {
  PROMPT_PATTERNS,
  DENY_PATTERNS,
  IDLE_PATTERNS,
  stripAnsi,
  tailMatchesPrompt,
  tailMatchesInputField,
  classifyTail,
} from '../web-shell/autoEnterPatterns.js'

describe('stripAnsi', () => {
  it('drops SGR/color sequences without inserting whitespace', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text')
  })

  it('drops OSC title sequences (BEL terminator)', () => {
    expect(stripAnsi('\x1b]0;title\x07hello')).toBe('hello')
  })

  it('leaves plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })

  // bug-autoenter-ansi-cursor-strip-001 — CC paints prompt UI using
  // \x1b[NC (cursor-forward) between words instead of literal spaces.
  // Stripping those to empty would collapse text and break every
  // word-separator regex; they must become whitespace.
  it('replaces cursor-forward CSI with whitespace so words stay separated', () => {
    expect(stripAnsi('Esc\x1b[1Cto\x1b[1Ccancel')).toContain('Esc')
    expect(stripAnsi('Esc\x1b[1Cto\x1b[1Ccancel')).toContain('to')
    expect(stripAnsi('Esc\x1b[1Cto\x1b[1Ccancel')).toContain('cancel')
    expect(stripAnsi('Esc\x1b[1Cto\x1b[1Ccancel')).toMatch(/Esc\s+to\s+cancel/)
  })

  it('replaces cursor-position CSI (\\x1b[N;MH) with whitespace', () => {
    expect(stripAnsi('No\x1b[65;2HEsc')).toMatch(/No\s+Esc/)
  })

  it('replaces multiple cursor escapes without merging adjacent words', () => {
    const raw = 'Yes,\x1b[1Callow\x1b[1Call\x1b[1Cedits'
    expect(stripAnsi(raw)).toMatch(/Yes,\s+allow\s+all\s+edits/)
  })

  it('handles SGR + cursor-positioning interleaved (real-world tail)', () => {
    // Distilled from a captured edit-confirmation prompt — SGR codes
    // surround literal text, cursor-forwards space the words.
    const raw = '\x1b[m\x1b[1CYes,\x1b[1Callow\x1b[1Call\x1b[1Cedits\x1b[m'
    const stripped = stripAnsi(raw)
    expect(stripped).toMatch(/Yes,\s+allow\s+all\s+edits/)
  })
})

describe('tailMatchesPrompt — should fire', () => {
  it.each([
    ['(y/N) literal', 'Continue? (y/N) '],
    ['[y/N] bracketed', 'Generate config? [y/N] '],
    ['Press Enter prompt', 'Press Enter to continue...'],
    ['Continue? alone', 'All done. Continue? '],
    ['Proceed? alone', 'About to write. Proceed? '],
    ['Claude Code "Do you want to proceed"',
      'Do you want to proceed?\n  1. Yes\n  2. No\n  ❯ 1. Yes'],
    ['Claude Code "Do you want to make this edit"',
      'Do you want to make this edit to README.md?\n  1. Yes\n'],
    ['Claude Code "Do you want to allow ... fetch"',
      'Do you want to allow Claude to fetch this content?\n  1. Yes\n  ❯ 2. Yes, and don\'t ask again\n  3. No'],
    ['Claude Code "Do you want to run"',
      'Do you want to run this command?\n  1. Yes\n  2. No'],
    ['Claude Code "Do you want to use this API key"',
      'Do you want to use this API key?\n  ❯ 1. Yes\n  2. No'],
    // Numbered-menu cursor — fires even if the question text doesn't match
    ['cursor on option 1',
      '  ❯ 1. Yes\n    2. No'],
    ['cursor on option 2 (sticky variant highlighted)',
      '  1. Yes\n  ❯ 2. Yes, and don\'t ask again for raw.githubusercontent.com\n  3. No'],
    // Wizard prompts — user is actively driving the wizard, auto-Enter
    // takes the highlighted default (usually "Yes" / sensible choice)
    ['wizard "Connect Claude on the web to GitHub"',
      'Connect Claude on the web to GitHub?\n  ❯ 1. Yes\n  2. No'],
    ['wizard "Apply these edits"',
      'Apply these edits?\n  ❯ 1. Yes\n  2. No'],
    ['wizard "Install as a service now"',
      'Install as a service now?\n  ❯ 1. Yes\n  2. No'],
    ['wizard "Enable Remote Control"',
      'Enable Remote Control?\n  ❯ 1. Yes\n  2. No'],
    ['ANSI-wrapped prompt', '\x1b[1m\x1b[33mContinue?\x1b[0m '],
    // bug-autoenter-cc-hint-line-001 — captured snippets from real CC
    // Bash-permission prompts where the body pushed the cursor past
    // the 200-char tail window. The hint line is the only marker
    // that's still in view; ANSI-stripped versions of the actual logs.
    ['CC hint-line tail (bash command 1)',
      '-tabjs.py"\n   3. No\n Esc to cancel · Tab to amend · ctrl+e to explain'],
    ['CC hint-line tail (bash command 2)',
      "t.get('url','')[:80]) for t in json.load(sys.stdin)]\"\n   3. No\n Esc to cancel · Tab to amend · ctrl+e to explain"],
    ['CC hint-line tail (bash command 3)',
      '-osktest.py"\n   3. No\n Esc to cancel · Tab to amend · ctrl+e to explain'],
    // bug-autoenter-ansi-cursor-strip-001 — verbatim raw ANSI from a
    // captured edit-confirmation prompt where CC used cursor-forward
    // escapes between every word. Pre-fix, stripAnsi collapsed this to
    // "Esctocancel" and missed; post-fix it strips to whitespace-
    // separated text that the existing /Esc to cancel/i rule matches.
    ['CC edit-confirm prompt with cursor-forward word spacing',
      '\x1b[m\x1b[1CYes,\x1b[1Callow\x1b[1Call\x1b[1Cedits\x1b[1Cduring\x1b[1Cthis\x1b[1Csession\x1b[1m\x1b[1C(shift+tab)\x1b[38;2;153;153;153m\x1b[22m\x1b[63;4H3.\x1b[m\x1b[1CNo\x1b[38;2;153;153;153m\x1b[65;2HEsc\x1b[1Cto\x1b[1Ccancel\x1b[1C·\x1b[1CTab\x1b[1Cto\x1b[1Camend\x1b[m'],
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

    // === Denylist: destructive prompts ===
    // "Are you sure" is a universal destructive-guard phrase — both
    // CC's delete confirmations and plain shell scripts use it.
    ['"Are you sure" alone', 'This is destructive. Are you sure? '],
    ['"Are you sure" with (Y/n)', 'Are you sure? (Y/n) '],
    ['CC "Are you sure you want to delete the agent"',
      'Are you sure you want to delete the agent foo?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Are you sure you want to delete this permission rule"',
      'Are you sure you want to delete this permission rule?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Delete N item(s) for ALL projects"',
      'Delete 3 item(s) for ALL projects?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Delete N item(s) for project"',
      'Delete 3 item(s) for myproject?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Overwrite?" alone',
      'Overwrite?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Remove server"',
      'Remove server foo-server?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Remove marketplace"',
      'Remove marketplace?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Remove a marketplace"',
      'Remove a marketplace?\n  ❯ 1. Yes\n  2. No'],
    ['CC "Remove directory from workspace"',
      'Remove directory from workspace?\n  ❯ 1. Yes\n  2. No'],

    // === Denylist: plan-mode prompts ===
    ['CC plan-mode execute gate',
      'Claude has written up a plan and is ready to execute. Would you like to proceed?\n  ❯ 1. Yes\n  2. No'],
    ['CC scope reconfirmation',
      'Before I start editing, can you confirm the scope?\n  ❯ 1. Yes\n  2. No'],
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

describe('DENY_PATTERNS shape', () => {
  it('is a non-empty list of RegExp instances', () => {
    expect(DENY_PATTERNS.length).toBeGreaterThan(0)
    DENY_PATTERNS.forEach((re) => expect(re).toBeInstanceOf(RegExp))
  })
})

describe('IDLE_PATTERNS shape', () => {
  it('is a non-empty list of RegExp instances', () => {
    expect(IDLE_PATTERNS.length).toBeGreaterThan(0)
    IDLE_PATTERNS.forEach((re) => expect(re).toBeInstanceOf(RegExp))
  })
})

describe('tailMatchesInputField — should match', () => {
  it.each([
    ['CC top box border',
      'output\n╭─────────────────╮\n│ >              │\n╰─────────────────╯'],
    ['CC bottom box border alone',
      'something\n╰─────────────────╯\n  ? for shortcuts'],
    ['CC hint line',
      'idle state\n  ? for shortcuts | type / for commands'],
    ['bash prompt at end', 'output finished\nuser@host:~$ '],
    ['cmd.exe prompt at end', 'compiled\nC:\\Users\\foo\\project>'],
    ['PowerShell prompt at end', 'done\nPS C:\\Users\\foo>'],
    ['zsh prompt at end', 'job done\n~ %'],
  ])('matches: %s', (_label, output) => {
    expect(tailMatchesInputField(output)).toBe(true)
  })
})

describe('tailMatchesInputField — should NOT match', () => {
  it.each([
    ['empty', ''],
    ['null', null],
    ['undefined', undefined],
    ['plain output without prompt at end',
      'Cloning into atrium...\nremote: Counting objects: 100%'],
    ['CC permission prompt (input field replaced)',
      'Do you want to proceed?\n  ❯ 1. Yes\n  2. No'],
    ['box border in scrollback past the 100-char idle window',
      '╭─────────────╮\n' + 'x'.repeat(120) + '\nDoing work...'],
  ])('does not match: %s', (_label, output) => {
    expect(tailMatchesInputField(output)).toBe(false)
  })
})

describe('classifyTail', () => {
  it('returns "denied" for denylist matches', () => {
    expect(classifyTail('Are you sure you want to delete the agent foo?\n  ❯ 1. Yes')).toBe('denied')
    expect(classifyTail('Overwrite?\n  ❯ 1. Yes')).toBe('denied')
    expect(classifyTail('Claude has written up a plan and is ready to execute. Would you like to proceed?\n  ❯ 1. Yes')).toBe('denied')
  })

  it('returns "fire" for allowlist matches', () => {
    expect(classifyTail('Do you want to proceed?\n  ❯ 1. Yes')).toBe('fire')
    expect(classifyTail('Continue? (y/N) ')).toBe('fire')
    expect(classifyTail('  ❯ 1. Yes\n    2. No')).toBe('fire')
  })

  it('returns "input-field" for the idle CC input box', () => {
    expect(classifyTail('output\n╭─────────╮\n│ >       │\n╰─────────╯\n  ? for shortcuts')).toBe('input-field')
  })

  it('returns "input-field" for bare shell prompts', () => {
    expect(classifyTail('done\nuser@host:~$ ')).toBe('input-field')
    expect(classifyTail('done\nC:\\Users\\foo>')).toBe('input-field')
  })

  it('returns "unknown" when nothing matches', () => {
    expect(classifyTail('Frobnicate the widget? ')).toBe('unknown')
    expect(classifyTail('Custom prompt: enter password ')).toBe('unknown')
    expect(classifyTail('A wild prompt appears!')).toBe('unknown')
  })

  it('returns "unknown" for empty / null / undefined', () => {
    expect(classifyTail('')).toBe('unknown')
    expect(classifyTail(null)).toBe('unknown')
    expect(classifyTail(undefined)).toBe('unknown')
  })

  it('denylist wins over fire when both match', () => {
    // Tail has both "are you sure" (deny) and the cursor (allow).
    expect(classifyTail('Are you sure you want to delete?\n  ❯ 1. Yes')).toBe('denied')
  })

  it('fire wins over input-field when both signals are in the tail', () => {
    // A box border in scrollback shouldn't suppress a real permission prompt.
    const tail = '╭─────╮\n' + 'x'.repeat(50) + '\nDo you want to proceed?\n  ❯ 1. Yes'
    expect(classifyTail(tail)).toBe('fire')
  })
})
