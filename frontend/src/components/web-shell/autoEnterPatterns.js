// Pure helpers for AutoEnterToggle's prompt detection. Kept in their own
// module (no React, no DOM) so the regex set can be unit-tested without
// pulling in component machinery.
//
// Two-tier matching: a tail buffer fires Enter only if it matches an
// allowlist pattern AND no denylist pattern. The denylist exists to
// keep the auto-presser away from prompts whose default option is
// destructive or whose context demands a human glance — confirmed
// deletes, overwrites, plan-mode execute gates, scope reconfirmations.

export const TAIL_WINDOW = 200

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
