# Redesign intake — Mobile web UI (mobile-ui-rework-research-001)

Requestor brief, verbatim: "I specifically have issues with the overly
cramped ui elements and buttons in my iphone when using atrium, please have
it specifically respect the safe zones so that buttons stay on screen and
make the view minimal another issue I saw was task modals were having issues
letting user selet a far right option like shell so no work can be done."

Three tracks: (A) de-cramp — a MINIMAL mobile view, not a shrunken desktop;
(B) safe-area correctness on every fixed surface; (C) BLOCKER — the task
detail tab strip clips its right-hand tabs (Shell) off-screen.

## Measured defects (Playwright probe, 375×667)

| Defect | Measurement | Source |
| --- | --- | --- |
| Detail tab strip overflows, unreachable tabs | strip scrollWidth **493px** in a 375px viewport, `overflow-x: visible` — Tests ends at 429, **Shell spans 433→493 (fully off-screen)**; the fixed overlay (`overflow: hidden`) clips it with no scroll affordance | DetailPane.jsx:234-242 |
| Board mobile column tabs overflow | Done tab ends at **411px** in a 375px viewport (5 × 1fr grid with min-content wider than the screen) | Board.jsx:265-317 |
| MobileTabBar taller than its carve-out | bar measures **65px**; layout reserves 56px (`calc(100dvh - 56px)`, index.css:583-585). With iPhone home-indicator inset (~34px) the bar grows to ~87px and covers content | MobileTabBar.jsx:50-53, index.css:842-847 |
| viewport-fit=cover without insets | `viewport-fit=cover` is set (index.html:6) so the app extends under notch/home bar — every fixed surface WITHOUT safe-area padding gets clipped: DetailPane overlay (DetailPane.jsx:133-135), GlobalShellPanel (GlobalShellPanel.jsx:73-75), ChatPanel (ChatPanel.jsx:77), ModalOverlay (ModalOverlay.jsx:69). Only the Preview FAB (AppShell.jsx:730-731) and MobileTabBar bottom pad are correct | audit |

## Design Direction

### References

| Source | URL | Why this one |
| --- | --- | --- |
| Apple HIG — layout & inputs | developer.apple.com/design/human-interface-guidelines | **44×44pt minimum touch target** `[token: Apple HIG]`; safe-area layout guides `[token]`; large-title + bottom-tab vocabulary `[token]`. Values from first-party docs (working knowledge, not re-fetched this cycle). |
| Linear (mobile posture) | linear.app | Cache: `design-research/linear.md` (<30d, reused). Fewer, bigger controls on small screens; navigation collapses into one bottom surface `[best-guess]`. |
| Atrium in-house: the dormant iOS vocabulary | frontend/src/index.css:574-703 | Someone already built the mobile kit and never wired it: `.ios-tab-bar` (49px + safe-bottom), `.ios-row` (min-height 44px), `.sheet-handle`, `.safe-top/bottom/left/right`, `.mobile-large-title`, `.momentum-scroll`, `.snap-x-mandatory` — ALL currently unconsumed. The redesign should activate this kit, not invent a new one. |

### Distilled palette (structural; colors/type stay Atrium tokens)

- **One bottom surface owns mobile navigation** — the tab bar is the home for
  view switching; chrome elsewhere gets sparser, not denser `[best-guess: Linear/HIG]`
- **44px minimum for anything tappable**; rows use `.ios-row` `[token: HIG]`
- **Every fixed/full-screen surface pads with `--safe-top`/`--safe-bottom`**
  (vars already exist, index.css:129-132) `[token: HIG]`
- **Horizontal strips that can overflow must scroll with momentum + snap and
  show an affordance (edge fade)** — never clip `[best-guess]`

## Preservation Contract

FR numbering continues from FR-084 (project-hub intake).

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |
| FR-085 | MobileTabBar: 4 actions — view-cycle, New task, Chat (with unread badge), Global shell; active tint; aria-labels | MobileTabBar.jsx:54-77 | core-flow | preserved |
| FR-086 | View-cycle covers board → list → changes | MobileTabBar.jsx:14 | core-flow | preserved (scope question Q2: hub/files/graph unreachable) |
| FR-087 | Task detail on phone = full-screen overlay, slide-in from right, Close button (28px), Esc closes | DetailPane.jsx:130-163, 228-230 | core-flow | preserved |
| FR-088 | Detail tab strip: Description/Comments/Activity/Changes/Tests/Shell + localStorage persistence (taskBoardDetailActiveTab) | DetailPane.jsx:31-51, 234-270 | core-flow | preserved — layout MUST change (the blocker) |
| FR-089 | Shell tab layer stays mounted across tab switches (terminal state survives); CommandCard reserves bottom 56px | DetailPane.jsx:288-307 | core-flow | preserved |
| FR-090 | Status segmented control inside Description tab; waiting_input renders a non-interactive badge | DetailPane.jsx:338-370 | core-flow | preserved |
| FR-091 | Board mobile: column segmented control (44px minHeight tabs, counts) + swipe left/right between columns | Board.jsx:265-338 | core-flow | preserved |
| FR-092 | TaskCard inline status select below 640px | TaskCard.jsx:351-359 | core-flow | **dropped** — requestor decision 2026-08-04 ("lets just stick with the option in the modal status change"); status changes on mobile go through the detail view's segmented control |
| FR-093 | ListView mobile: card list (list-card), group-by select, collapsible group headers, priority edge color, depth indent | ListView.jsx:334-412 | core-flow | preserved |
| FR-094 | FilterBar: horizontally scrollable pill row (search + type + priority + Mine/Today/Stale/Active shells + Reset + count), scrollbar hidden | FilterBar.jsx:33-206 | core-flow | preserved |
| FR-095 | TopBar mobile set: brand, ProjectAnchor, ApprovalsBell (+count badge, 300px menu), Avatar menu | TopBar.jsx:51-168 | core-flow | preserved |
| FR-096 | ModalOverlay below 640px: full-screen bottom sheet, focus trap, Esc + backdrop close, body scroll lock | ModalOverlay.jsx:8-80 | layout-invariant | preserved |
| FR-097 | ChatPanel below 640px: full-screen (z-50), Team/AI segments, users + sound toggles, Close (34px) | ChatPanel.jsx:59-142 | core-flow | preserved |
| FR-098 | GlobalShellPanel narrow: full-screen (z-45), background-task back-chip, Close (28px) | GlobalShellPanel.jsx:71-236 | core-flow | preserved |
| FR-099 | Preview-services FAB: 48px, safe-area-inset left+bottom (the one fully correct element) | AppShell.jsx:714-747 | core-flow | preserved unique |
| FR-100 | 16px font-size on inputs below 768px (blocks iOS focus zoom); .pill-input exempt | index.css:669-671 | layout-invariant | preserved |

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |
| BLOCKER: tab-strip clipping | FR-088's strip has no wrap, no overflow-x, no scroll affordance — measured 493px of content in 375px (Shell fully off-screen). Same pattern latent in Board's column tabs (411px). Any horizontal strip needs scroll+snap+edge-fade or compression. | add |
| Tab bar vs layout mismatch | Bar is ~65px (87px with home indicator) but the shell carves out 56px — bottom of every view is covered. The dormant `.ios-tab-bar` (49px + --safe-bottom) was built for exactly this. | add |
| Safe-area holes | DetailPane / GlobalShellPanel / ChatPanel / ModalOverlay: fixed, inset 0, NO safe-area padding, under viewport-fit=cover. Top content sits under the notch; bottom controls under the home indicator. | add |
| Touch-target violations | Detail tabs ~30px; TopBar icon buttons 28px; facelift pills 28px; detail Close 28px; chat Close 34px — all below the checklist's 44px minimum. `.ios-row` exists unused. | add |
| Two breakpoint systems | JS/matchMedia at 768px vs tailwind `sm:` at 640px → a 640–768 dead zone with mixed behavior (e.g. TaskCard status select <640 while mobile branches are <768; 4 raw `innerWidth>=640` radius hacks). | add |
| Swipe with no threshold | Board column swipe fires on ANY nonzero delta (Board.jsx:103-111) — vertical scrolls with slight x-drift switch columns. | add |
| A11y gaps | Detail tabs: no testid/aria-controls; MobileTabBar nav unlabeled, no aria-current; ListView group headers: no aria-expanded/testid; chat controls: no testids. | add |
| Dead mobile CSS kit | index.css:574-703 declares 14 mobile utilities with zero consumers — activating them IS the minimal-view direction. | add |

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |
| FR-099 Preview FAB | Only element using env(safe-area-inset-*) inline — the pattern to standardize via the --safe-* vars. | preserved unique |
| Z-stack | chat 50 > shell 45 > detail/tab-bar 40 (DOM order breaks the tie) — any new surface must slot deliberately. | preserved unique |
| Always-mounted Shell layer (FR-089) | Display-toggled, never unmounted — a scrollable tab strip must not remount it. | preserved unique |

## Research findings beyond the contract

1. **The blocker is a one-line-class defect, not a redesign** — the strip
   needs `overflow-x auto + snap + edge fade` (or icon-compression); it can
   ship as impl Phase 1 while the rest of the rework proceeds.
2. **The minimal-view direction is largely "wire the existing kit"** — the
   iOS utility classes, --safe-* vars, and 44px row class already exist.
3. **Breakpoint unification is the highest-leverage structural fix** — one
   source of truth (768px via useIsMobile + a matching tailwind screen) ends
   the 640–768 dead zone.
4. **e2e**: board-cards / list-view specs run at desktop width; only
   Board/ListView have explicit mobile branches with coverage gaps — a
   mobile-viewport Playwright project (390×844) would lock all of this in.

## Open questions for the requestor (starred = recommended)

- **Q1 — Blocker fix shape?** ★ Scrollable tab strip (momentum + snap +
  edge-fade affordance, labels kept). Alternatives: icon-only tabs that fit
  statically; a "More" overflow menu for trailing tabs.
- **Q2 — Mobile navigation scope?** ★ Keep the 4-slot tab bar but the view
  slot opens a view-picker sheet covering ALL six views (hub/files/graph are
  unreachable today). Alternative: keep cycling 3 views only.
- **Q3 — Breakpoint unification?** ★ Unify on 768px (single source of
  truth; migrate sm: usages in the mobile surfaces). Alternative: leave the
  two systems and only fix the named defects.
- **Q4 — Cycle scope?** ★ Surgical: blocker + safe areas + tab-bar sizing +
  44px targets + swipe threshold this cycle; the fuller "minimal redesign"
  (large-title headers, sheet handles, per-view slimming) as a follow-up
  cycle. Alternative: do the full minimal redesign now.
