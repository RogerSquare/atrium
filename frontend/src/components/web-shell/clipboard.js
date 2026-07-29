// Terminal clipboard support (bug-shell-clipboard-001).
//
// Terminal.jsx had no clipboard handling whatsoever — no
// attachCustomKeyEventHandler, no getSelection, no paste. Ctrl+C went to the
// PTY as SIGINT (correct) and Ctrl+V did nothing at all.
//
// The decision logic lives here, separate from the xterm wiring, because the
// interesting part is a set of rules about key events and can be tested
// without a DOM, a terminal, or a real clipboard.
//
// THE RULE THAT MUST NOT REGRESS: Ctrl+C with no selection is SIGINT. It is
// how you interrupt a runaway claude, and quietly turning it into "copy"
// would be a far worse bug than the one being fixed. Copy only wins when
// there is actually a selection to copy — which is Windows Terminal's
// behaviour and the least surprising option.

/** What the key handler decided should happen. */
export const ACTION = {
  COPY: 'copy',
  PASTE: 'paste',
  /** Let xterm handle it — i.e. send it to the PTY. */
  PASS: 'pass',
}

/**
 * Decide what a keydown means.
 *
 * @param {object} e            key event ({ key, ctrlKey, shiftKey, metaKey, type })
 * @param {boolean} hasSelection whether the terminal currently has a selection
 * @param {boolean} isMac        platform, injected so tests cover both
 */
export function decideKeyAction(e, hasSelection, isMac = false) {
  if (!e || e.type !== 'keydown') return ACTION.PASS

  const key = typeof e.key === 'string' ? e.key.toLowerCase() : ''

  // macOS: Cmd+C / Cmd+V are unambiguous — Ctrl+C stays SIGINT there too.
  if (isMac && e.metaKey && !e.ctrlKey) {
    if (key === 'c') return hasSelection ? ACTION.COPY : ACTION.PASS
    if (key === 'v') return ACTION.PASTE
    return ACTION.PASS
  }

  if (e.ctrlKey && e.shiftKey) {
    // The standard Linux/Windows terminal bindings.
    if (key === 'c') return ACTION.COPY
    if (key === 'v') return ACTION.PASTE
    return ACTION.PASS
  }

  // Bare Ctrl+C: copy ONLY when something is selected, otherwise SIGINT.
  if (e.ctrlKey && !e.shiftKey && key === 'c') {
    return hasSelection ? ACTION.COPY : ACTION.PASS
  }

  // Bare Ctrl+V is deliberately NOT paste: it is a legitimate control code
  // (literal-next in some readline configs), and shells expect to receive it.
  return ACTION.PASS
}

/**
 * Copy text to the clipboard, falling back when the async API is unavailable.
 *
 * `navigator.clipboard` requires a SECURE CONTEXT. localhost counts, so this
 * works on the host — but the same container reached over the LAN
 * (http://192.168.x.x:3100) does not, which is exactly how a containerized
 * board gets used from another machine. Without the fallback the fix would
 * work for whoever tested it and silently fail for everyone else.
 *
 * @returns {Promise<boolean>} whether the text reached the clipboard
 */
export async function writeClipboard(text, deps = {}) {
  if (!text) return false
  const nav = deps.navigator ?? globalThis.navigator
  const doc = deps.document ?? globalThis.document

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied or non-secure context — fall through.
    }
  }
  return legacyCopy(text, doc)
}

/**
 * Read the clipboard. Returns '' when unavailable.
 *
 * There is no legacy fallback for READING: document.execCommand('paste') was
 * never permitted in any browser for security reasons. When this returns
 * empty on a non-secure origin the caller surfaces that rather than leaving
 * the user pressing a key that does nothing.
 */
export async function readClipboard(deps = {}) {
  const nav = deps.navigator ?? globalThis.navigator
  if (!nav?.clipboard?.readText) return ''
  try {
    return (await nav.clipboard.readText()) || ''
  } catch {
    return ''
  }
}

/** True when the async clipboard API is usable at all. */
export function clipboardAvailable(deps = {}) {
  const nav = deps.navigator ?? globalThis.navigator
  const secure = deps.isSecureContext ?? globalThis.isSecureContext
  return !!(secure && nav?.clipboard?.readText)
}

/**
 * Text to copy when the user asks for "copy" without a selection.
 *
 * WHY THIS EXISTS: a full-screen TUI like Claude Code turns ON mouse tracking
 * (DECSET 1000/1002/1006). While that is active xterm forwards drags to the
 * APPLICATION instead of selecting text, so there is no selection to copy and
 * the key bindings appear to do nothing. Holding Shift bypasses mouse
 * reporting, but that is folklore — nothing in the UI says so.
 *
 * So: copy the selection when there is one, otherwise fall back to the
 * scrollback, which is what someone reaching for "copy" almost always wants.
 *
 * @param {object} term xterm Terminal
 * @param {number} maxLines cap so a 5000-line scrollback isn't dumped whole
 */
export function getTerminalText(term, maxLines = 2000) {
  if (!term) return ''
  const selection = typeof term.getSelection === 'function' ? term.getSelection() : ''
  if (selection) return selection

  const buf = term.buffer?.active
  if (!buf) return ''

  const end = buf.length
  const start = Math.max(0, end - maxLines)
  const lines = []
  for (let i = start; i < end; i++) {
    const line = buf.getLine(i)
    if (!line) continue
    // translateToString(true) trims trailing whitespace, which otherwise
    // pads every line out to the full terminal width.
    lines.push(line.translateToString(true))
  }
  // Drop trailing blank lines — the buffer is padded to the viewport height,
  // so without this every copy ends in a screenful of empty lines.
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

/**
 * Whether the running program has taken over the mouse, which is the reason
 * drag-to-select silently stops working. xterm exposes this; when it is on,
 * the UI can say "hold Shift to select" instead of leaving people guessing.
 */
export function mouseTrackingActive(term) {
  const mode = term?.modes?.mouseTrackingMode
  return !!mode && mode !== 'none'
}

/**
 * execCommand('copy') via a temporary textarea. Deprecated, but it is the only
 * thing that works on a non-secure origin, and copy is the direction users
 * hit most often (pulling a stack trace out of the terminal).
 */
function legacyCopy(text, doc) {
  if (!doc?.body) return false
  const ta = doc.createElement('textarea')
  ta.value = text
  // Off-screen rather than display:none — a hidden element cannot be selected.
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.setAttribute('readonly', '')
  doc.body.appendChild(ta)
  try {
    ta.select()
    return doc.execCommand ? doc.execCommand('copy') : false
  } catch {
    return false
  } finally {
    doc.body.removeChild(ta)
  }
}
