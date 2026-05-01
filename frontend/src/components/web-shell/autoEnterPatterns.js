// Pure helpers for AutoEnterToggle's prompt detection. Kept in their own
// module (no React, no DOM) so the regex set can be unit-tested without
// pulling in component machinery.

export const TAIL_WINDOW = 200

export const PROMPT_PATTERNS = [
  /\([yYnN]\/[yYnN]\)/,
  /\[[yYnN]\/[yYnN]\]/,
  /press\s+enter/i,
  /continue\?/i,
  /proceed\?/i,
  /are\s+you\s+sure/i,
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

export function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
}

export function tailMatchesPrompt(buffer) {
  if (!buffer) return false
  const tail = stripAnsi(buffer).slice(-TAIL_WINDOW)
  return PROMPT_PATTERNS.some((re) => re.test(tail))
}
