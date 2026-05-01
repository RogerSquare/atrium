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
  /do\s+you\s+want\s+to\s+(proceed|continue|make\s+this\s+edit)/i,
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
