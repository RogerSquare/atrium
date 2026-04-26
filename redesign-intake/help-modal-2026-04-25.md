# Redesign intake — Help & Usage modal

**Area**: `frontend/src/components/HelpModal.jsx` + `frontend/src/components/HelpModal.content.js`
**Trigger**: User-invoked redesign-intake; one reference (Linear).
**Date**: 2026-04-25
**Pairs with**: `parity-check-audit` (post-implement verification — feeds the FR table below directly into its Feature Registry).

---

## Design Direction

### References

| Source | URL | Why this one |
| --- | --- | --- |
| Linear | https://linear.app + https://linear.app/brand + https://linear.app/now/how-we-redesigned-the-linear-ui | Gold standard for keyboard-first developer tools. Their `?` cheat-sheet modal is the prototype for this exact pattern — dense rows, accent restraint, hairline-over-shadow elevation, mono `kbd` chips for shortcuts inside copy. Also: Atrium's existing token shape (Apple-system fonts, accent + neutrals, hairline separators) already drifts toward Linear, so this is a reinforcement direction not a wholesale palette swap. |

Single-reference choice (vs the skill's recommended 3-5) is the requestor's explicit call. Risk: distilled palette skews fully Linear; no counterweight to push back on choices that don't suit a help/docs context. If post-intake review surfaces "this is too Linear-clone-y", add Vercel docs as a typography counterweight and re-run Phase A.

Cached at: `atrium/design-research/linear.md` (TTL 30 days).

### Distilled palette

- **Accent**: indigo `#5e6ad2` `[best-guess]` — for header icon, focus ring, copy-button confirmation, in-content link color.
- **Surface ladder** (dark mode): bg `#0f1011` `[best-guess]`, surface `#191a1b` `[best-guess]`, raised `#28282c` `[best-guess]`. Note: Atrium already has a comparable ladder (`--bg-app #1c1c1e`, `--bg-secondary #242426`, `--bg-card #323234`) — borrow the *contrast ratios*, not the literal hexes, so light/oled/paper themes still resolve coherently.
- **Borders**: hairline `#23252a` `[best-guess]` over `#34343a` `[best-guess]` for nested separators. Atrium's `rgba(255,255,255,0.08)` separator already encodes this — preserve.
- **Text ladder**: primary `#f7f8f8` `[best-guess]`, secondary `#d0d6e0` `[best-guess]`, tertiary `#8a8f98` `[best-guess]`, quaternary `#62666d` `[best-guess]`. Atrium currently has 3 tiers; consider adding a quaternary for the "Updated 2026-04-25 (v4)" stamp and footer pointer.
- **Typography**: Inter Variable `[token: linear.app/now/how-we-redesigned-the-linear-ui]` (body) + Inter Display `[token]` (headings). Atrium uses `-apple-system`; switching to Inter Variable across the help modal only (scoped via class) is the lower-risk move than a global swap. Keep SF Mono for code blocks (close enough to Berkeley Mono visually; no font load cost).
- **Type scale (modal-local)**: H2 modal title 20px/590 `[best-guess]` (currently 15px — too small), H3 section 16px/510 `[best-guess]`, body 14px/510 `[best-guess]`, code 13px mono `[best-guess]`, meta/footer 12px/400 `[best-guess]`.
- **Radii**: modal panel 12px `[best-guess]` (currently `--radius-md` 10px — close enough), buttons 6px `[best-guess]` (already `--radius-sm`), `kbd` chip 4px `[best-guess]` (new token needed).
- **Spacing inside modal**: 16/20/24px ladder `[best-guess]`. Atrium's `16px 20px` header / `20px 24px` body is on-scale.
- **Motion**: 140ms `[best-guess]` ease-out for hover/focus, 180ms `[best-guess]` ease-out for modal entry. Atrium's `--duration-fast 150ms` + `--ease-out` already aligns; preserve.
- **Smaller identity**:
  - **Borders over shadows** for in-modal section separation. Reserve `--shadow-popover` for the modal itself.
  - **Accent focus ring** (2px solid `#5e6ad2` at 40% alpha) replaces browser default focus outline. Atrium currently has no consistent focus ring — would be a meaningful a11y win.
  - **`kbd` chips** for keyboard shortcuts in the copy: mono font, 4px radius, 1px hairline border, slightly raised surface. Currently rendered as inline `<code>` — visual regression vs Linear's pattern.
  - **Hover = tone shift, not color shift**: copy button on hover lightens 4% rather than swapping color.
  - **Empty/error/loading**: not applicable (content is bundled, no async load) — leave.

---

## Preservation Contract

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |
| FR-001 | Per-codeblock Copy button (Copy → Check icon, 1.5s confirmation) | `HelpModal.jsx:19-54` | power-user | preserved |
| FR-002 | Copy button is hover-revealed on desktop, always visible on mobile | `HelpModal.jsx:42` | decorative | **replaced** — always-visible at 50% opacity, full opacity on hover (kills the "did this even have a copy button" discoverability bug) |
| FR-003 | Modal close button (X, top-right) | `HelpModal.jsx:86-94` | core-flow | preserved |
| FR-004 | Close button `aria-label="Close help"` | `HelpModal.jsx:89` | a11y | preserved |
| FR-005 | Copy button `aria-label="Copied"` / `"Copy to clipboard"` (state-toggled) | `HelpModal.jsx:41` | a11y | preserved |
| FR-006 | HelpCircle icon in header, accent-colored | `HelpModal.jsx:74` | decorative | preserved |
| FR-007 | "Help & Usage" header title | `HelpModal.jsx:83` | layout-invariant | preserved (but type scale up — see Distilled palette H2) |
| FR-008 | Modal max-width `sm:max-w-3xl` (~768px) | `HelpModal.jsx:60` | layout-invariant | preserved |
| FR-009 | Modal full-height on mobile, `sm:max-h-[85vh]` on desktop | `HelpModal.jsx:60` | layout-invariant | preserved |
| FR-010 | Click outside to dismiss | `ModalOverlay.jsx:57-59` | core-flow | preserved |
| FR-011 | Escape key dismisses | `ModalOverlay.jsx:8-13` | core-flow | preserved |
| FR-012 | Tab focus trap inside modal | `ModalOverlay.jsx:25-55` | a11y | preserved |
| FR-013 | Body scroll-lock while open | `ModalOverlay.jsx:15-23` | a11y | preserved |
| FR-014 | Backdrop blur (8px) + 40% black dim | `ModalOverlay.jsx:67-72` | decorative | preserved |
| FR-015 | Slide-up entry animation (mobile-first) | `ModalOverlay.jsx:76` | decorative | preserved |
| FR-016 | Fade-in overlay animation | `ModalOverlay.jsx:67` | decorative | preserved |
| FR-017 | Custom scrollbar in body | `HelpModal.jsx:98` | decorative | preserved |
| FR-018 | ReactMarkdown + remark-gfm rendering (tables, GFM checklists) | `HelpModal.jsx:100-105` | core-flow | preserved |
| FR-019 | `apple-press` micro-feedback on close + copy buttons | `HelpModal.jsx:42, 90` | decorative | preserved |
| FR-020 | Section: "Using the web UI → 5-status lifecycle" | `HelpModal.content.js:14-27` | core-flow | preserved |
| FR-021 | Section: "Creating tasks" (quick-create + template paths) | `HelpModal.content.js:29-35` | core-flow | preserved |
| FR-022 | Section: "Promoting a draft" | `HelpModal.content.js:37-39` | core-flow | preserved |
| FR-023 | Section: "Reading the activity log + comments" | `HelpModal.content.js:41-49` | core-flow | preserved |
| FR-024 | Section: "Mid-run approvals (waiting_input)" | `HelpModal.content.js:51-57` | core-flow | preserved |
| FR-025 | Section: "Reviewing agent work (closing checklist)" | `HelpModal.content.js:59-69` | core-flow | preserved |
| FR-026 | Section: "Phased tasks" (research → plan → implement) | `HelpModal.content.js:71-79` | core-flow | preserved |
| FR-027 | Section: "UI redesigns (`redesign-intake` skill)" | `HelpModal.content.js:81-89` | core-flow | preserved |
| FR-028 | Section: "Test-Driven Development (opt-in)" | `HelpModal.content.js:91-93` | core-flow | preserved |
| FR-029 | Section: "Filters" (sidebar filter description) | `HelpModal.content.js:95-97` | core-flow | preserved |
| FR-030 | Section: "Prompts for Claude Code terminal" — 7 copy-paste prompts | `HelpModal.content.js:101-171` | core-flow | preserved |
| FR-031 | "Updated 2026-04-25 (v4)" date stamp under H1 | `HelpModal.content.js:6` | decorative | preserved |
| FR-032 | Footer pointer to CLAUDE.md / skill as source-of-truth | `HelpModal.content.js:175` | decorative | preserved |
| FR-033 | Open from top-bar HelpCircle button | `App.jsx:307-313` | core-flow | preserved |
| FR-034 | Open from sidebar bottom-bar + "Help & Usage" link | `Sidebar.jsx:134, 506` | core-flow | preserved |
| FR-035 | Open from Command Palette ("help open usage") | `CommandPalette.jsx:217` | power-user | preserved |
| FR-036 | Open from AvatarPopover menu item | `AvatarPopover.jsx:136` | power-user | preserved |
| FR-037 | Open from mobile drawer | `App.jsx:232` | core-flow | preserved |

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |
| No `?` keyboard shortcut to open help | GitHub, Linear, Slack all bind `?` to open the cheat-sheet. Atrium has 5 click-paths but no kbd path — discoverability gap for keyboard-first users (the exact persona this modal serves). | **add** — register a global `?` handler that opens the modal (skip when focus is in an input/textarea). |
| No in-modal table of contents / sticky nav | Content is ~175 lines of markdown across 12+ sections. Finding "phased tasks" requires scroll-skim. Linear's docs pattern uses a sticky right-rail TOC; smaller cheat-sheet modals use a top tab strip. | **add** — sticky left-side mini-TOC OR top tab strip ("Web UI" / "Terminal prompts"). Tab strip is closer to the cheat-sheet pattern; left TOC is closer to docs. Lean tab strip — content already splits cleanly into those two halves. |
| No in-modal search/filter | At ~175 lines, Cmd+F still works but doesn't scope to the modal. A small search input that filters/highlights matches in the rendered markdown would close this. | **defer** — nice-to-have but adds search-state complexity. Tab strip + better hierarchy may make this unnecessary. Revisit post-implement. |
| No deep-link to a section | Can't share "the bit about phased tasks" — opening help drops you at the top every time. Each section heading should sync to a URL hash (`?help=phased-tasks` or fragment). | **partial** — add anchor IDs to section headings now (cheap), defer URL-hash sync to a follow-up. |
| No `aria-labelledby` on the dialog | `ModalOverlay` sets `role="dialog" aria-modal="true"` but doesn't reference the H2 title. Screen readers announce "dialog" without a name. | **add** — give the H2 an id and pass it as `aria-labelledby` through `ModalOverlay`. Generalizes to all modals using ModalOverlay (not just help) — out-of-scope creep risk; consider whether to do it just for help or threaded through the overlay. |
| Code blocks have no language label | The Copy button is great; not knowing whether you're copying `bash` vs `text` vs `json` is a small papercut. Linear/Vercel/Stripe all show the language. | **add** — small language tag in the top-left corner of each `<pre>`, mirroring the Copy button's top-right corner. ReactMarkdown surfaces the `language-*` class on the inner `<code>`. |
| Inline keyboard shortcuts rendered as `<code>` not `<kbd>` chips | The content references `?`, `Cmd+/`, `Cmd+F` inline using markdown backticks → `<code>`. Linear/GitHub render shortcuts in dedicated mono pill chips. Visual + semantic regression. | **add** — extend the ReactMarkdown `code` component renderer to detect single-token keyboard-shortcut content and render as `<kbd>` chips with a 4px radius mono treatment. |
| Mixed control vocabularies | Header has icon-only X (close); body has icon + text (Copy → Check). Acceptable since they're different roles, but if a tab strip is added (above), it should match the close button's icon-text-pair convention rather than introducing a third pattern. | **leave** — call out in implementation, no immediate change. |

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |
| FR-002 (copy button visibility) | Copy button uses `md:opacity-0 md:group-hover:opacity-100` while close button is always visible. Within the modal these are the only two interactive controls, and they use opposite visibility conventions. | **unified to siblings** — see FR-002 decision (always-visible at reduced opacity). |
| Header padding `16px 20px` vs body padding `20px 24px` | Different vertical AND horizontal rhythm between adjacent regions in the same panel. Linear's modals keep horizontal padding constant across header/body and only vary vertical. | **unified to siblings** — pick `20px 24px` for both (or `16px 24px` if header should stay shorter), so horizontal rhythm doesn't break across the separator. |
| FR-007 H2 size `var(--text-subhead)` (15px) | The modal title is 15px while the H1 inside the rendered markdown ("Atrium — Quick Reference") is much larger (likely 24-32px via prose styles). The modal's *own* title is smaller than the content's first heading — inverted hierarchy. | **unified to siblings** — promote modal H2 to ~20px/590 (Linear H3 scale). Remove the markdown H1 ("Atrium — Quick Reference") since the modal header already labels the panel — eliminates the redundancy. |
| FR-019 `apple-press` class on buttons | This is the only place in the modal where a sibling visual treatment (button micro-press feedback) is used. Other clickable surfaces inside the markdown (none — links use prose styles) don't get it. Consistent because there are no peers to deviate from. | **preserved unique** — no action; flagged so parity-check-audit doesn't grade this as a regression if untouched. |

---

## Open questions for the requestor (decide before phase-plan)

These are choices I made provisional decisions on above. Push back on any:

1. **Tab strip vs left TOC** — I leaned tab strip ("Web UI" / "Terminal prompts"). Confirm or flip. (Drives the implicit-affordance "no in-modal nav" decision.)
2. **`aria-labelledby` scope** — fix only in HelpModal, or thread through ModalOverlay so every modal benefits? Latter is correct but expands scope.
3. **`kbd` chip rendering** — extend ReactMarkdown renderer (clean, reusable) vs string-replace shortcuts in `HELP_CONTENT` to a custom syntax (simpler, brittle). I lean renderer — confirm.
4. **Inter Variable scope** — modal-only (scoped via CSS class) vs app-wide. Modal-only keeps the rest of Atrium's macOS-native rendering intact and is the safer bet. Confirm.
5. **Drop the markdown H1 ("Atrium — Quick Reference")?** — Resolves the inverted hierarchy in the uniqueness pass, but loses the version stamp's anchor (it currently sits under the H1). If dropped, move the version stamp to the modal footer or right-align it next to the X close button.
6. **Single-reference risk** — accepting the "skews fully Linear" risk noted at the top of References, or want me to add Vercel docs as a counterweight before phase-plan?

Once you answer, the next agent (phase-plan) consumes this doc directly. Don't reorder columns in the tables — `parity-check-audit` parses them positionally.
