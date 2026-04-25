---
name: redesign-intake
description: Use when starting a UI/UX redesign or refactor of an existing screen/component. Produces a pre-plan intake document with two halves — Design Direction (external research yielding hex/font/motion tokens) and Preservation Contract (literal + implicit + uniqueness affordance survey). Pairs with parity-check-audit for post-implement verification. Closes both knowledge-gap failure modes — requestor forgetting to mention features they assume will keep working, and vague design intent that has no concrete anchor.
---

# Redesign Intake

A pre-plan briefing that closes both knowledge-gap failure modes for UI redesigns:

1. **Lost features** — the requestor forgets to mention things they assume will keep working.
2. **Vague design intent** — "cleaner" / "more modern" / "better layout" with no concrete reference.

Output is ONE markdown intake document the human confirms in one pass. The output schema is locked (see `SCHEMA.md`) so the downstream `parity-check-audit` skill can parse the Preservation Contract directly.

## When to invoke

- Start of a `phase-research` task tagged `ui` / `redesign` / `refactor`.
- Human invokes via `/redesign-intake <area>`.
- Skip for green-field work — there's nothing to preserve and inspiration usually comes pre-named in the brief.

## Tools required

`Read`, `Grep` (always). `WebFetch`, `WebSearch` (Phase A only — degrade gracefully if absent: ask the requestor for inspiration verbally instead of researching it).

## Phase A — Design Direction

1. **Elicit references.** Ask the requestor for portfolios / products / brands they admire. If they have none (the knowledge-gap case), suggest 3–5 candidates appropriate to the project's domain. Cap at 5 — more dilutes the distilled palette.

2. **Research each via `WebFetch` / `WebSearch`.** Pull from marketing sites, design system docs, public Storybooks, brand guideline pages. Per reference, extract:
   - **Palette** — bg, surface, accent, text, muted (3–5 hex values)
   - **Typography** — family, weight scale, size scale (caption / body / heading)
   - **Spacing** — gutter, padding, density (compact / comfortable / spacious)
   - **Motion** — timing (ms), easing, what animates vs snaps
   - **Layout** — sidebar / topbar / zones, grid, content widths
   - **Smaller identity** — border radii, shadow tiers, icon style/weight, button hierarchy, form-field treatment, empty/loading states, hover/focus/active conventions

3. **Tag every value with provenance.** `[token]` if from published design tokens / brand guidelines / first-party docs; `[best-guess]` if from a screenshot or third-party article. **Non-negotiable** — unflagged speculation gets shipped as canon. Mixed is fine: `accent #5E6AD2 [token: linear.app/brand]` next to `surface #1F2227 [best-guess from dark-mode screenshot]`.

4. **Cache** each reference at `<project>/design-research/<reference-slug>.md` with a YAML stub at the top (`source`, `fetched_at`, `ttl_days: 30`). Reuse cached entries <30 days old; re-fetch otherwise. Avoids hammering the same Linear marketing page across 6 different intake runs.

5. **Synthesize a Distilled palette.** Pick what to borrow from each reference — don't average. Distilled values inherit the most-cautious provenance: borrowing a `[best-guess]` keeps it `[best-guess]`.

## Phase B — Preservation Contract

Run THREE passes on the target file(s). Each pass populates a separate table in the output.

1. **Literal-affordance survey.** `Read` the target file(s). List every: `onClick`, keyboard shortcut, conditional render branch, modal-open path, `aria-label`, callback prop the file accepts. Flat enumeration, no judgment. Each entry gets a sequential `FR-NNN` id and a `<file>:<line>` source.

2. **Implicit-affordance pass.** Surface what's MISSING that's a regression risk. Bounded to four categories:
   - Expected-but-unbound keyboard shortcuts (Cmd+F to focus search? `/` shortcut?)
   - Mixed control vocabularies (native `<select>` next to `<Button>` next to chip toggles)
   - Missing states (no empty / loading / error)
   - Unlabeled controls (missing `aria-label` where peers have one)

   Don't expand into general code review.

3. **Uniqueness scan.** Flag affordances whose visual treatment differs from siblings: button variants, chip styles, status colors, icon treatments, per-element `style={{...}}` overrides. The canonical case: a "Stale" toggle using orange-tinted active state when every other toggle uses accent. Bounded to sibling-comparison within the surveyed file(s) — don't compare across the codebase.

4. **Categorize** every item from steps 1–3: `core-flow` / `power-user` / `admin-only` / `decorative` / `dead-code-suspect` / `a11y` / `layout-invariant`.

5. **Question the requestor** per item. Decisions: `preserved` / `replaced` / `dropped` / `moved`. For uniqueness items add: `preserved unique` / `unified to siblings`.

## Output

One markdown file at the path the requestor names (default `<project>/redesign-intake/<area>-<YYYY-MM-DD>.md`). The file MUST follow `SCHEMA.md` exactly — column order, header text, and the `FR-NNN` numbering scheme are all consumed by `parity-check-audit` downstream.

## Bounds (anti-scope-creep)

- **3–5 references max** per intake. More dilutes the palette.
- **Phase A produces design *language*, not pixel mocks.** No image generation, no component renders. The output feeds `phase-plan`, which still owns the implementation strategy.
- **One-pass elicitation per phase.** ≤2 follow-up questions. If the requestor flip-flops, that's a `grill-me` problem, not yours.
- **Implicit pass is bounded** to the four named categories. Don't drift into general code review.
- **Uniqueness scan is bounded** to sibling-comparison within the surveyed file(s). Don't compare across the codebase.
- **No login-walled or copyrighted style guides.** Skip gracefully when WebFetch hits an auth wall.

## Pairs with

`parity-check-audit` — verifies post-implement that the Preservation Contract from this intake was honored. The two skills bookend the redesign cycle: this one produces the contract, that one enforces it. If you only run one, you have half the loop.
