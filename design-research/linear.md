---
source: linear.app
fetched_at: 2026-08-03T08:00:00Z
ttl_days: 30
fetched_via:
  - linear.app/brand (first-party brand guide)
  - linear.app/now/how-we-redesigned-the-linear-ui (first-party engineering blog)
  - linear.app/docs/board-layout (first-party docs — grouping/display, 2026-08-03 refresh)
  - design.hagicode.com/previews/linear.app/light (third-party token extract)
  - mobbin.com/colors/brand/linear (third-party — fetch returned 403; not used)
---

# Linear — design-direction reference cache

## Provenance ground rules

- `[token]` = stated by Linear's published brand guide or engineering blog.
- `[best-guess]` = extracted from third-party preview / cited in third-party article. Plausible and internally consistent across multiple sources, but not first-party canon.

## Palette

| Role | Hex | Provenance |
| --- | --- | --- |
| Brand Indigo (accent) | `#5e6ad2` | `[best-guess]` (hagicode preview; widely cited as Linear's accent in third-party articles; brand guide describes it only as "a subtle desaturated blue") |
| Accent Violet (alt) | `#7170ff` | `[best-guess]` |
| Accent Hover | `#828fff` | `[best-guess]` |
| Mercury White (neutral) | `#F4F5F8` | `[token: linear.app/brand]` |
| Nordic Gray (neutral) | `#222326` | `[token: linear.app/brand]` |
| Marketing Black | `#08090a` | `[best-guess]` |
| Panel Dark (surface) | `#0f1011` | `[best-guess]` |
| Surface Level 3 | `#191a1b` | `[best-guess]` |
| Surface Secondary | `#28282c` | `[best-guess]` |
| Text Primary | `#f7f8f8` | `[best-guess]` |
| Text Secondary | `#d0d6e0` | `[best-guess]` |
| Text Tertiary | `#8a8f98` | `[best-guess]` |
| Text Quaternary | `#62666d` | `[best-guess]` |
| Border Primary | `#23252a` | `[best-guess]` |
| Border Secondary | `#34343a` | `[best-guess]` |
| Border Tertiary | `#3e3e44` | `[best-guess]` |

**Theme architecture**: Linear's redesign blog states they reduced theme variables to three — base, accent, contrast — and moved the math from HSL to LCH for perceptual uniformity. `[token: linear.app/now/how-we-redesigned-the-linear-ui]`

## Typography

Family: **Inter** (body) + **Inter Display** (headings). `[token: linear.app/now/how-we-redesigned-the-linear-ui]`
Mono: **Berkeley Mono**. `[best-guess]`

| Style | Size | Weight | Line height | Tracking | Provenance |
| --- | --- | --- | --- | --- | --- |
| Display headline | 48px | 510 | 1.00 | -1.056px | `[best-guess]` |
| H1 | 32px | 400 | 1.13 | -0.704px | `[best-guess]` |
| H2 | 24px | 400 | 1.33 | -0.288px | `[best-guess]` |
| H3 | 20px | 590 | 1.33 | -0.24px | `[best-guess]` |
| Body large | 18px | 400 | 1.60 | -0.165px | `[best-guess]` |
| Body | 16px | 510 | 1.50 | — | `[best-guess]` |
| Small | 15px | 400 | 1.60 | -0.165px | `[best-guess]` |
| Caption | 14px | 510 | 1.50 | -0.182px | `[best-guess]` |
| Meta | 13px | 510 | 1.50 | -0.13px | `[best-guess]` |
| Label | 12px | 510 | 1.40 | — | `[best-guess]` |
| Mono body | 14px | 400 | 1.50 | — | `[best-guess]` |

Note the unusual weights (510, 590) — variable-font-only values that read as "between Medium and Semibold". Inter Variable supports this; static-weight Inter does not.

## Spacing

Scale: **4 / 8 / 12 / 16 / 20 / 24 / 32 / 35** (px). `[best-guess]`

The "35" looks like a typo of 36 in the source; treat as 32 → 36 → 48 ladder if generalizing.

## Radii

| Size | Usage | Provenance |
| --- | --- | --- |
| 2px | Badges | `[best-guess]` |
| 4px | Small chips | `[best-guess]` |
| 6px | Buttons | `[best-guess]` |
| 8px | Cards | `[best-guess]` |
| 12px | Panels / modals | `[best-guess]` |
| 22px | Large surfaces | `[best-guess]` |
| 9999px | Pills | `[best-guess]` |

## Elevation

- Level 0 — flat
- Level 1 — micro lift (subtle inner ring + shadow)
- Level 2 — card (ring + subtle drop)
- Level 3 — elevated (ring + deeper drop)
- Inset — sunken panel
- Focus — **accent ring**, not OS focus outline. `[best-guess]`

## Motion

- Linear is famous for restrained motion. Specific timing values are not published; the ethos is **"snap, don't bounce"** — short cubic-bezier ease-outs in the 120-180ms range, no spring.
- View transitions: fade between pane states rather than slide.
- Focus state appears instantly (no animation), confirms via accent ring.
- All values: `[best-guess]` (inferred from product, not specified anywhere).

## Identity / smaller details

- **Density** is the brand's signature: rows are tight (24-32px row height in lists), padding is calm but not generous.
- **Keyboard-first**: every action has a shortcut, surfaced in tooltips and the `?` cheat-sheet modal.
- **Borders over shadows**: panels separate via 0.5-1px hairline borders in `#23252a` rather than drop shadows. Shadows are reserved for true elevation (popovers, modals).
- **Mono for shortcuts**: keyboard shortcuts inside copy are rendered in Berkeley Mono in pill-shaped chips, not inline `<code>`.
- **Empty/loading states**: Linear uses subtle skeleton shimmers, never spinners on primary surfaces.
- **Hover is a tone shift, not a color shift**: rows brighten by ~4% lightness on hover; controls darken by ~4%.

## What to borrow for Atrium's help modal

- Indigo accent — already aligns with Atrium's "accent rail" pattern.
- Inter family — Atrium currently uses `-apple-system`; Inter would tighten the Linear feel without breaking macOS native rendering.
- Berkeley Mono OR keep SF Mono for code blocks; visually similar.
- Hairline borders + accent focus ring as the elevation language.
- Restrained motion: 140-180ms ease-outs.
- `kbd`-style chips for keyboard shortcuts inside the help text.

## List grouping + display options (2026-08-03 refresh, for ui-list-redesign-001)

- Group by: Status (default), Focus, Project, Priority, Cycle, Label, Label
  group, SLA. `[token: linear.app/docs/board-layout]`
- Sort is a view-level "Sort" control supporting **stacked layers** (e.g.
  Priority, then Due Date within each priority). `[token: linear docs]`
- "Show empty groups" toggle; list and board share one ordering.
  `[token: linear docs]`
- Row anatomy (product observation): single line, ~36-40px `[best-guess]`;
  left→right = priority glyph · muted mono id · title (the ONLY high-contrast
  element) · trailing metadata chips + assignee avatar. One focal element per
  row. `[best-guess from screenshots]`
- Group headers: icon + name + count, per-group collapse.
  `[best-guess from screenshots]`
