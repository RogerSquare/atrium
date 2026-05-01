// Pure helpers for AutoEnterToggle's prompt detection. Kept in their own
// module (no React, no DOM) so the regex set can be unit-tested without
// pulling in component machinery.
//
// Three-class classifier: a tail buffer is one of
//   - 'denied'      — denylist match; never fire
//   - 'fire'        — allowlist match (and no denylist); send Enter
//   - 'input-field' — recognized idle state (CC input box, shell prompt)
//   - 'unknown'     — none of the above; capture for review (feat-
//                     autoenter-unknown-capture-001)
// Allowlist/denylist drive the auto-Enter behavior; the input-field /
// unknown distinction drives the capture loop that surfaces undocumented
// prompts the pattern set should learn.

export const TAIL_WINDOW = 200
// Smaller window for "idle" detection — input-field markers should be
// at the most recent edge of output, not somewhere in scrollback.
export const IDLE_TAIL_WINDOW = 100

// Allowlist — generic shell prompts and Claude Code's standard
// permission framings. The cursor pattern is the universal CC v2
// signal: every numbered-menu prompt renders the ❯ marker on the
// active option, and Enter selects it.
export const PROMPT_PATTERNS = [
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  /press\s+enter/i,
  /continue\?/i,
  /proceed\?/i,
  // Claude Code prompts: every permission/confirmation the CLI emits
  // begins with "Do you want to ..." (proceed, allow, run, make this
  // edit, etc.). The earlier narrow verb-list missed "Do you want to
  // allow Claude to fetch this content?" — bug-autoenter-claude-prompts-001.
  /do\s+you\s+want\s+to\b/i,
  // Claude Code's numbered-menu cursor (U+276F HEAVY RIGHT-POINTING
  // ANGLE QUOTATION MARK ORNAMENT). Strong second signal — when the
  // cursor sits on a numbered option, Enter selects it. Catches menu
  // prompts whose preceding question phrasing doesn't match the rules
  // above.
  /❯\s+\d+\.\s+\S/,
  // Claude Code's hint line — rendered at the BOTTOM of every
  // permission prompt, regardless of the question body length. Pairs
  // with the cursor rule (top-of-prompt) so prompts whose body pushes
  // the cursor past the 200-char tail window still match via the
  // hint at the bottom. Empirical fix from bug-autoenter-cc-hint-line-001
  // — long bash command approvals were silently missing because both
  // "Do you want to proceed?" and "❯ 1. Yes" fell out of the tail
  // window when the rendered command was tall enough.
  /Esc\s+to\s+cancel/i,
]

// Denylist — wins over the allowlist. Prompts here either have a
// destructive default or a context where the user wants to read what
// the assistant proposes before committing (plan-mode execute gates,
// scope reconfirmations).
export const DENY_PATTERNS = [
  // Generic "are you really sure" guard — used by every CC delete-
  // confirmation prompt and by many shell-script destructive prompts.
  /are\s+you\s+sure/i,
  // Any "Delete ... ?" framing — covers "Delete N item(s) for ALL
  // projects?", "Delete the agent X?", "Are you sure you want to delete
  // ...?" (the leading "are you sure" alone catches the second form,
  // but \bdelete\b catches the bare form CC also emits).
  /\bdelete\b[^\n?]{0,80}\?/i,
  // Bare "Overwrite?" prompt. Anchor on word boundaries so the substring
  // doesn't accidentally fire on text like "Don't overwrite anything?".
  /\boverwrite\?/i,
  // CC's various "Remove X?" prompts (server, marketplace, directory
  // from workspace, agent). Removing infrastructure should never be
  // auto-confirmed.
  /\bremove\s+(directory|server|marketplace|agent|a\s+marketplace)\b/i,
  // Plan-mode execute gate. The prompt is an explicit "I've written a
  // plan, want me to run it?" — the user typically wants to read the
  // plan before pressing Enter. The literal phrase comes from the CC
  // binary verbatim.
  /Claude\s+has\s+written\s+up\s+a\s+plan/i,
  // Scope reconfirmation prompt — same intent: pause for a human
  // glance.
  /can\s+you\s+confirm\s+the\s+scope/i,
]

// Idle-state markers — distinguish "the CLI is sitting at its normal
// input affordance" from "we're stuck somewhere unrecognized". Used by
// the capture loop to skip captures when the shell is just waiting for
// the user to type something.
export const IDLE_PATTERNS = [
  // Claude Code v2's text-input box: top + bottom borders use light-arc
  // box-drawing chars. Either one in the recent tail is a strong signal.
  /╭─{2,}/,
  /╰─{2,}/,
  // The hint line CC renders below the input box — strongest unique
  // marker since no other CLI emits this exact phrase.
  /\?\s+for\s+shortcuts/i,
  // Unix shell prompts ($/#/%) at end of buffer with optional trailing
  // whitespace. Negative lookbehind on digits keeps values like "100%"
  // from false-positiving as a zsh prompt.
  /(?<!\d)[$#%]\s*$/,
  // Windows path-style prompts (cmd.exe / PowerShell): drive letter +
  // separator + path + trailing > at end of buffer.
  /[A-Z]:[\\\/][^\n>]*>$/,
]

export function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

export function tailMatchesPrompt(buffer) {
  if (!buffer) return false
  const tail = stripAnsi(buffer).slice(-TAIL_WINDOW)
  // Denylist wins — never fire on destructive or plan prompts even if
  // an allowlist pattern (e.g., the cursor) also matches.
  if (DENY_PATTERNS.some((re) => re.test(tail))) return false
  return PROMPT_PATTERNS.some((re) => re.test(tail))
}

export function tailMatchesInputField(buffer) {
  if (!buffer) return false
  const tail = stripAnsi(buffer).slice(-IDLE_TAIL_WINDOW)
  return IDLE_PATTERNS.some((re) => re.test(tail))
}

// Single source of truth for the four classes. Order matters: denylist
// wins over fire (a delete prompt that also has the cursor must be
// skipped), and fire wins over input-field (a permission prompt that
// briefly overlaps with input-field paint must still fire).
export function classifyTail(buffer) {
  if (!buffer) return 'unknown'
  const stripped = stripAnsi(buffer)
  const tail200 = stripped.slice(-TAIL_WINDOW)
  const tail100 = stripped.slice(-IDLE_TAIL_WINDOW)
  if (DENY_PATTERNS.some((re) => re.test(tail200))) return 'denied'
  if (PROMPT_PATTERNS.some((re) => re.test(tail200))) return 'fire'
  if (IDLE_PATTERNS.some((re) => re.test(tail100))) return 'input-field'
  return 'unknown'
}
