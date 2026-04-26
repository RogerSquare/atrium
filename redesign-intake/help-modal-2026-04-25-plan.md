# Help & Usage modal — implementation plan

**Source of truth**: `redesign-intake/help-modal-2026-04-25.md` (the intake; do NOT re-derive decisions).
**Atrium task**: `ui-help-modal-plan-001`.
**Next phase**: `ui-help-modal-impl-001` will consume this plan.

---

## Confirmed decisions (intake + plan-time)

From the intake (do not re-litigate):
1. Tab strip with two tabs ("Web UI" / "Terminal prompts"), sticky in header.
2. `aria-labelledby` threaded through `ModalOverlay` (every modal benefits).
3. `<kbd>` chips via extended ReactMarkdown `code` renderer.
4. Inter Variable scoped to the modal via a CSS class.
5. Drop the markdown H1 (`# Atrium — Quick Reference`); move version stamp to footer next to a "View source" link.
6. Single-reference (Linear) palette skew accepted.

Plan-time:
7. `?` global handler lives in `AppShell.jsx`; suppressed when focus is in `input` / `textarea` / `[contenteditable]` and when any other modal is open.
8. Tab data model: split into `HELP_CONTENT_WEB_UI` and `HELP_CONTENT_TERMINAL` constants.
9. kbd-chip detection: conservative allowlist — token contains `+`, OR is exactly one of `?` `/` `Esc` `Tab` `Enter` `Space` `↑↓←→`.
10. Code-block language label: top-left of `<pre>`, mirrors Copy button top-right.
11. Inter Variable delivery: self-hosted woff2 in `frontend/public/fonts/`. No CDN.
12. `aria-labelledby` thread-through ships in this PR but in its own phase (Phase 5) so the diff is bounded.

---

## Phasing overview

| # | Phase | Risk | Scope |
| --- | --- | --- | --- |
| 1 | Token + font foundation | low | Asset + CSS only; no UI behavior change. |
| 2 | Modal shell rework | low | `HelpModal.jsx` + `HelpModal.content.js` only. |
| 3 | ReactMarkdown extensions | medium | kbd renderer + anchor IDs + code-block language label. |
| 4 | Tab strip | medium | Split content + active-tab state + sticky tab strip. |
| 5 | `aria-labelledby` thread-through + global `?` shortcut | high | Touches every `ModalOverlay` consumer. |

Each phase is a single commit. Rollback = `git revert <sha>`. No feature flag.

---

## Phase 1 — Token + font foundation

**Goal**: Land all new design tokens and the font asset before any component change. Modal still renders identically at end of phase.

**Files added**:
- `frontend/public/fonts/InterVariable.woff2` — single variable file, all weights via axis.
- `frontend/public/fonts/InterDisplay.woff2` — display variant for headings.
- (No third-party CDN; offline-friendly.)

**Files modified**: `frontend/src/index.css`
- Add `@font-face` declarations for `Inter Variable` and `Inter Display` with `font-display: swap`.
- Add `.font-help` scoped class: `font-family: 'Inter Variable', -apple-system, ...; font-feature-settings: 'cv11', 'ss01';`. Heading-rule selector inside `.font-help` uses `'Inter Display'`.
- Add token vars (dark theme block, mirror across light/oled/paper):
  - `--kbd-bg`, `--kbd-border`, `--kbd-text` — chip surface, hairline, text.
  - `--code-lang-text` — code-block language label color (muted).
  - `--accent-focus-ring: 0 0 0 2px rgba(94, 106, 210, 0.4);` — accent ring shadow.
  - `--text-h2-modal: 20px;`, `--leading-h2-modal: 1.33;`, `--weight-h2-modal: 590;` — modal-specific H2.
- Add `.kbd-chip` class block: 4px radius, 1px border, 12px mono, padding `2px 6px`, line-height 1.

**Verify**:
- `npm run dev` boots without warnings.
- Open help modal — visual is unchanged (no class applied yet).
- DevTools: `font-face` rules present; `var(--accent-focus-ring)` resolves on `:root`.
- `npm run lint` clean.

**Rollback**: `git revert` — purely additive. No existing class or token redefined.

---

## Phase 2 — Modal shell rework

**Goal**: Bring the modal chrome to spec. No content-rendering changes yet.

**Files modified**: `frontend/src/components/HelpModal.jsx`
- Add `font-help` class to the modal root container.
- Change header padding `16px 20px` → `16px 24px` (constant horizontal rhythm with body).
- Promote H2 inline style: `fontSize: 'var(--text-h2-modal)'`, `fontWeight: 'var(--weight-h2-modal)'`, `lineHeight: 'var(--leading-h2-modal)'`.
- Give H2 an explicit `id="help-modal-title"` (consumed in Phase 5).
- Add new footer row inside the modal panel: full-width 0.5px top border, padding `12px 24px`, flex space-between. Left: `<span>` rendering `VERSION_STAMP` constant in `text-tertiary` 12px. Right: `<a>` "View source ↗" linking to the `CLAUDE.md` GitHub URL, accent color, opens in new tab with `rel="noopener"`.
- Copy button (inside `CodeBlockWithCopy`): replace `md:opacity-0 md:group-hover:opacity-100` with `opacity-50 group-hover:opacity-100 focus-visible:opacity-100`. Keep mobile always-visible (already the default after this change).

**Files modified**: `frontend/src/components/HelpModal.content.js`
- Delete the `# Atrium — Quick Reference` line.
- Delete the `_Updated 2026-04-25 (v4)_` line.
- Export new constant `VERSION_STAMP = 'Updated 2026-04-26 (v5)'` (bump v4 → v5 since this redesign ships substantive content changes).
- Export new constant `SOURCE_URL = 'https://github.com/RogerSquare/atrium/blob/main/CLAUDE.md'` (or actual repo URL — verify in implement).

**Verify**:
- Modal opens. Title is visibly larger and bolder than before.
- Footer renders with version stamp left, "View source ↗" right.
- Copy button is faintly visible at rest (50%), full opacity on hover and on keyboard focus.
- 375px viewport: footer doesn't overflow; "View source ↗" wraps gracefully or truncates with ellipsis.
- 1280px viewport: header padding feels balanced with body.
- Tab through the modal: focus ring is visible on close button, copy button, and "View source" link (Phase 1's `--accent-focus-ring` not yet applied — default focus visible is fine).

**Rollback**: `git revert` — single commit. Content constants are appended (existing default export of `HELP_CONTENT` keeps the same shape minus two lines).

---

## Phase 3 — ReactMarkdown extensions

**Goal**: Render shortcuts as `<kbd>` chips, add anchor IDs to headings, label code blocks by language. No content-source changes.

**Files modified**: `frontend/src/components/HelpModal.jsx`
- Extend the `components` prop on `<ReactMarkdown>`:
  - **`code`** — distinguish inline from block (block goes through `pre` already). For inline: extract text content; if it matches the kbd allowlist, render `<kbd className="kbd-chip">`; otherwise fall through to the default inline `<code>` rendering.
  - **`h2`, `h3`** — auto-generate `id` via inline slugifier (`text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')`). No new dep.
  - **`pre`** (replace existing `CodeBlockWithCopy`) — extract `language-*` class from inner `<code>` children's props, render a `<span className="code-lang-tag">` absolutely positioned top-left if language is present, alongside the existing top-right Copy button.
- kbd allowlist literal (place near the renderer):
  - Token contains `+` (any modifier chord), OR
  - Token is exactly one of: `?`, `/`, `Esc`, `Tab`, `Enter`, `Space`, `Shift`, `Ctrl`, `Cmd`, `Opt`, `Alt`, `↑`, `↓`, `←`, `→`.

**Files modified**: `frontend/src/index.css`
- Add `.code-lang-tag` block: absolutely positioned top-left, 11px mono, `--code-lang-text`, padding `4px 8px`, no background. Hidden on hover when Copy button is hovered (avoids visual collision; both can be tiny enough to coexist — verify in implement).

**Verify**:
- Scan `HELP_CONTENT` for kbd matches mentally:
  - Should chip: `?`, `Cmd+/`, `?`, `Esc` (if any).
  - Should NOT chip: `id`, `key`, `task`, `feat-auth-001`, `\`{category}-{descriptor}-{NNN}\``, status names like `draft`, `todo`.
- DevTools inspect `<h2>` and `<h3>` elements — each has a stable `id`.
- Each code fence shows its language label top-left (`bash`, `text`, `markdown`).
- Copy button still works.

**Rollback**: `git revert` — additive renderer; default behavior preserved for any token that doesn't match.

---

## Phase 4 — Tab strip

**Goal**: Split content into two tabs. The modal opens to "Web UI"; "Terminal prompts" is one click away.

**Files modified**: `frontend/src/components/HelpModal.content.js`
- Split the existing `HELP_CONTENT` constant:
  - `HELP_CONTENT_WEB_UI` — everything from the start through the end of "Filters" (i.e. the "Using the web UI" body and all sub-sections).
  - `HELP_CONTENT_TERMINAL` — everything from "## Prompts for Claude Code terminal" through the end (footer pointer included).
- Delete the markdown `## Using the web UI` and `## Prompts for Claude Code terminal` H2 lines from inside the constants — the tab labels carry that role now.
- Delete the `---` separators that bracketed those sections.

**Files modified**: `frontend/src/components/HelpModal.jsx`
- Add `const [activeTab, setActiveTab] = useState('web-ui')`.
- Add a sticky tab strip between header and body: `<div role="tablist">` with two `<button role="tab" aria-selected={activeTab === ...} aria-controls="help-tabpanel">` items. Active tab gets accent underline (2px, `--accent-app`); inactive is `--text-muted` with 1px transparent underline (prevents layout shift on swap).
- Body wraps in `<div role="tabpanel" id="help-tabpanel">`.
- Render `activeTab === 'web-ui' ? HELP_CONTENT_WEB_UI : HELP_CONTENT_TERMINAL`.
- On tab change: scroll body container to top (`scrollContainer.scrollTop = 0`).
- Keyboard: `←` / `→` cycle tabs when tablist has focus (standard ARIA tabs pattern).

**Verify**:
- Click each tab → content swaps, body scrolls to top.
- Keyboard: focus a tab, arrow keys cycle, Tab moves to body.
- Active-tab underline visible; inactive-tab muted.
- 375px viewport: tab strip fits; "Terminal prompts" doesn't truncate (consider shorter labels if it does — fallback "Web UI" / "Terminal").
- Reopening the modal resets to "Web UI" (acceptable v1).

**Rollback**: `git revert` — single commit. Previous one-blob render is one revert away.

---

## Phase 5 — `aria-labelledby` thread-through + global `?` shortcut

**Goal**: Make the help modal openable via `?`, and give every modal a screen-reader-readable name.

**Files modified**: `frontend/src/components/ModalOverlay.jsx`
- Accept new optional props: `titleId` (string) and `ariaLabel` (string fallback for modals with no visible heading).
- On the outer `<div role="dialog" aria-modal="true">`, conditionally set `aria-labelledby={titleId}` when `titleId` is provided; otherwise `aria-label={ariaLabel || 'Dialog'}`.

**Files modified — every `ModalOverlay` consumer** (grep `<ModalOverlay` to enumerate):
- `HelpModal.jsx` — pass `titleId="help-modal-title"` (the H2 id set in Phase 2).
- All other consumers — give the title element a deterministic id and pass it as `titleId`. Consumers without a visible heading pass `ariaLabel="<role>"` instead. Expected callsites (verify in implement, do not skip any):
  - Task-detail modal
  - Settings modal
  - Approval panel modal
  - Confirm-delete dialogs
  - Any other `<ModalOverlay` callsite found by grep.

**Files modified**: `frontend/src/components/shell/AppShell.jsx`
- Add new `useEffect` registering a `keydown` listener:
  - If `e.key !== '?'` → ignore.
  - If `e.metaKey || e.ctrlKey || e.altKey` → ignore (lets Cmd+? etc. pass through).
  - If `document.activeElement` matches `input, textarea, [contenteditable="true"]` → ignore.
  - If any of `showHelp`, `selectedTask`, `showSettings`, `showCommandPalette`, `showKitchenSink`, `showDesignStudio` is truthy → ignore (don't stack modals).
  - Else: `e.preventDefault(); setShowHelp(true);`.

**Files modified**: `frontend/src/components/HelpModal.content.js`
- Add a one-liner inside `HELP_CONTENT_WEB_UI` near the top: e.g. "_Press `?` anywhere to open this panel._" — the inline backtick on `?` will chip via the Phase 3 renderer.

**Verify**:
- Press `?` from the board view → modal opens.
- Open CommandPalette, type into it, press `?` → no second modal.
- Open task detail, press `?` → nothing happens (modals don't stack).
- Screen reader (VoiceOver / NVDA) announces "Help & Usage, dialog" when modal opens.
- Tab through every other modal — VO/NVDA each reads its labeled name, not just "dialog".
- 375px and 1280px regression check: no modal layout broke from the `aria-labelledby` change (purely a non-visual attribute).

**Rollback**: `git revert` — touches multiple files. If something breaks, partial revert order:
1. Revert just the `?` shortcut block in `AppShell.jsx` (least invasive).
2. Revert all consumer-side `titleId` props (keep `ModalOverlay` accepting it but unused).
3. Revert `ModalOverlay.jsx` last.

---

## Cross-cutting verification (run at end of each phase + at PR open)

- `npm run lint` — must be clean.
- `npm run build` — must succeed; no new bundle-size regression > 350KB (Inter Variable accounts for that one-time hit; nothing else should grow significantly).
- Visual sweep at 375px and 1280px viewport widths.
- Tab through the modal — every interactive element has a visible focus ring.
- Open from each entry point (FR-033 through FR-037: top-bar button, sidebar bottom-bar, sidebar Help link, command palette, avatar popover, mobile drawer) — all still open the modal.
- Press Escape → closes. Click outside → closes.
- Copy a code block → text lands in clipboard.
- The redesign-intake's 37 FRs all behave per their `Decision` column.

## What this plan does NOT do (out of scope; future tasks)

- URL-hash sync for deep-linking (`?help=phased-tasks`) — anchor IDs ship in Phase 3 but no URL listener.
- In-modal search — deferred per intake decision.
- Tab-state persistence across modal reopens — accepted v1 limitation.
- A separate `parity-check-audit` skill run — that's a follow-up task once impl ships.
- Touching `Sidebar.jsx`, `TopBar.jsx`, etc. for general design unification — strictly help-modal-scoped.
