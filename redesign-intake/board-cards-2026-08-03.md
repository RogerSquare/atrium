# Redesign intake — Board task cards (ui-card-redesign-001)

Requestor brief, verbatim: the task cards "are not straight forward or easy
to understand … but I do enjoy the info it provides now, maybe we just need a
clear looking card for each task."

**Governing constraint: clarity redesign, NOT density reduction.** Every
piece of information the card carries survives; hierarchy, grouping, and
visual vocabulary are what change.

## Design Direction

### References

| Source | URL | Why this one |
| --- | --- | --- |
| Linear (board cards + UI redesign blog) | https://linear.app/now/how-we-redesigned-the-linear-ui | One focal element per card, metadata as a single calm trailing cluster, "reduce visual noise / maintain alignment" as stated principles. Cache: `design-research/linear.md` (fresh, 2026-08-03). |
| GitHub Primer (density + action rules) | https://primer.style/product/components/data-table/ | "At most one pulled-out action" and density-tier guidance transfer directly to card footers. Cache: `design-research/primer-datatable.md` (fresh, 2026-08-03). |
| Atrium's own TaskRow v2 (internal) | frontend/src/components/viz/TaskRow.jsx | The list rows just shipped the one-focal-element treatment (PR #175); cards should read as the 2D sibling of that row — title leads, id demoted to a chip, muted metadata. |

### Distilled palette

Color/type/spacing tokens are Atrium's existing system — not up for grabs.
The direction is structural:

- **Card anatomy**: three zones `[best-guess: linear board screenshots]` — (1) a single signal cluster for "does this need me / is something running" (top-right), (2) the title as the ONE high-contrast element, (3) one calm metadata line at the foot. Today's card has SIX vertical zones (header chips, parent line, title, summary, viewers, footer badges).
- **One chip vocabulary**: every labeled pill goes through the shared `Badge`; icons reserved for silent states `[token: primer "one pulled-out action"]`
- **Redundant encodings collapse**: priority is currently said twice (left stripe + footer badge); one encoding + one control
- **Motion**: keep the existing gentle-pulse for needs-attention states only — pulsing is a budget, and today three different elements can pulse at once (`Needs you`, agent badge, assignee dot)

## Preservation Contract

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |
| FR-039 | Priority left stripe (3px, color-coded) | frontend/src/components/TaskCard.jsx:137 | layout-invariant | preserved |
| FR-040 | Card click opens detail; Enter/Space activate; role=button + aria-label | frontend/src/components/TaskCard.jsx:126 | core-flow | preserved |
| FR-041 | Bulk mode: click toggles selection, shift-click range-selects (clears text selection) | frontend/src/components/TaskCard.jsx:39 | power-user | preserved |
| FR-042 | Selection checkbox in header (bulk mode) | frontend/src/components/TaskCard.jsx:150 | power-user | preserved |
| FR-043 | ID chip (mono) carrying the PR-state dot | frontend/src/components/TaskCard.jsx:158 | power-user | replaced |
| FR-044 | Type chip (uppercase, per-type color) | frontend/src/components/TaskCard.jsx:166 | decorative | preserved |
| FR-045 | "Needs you" pulsing chip on waiting_input (testid card-waiting-indicator) | frontend/src/components/TaskCard.jsx:171 | core-flow | preserved |
| FR-046 | Component name (plain text, truncated) | frontend/src/components/TaskCard.jsx:189 | decorative | replaced |
| FR-047 | Parent-task line ("↑ id", mono, accent-tinted) | frontend/src/components/TaskCard.jsx:197 | power-user | replaced |
| FR-048 | Title, 2-line clamp | frontend/src/components/TaskCard.jsx:204 | core-flow | preserved |
| FR-049 | Summary line (italic activity digest, tooltip full text) | frontend/src/components/TaskCard.jsx:209 | core-flow | preserved |
| FR-050 | Viewer avatars (max 3, +N overflow, "viewing" label) | frontend/src/components/TaskCard.jsx:216 | core-flow | replaced |
| FR-051 | Priority badge click-to-cycle low→medium→high | frontend/src/components/TaskCard.jsx:246 | core-flow | replaced |
| FR-052 | Assignee badge with green pulse dot when in_progress | frontend/src/components/TaskCard.jsx:256 | core-flow | preserved |
| FR-053 | Due-date badge, urgency-colored (field 0% populated on this board) | frontend/src/components/TaskCard.jsx:269 | dead-code-suspect | preserved |
| FR-054 | "Agent" pulsing badge while an agent runs | frontend/src/components/TaskCard.jsx:279 | core-flow | preserved |
| FR-055 | "Stale" badge | frontend/src/components/TaskCard.jsx:284 | power-user | preserved |
| FR-056 | Conditional tests badge (run data or project declares suites) | frontend/src/components/TaskCard.jsx:293 | core-flow | preserved |
| FR-057 | Comments-present icon | frontend/src/components/TaskCard.jsx:304 | decorative | preserved |
| FR-058 | Done checkmark | frontend/src/components/TaskCard.jsx:305 | decorative | preserved |
| FR-059 | Mobile-only inline status Select in footer (sm:hidden) | frontend/src/components/TaskCard.jsx:307 | core-flow | preserved |
| FR-060 | Drag styling (accent outline + 1.02 scale; dnd owned by Board) | frontend/src/components/TaskCard.jsx:138 | layout-invariant | preserved |
| FR-061 | Selected / just-updated outline states | frontend/src/components/TaskCard.jsx:138 | decorative | preserved |
| FR-062 | Memo comparator in sync with every rendered task field (e2e_status bug is precedent) | frontend/src/components/TaskCard.jsx:321 | layout-invariant | preserved |
| FR-063 | Compact single-line variant (taskBoardCompact): title + state icons + avatar + tooltip | frontend/src/components/TaskCard.jsx:56 | power-user | preserved |
| FR-064 | Shell-session icon (processing pulse / attached / detached) — compact card ONLY | frontend/src/components/TaskCard.jsx:92 | core-flow | moved |

`replaced` = same information, new placement/vocabulary (FR-043 id chip gains
copy-on-click for row parity; FR-046/047 fold into a unified metadata line;
FR-050 loses the redundant "viewing" word, avatars + tooltip carry it;
FR-051 keeps the cycle interaction with a lighter control). FR-064 `moved` =
the shell indicator joins the FULL card's signal cluster (it is silently
compact-only today — an information GAIN, in the brief's spirit).

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |
| Dead copy handlers | `copied`/`linkCopied` state + `handleCopyId`/`handleCopyLink` (TaskCard.jsx:13-31) are defined but never rendered — the ID chip is a plain span. Cards can't copy ids; the new list rows can. Unused imports (Copy, Check, Link, UserCircle2) ride along. | add |
| Clipboard rejection bug (latent) | The dead handlers call `navigator.clipboard.writeText` without a catch — the exact unhandled-rejection bug just fixed in ListView. If revived as-is, it ships the bug. | add |
| Shell indicator absent on full card | `shellSession` is passed to every card but only the compact variant renders it (FR-064) — flip compact off and live-shell visibility silently vanishes. | add |
| Invisible keyboard focus | The full card sets `focus-visible:outline-none` (TaskCard.jsx:131) and repurposes `outline` for selected/drag states — a keyboard user tabbing the board gets NO visible focus. | add |
| Three simultaneous pulse animations | `Needs you`, the Agent badge, and the assignee activity dot all use animate-gentle-pulse — on a busy card they compete, defeating "pulse = look here". | add |
| Four chip vocabularies | Raw styled spans (id/type/needs-you) vs `Badge` components (priority/assignee/due/agent/stale/tests) vs plain text (component) vs bare icons — one card mixes four systems. | add |

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |
| FR-039 + FR-051 | Priority is encoded twice on one card (stripe AND labeled footer badge) — the only field said twice. | unified to siblings |
| FR-045 | "Needs you" is the board's loudest chip and exists nowhere else in the app in this form (the list uses a plain chip, the DetailPane a badge). | preserved unique |
| FR-052 | The green in-progress pulse dot on the assignee is a board-only signal. | preserved unique |
| FR-059 | The card-footer status Select is the only mobile-only form control in the app. | preserved unique |
| FR-047 | The "↑ parent" line is a board-only lineage hint (the list now shows lineage structurally via Thread grouping). | preserved unique |

## Research findings beyond the contract

1. **The complaint is an anatomy problem, not a data problem.** A full card
   stacks SIX vertical zones — header chip row, parent line, title, summary,
   viewers row, footer badge row — and the footer alone can hold six badges.
   The title (the answer to "what is this?") sits mid-sandwich at the same
   visual weight as chip text. Nothing leads; everything asks for attention.
2. **Four visual vocabularies** (raw spans, Badge components, plain text,
   bare icons) mean identical-importance facts render five different ways —
   the direct cause of "not straightforward".
3. **Glance-ranking map** (proposal validated against the elements): 1. what
   is this → title FR-048 + type FR-044; 2. does it need me / is it moving →
   needs-you FR-045, agent FR-054, shell FR-064, stale FR-055; 3. who owns
   it → assignee FR-052, viewers FR-050; 4. how is it verified → tests
   FR-056, PR dot (FR-043), done check FR-058. Today ranks 2 and 4 are
   scattered across header AND footer.
4. **TaskRow patterns that transfer**: title-first contrast, id-as-copyable-
   chip, single muted metadata line, shared-Badge vocabulary. **What
   doesn't**: rows are 1D scan lines; cards afford a signal CLUSTER (top
   corner) that rows can't.
5. **Seams that must not break**: dnd wiring + drag styling (Board owns
   Draggable, card only styles `isDragging`); compact mode (persisted
   `taskBoardCompact`, Board.jsx:39); memo comparator FR-062 must track any
   newly-rendered field; `card-waiting-indicator` testid
   (approvals-inbox.spec.js) and the tests-badge conditions
   (tests-tab-generic.spec.js) are contract points for existing e2e.
6. **e2e surface**: approvals-inbox.spec.js, tests-tab-generic.spec.js
   assert card internals; board interactions ride through card titles in
   several other specs. A card redesign needs its own spec the way the list
   got one.

## Open questions for the requestor (starred = recommended default)

- **Q1 — Card anatomy?** ★ Three zones: top line = id chip + type + a single
  right-aligned SIGNAL CLUSTER (needs-you/agent/shell/stale/done); middle =
  title (the one bright element) + summary; foot = one calm metadata line
  (priority control, assignee, tests, PR, comments). Alternative: keep the
  current six-zone stack and only restyle chips.
- **Q2 — Redundant priority?** ★ The stripe stays THE priority encoding; the
  footer control becomes a compact glyph-only cycle button (tooltip carries
  the word). Interaction and information survive; the text chip goes.
  Alternative: keep both encodings as-is.
- **Q3 — One chip vocabulary?** ★ Every labeled element renders through the
  shared Badge system; bare icons only for silent states; pulse reserved for
  "Needs you" alone. Alternative: visual-only cleanup of current mix.
- **Q4 — Full-card parity gains?** ★ Add the shell indicator to the full
  card's signal cluster and make the id chip copyable (both exist elsewhere;
  cards silently lack them). Alternative: keep full card as-is.
