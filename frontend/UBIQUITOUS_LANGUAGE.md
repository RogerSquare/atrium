# Atrium Frontend — Ubiquitous Language (Visual Design)

_Updated 2026-04-23_

**Purpose**: Give you vocabulary to put a *name* on what feels off in the UI. When you see something that bugs you but can't articulate why, skim this file — odds are the word is here. This file covers the *visual language* of the UI (design system, composition, polish). It's a sibling to the root `UBIQUITOUS_LANGUAGE.md`, which covers the task-board *domain*.

Anchored to what Atrium actually has: Tailwind v4 with `@theme` tokens, Apple HIG-inspired type + color + spacing scales in `src/index.css`, primitives in `src/components/ui/` (Button, Badge, Card, Select, IconButton), and feature components (TaskCard, Sidebar, Board, etc.) that consume them.

---

## Visual hierarchy

What the eye sees first, second, third.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Primary action** | The one control the user most likely wants on this screen; visually loudest | CTA, main button |
| **Secondary action** | Supporting controls that share the screen but must not compete with the primary | Alt action |
| **Focal point** | The single element the composition directs attention to | Hero, feature |
| **Weight** | How much visual "volume" an element has — driven by size, contrast, color, and density | Importance, emphasis |
| **Order of read** | The sequence a viewer scans elements in (usually top-left → bottom-right, modulated by weight) | Reading path |

## Spacing & rhythm

Whitespace is a design decision, not absence of one.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Spacing scale** | The fixed set of allowed gap values (Atrium: `--space-1`=4px through `--space-8`=32px, 4px-grid) | Margins, paddings (as free-form) |
| **Rhythm** | Repeating the same gap between the same kinds of elements so the eye locks into a beat | Consistency (too vague) |
| **Density** | Ratio of ink to whitespace per region — "dense" = packed, "airy" = roomy | Compactness |
| **Breathing room** | Whitespace deliberately left around a focal element so it reads as important | Padding (too vague) |
| **Grouping gap** | A larger gap that separates two groups of related items, distinct from the small in-group gap | Section break |
| **Gutter** | The gap between columns in a grid | Spacing (too vague) |
| **Optical alignment** | Alignment adjusted by eye rather than by bounding box, for glyphs and icons with off-center ink | — |

## Typography

How text is shaped.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Type scale** | The fixed set of allowed font sizes (Atrium: `caption2` 11px → `largeTitle` 34px) | Sizes (free-form) |
| **Weight (type)** | Font stroke thickness — Atrium uses 400/500/600/700 | Boldness |
| **Leading** | Line-height (Atrium: `leading-body` 1.47, `leading-tight` 1.2, `leading-caption` 1.3) | Line-spacing |
| **Tracking** | Letter-spacing (Atrium: `tracking-tight` -0.02em for large type, `tracking-wide` 0.01em for micro labels) | Kerning (wrong — kerning is pair-specific) |
| **Measure** | The width of a line of text in characters; ~45–75 is comfortable for body copy | Line-length |
| **Orphan / widow** | A single word or line left alone at the bottom/top of a block — visually distracting | Loose text |

## Color & contrast

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Token (color)** | A named color slot in the design system (`--color-app-text`, `--color-apple-blue`). Components use tokens, not hex | Theme var (ok, but prefer "token") |
| **Semantic token** | A token whose name describes *role* (`--color-app-accent`, `--color-app-text-muted`) | Color name |
| **Primitive token** | A token whose name describes *hue* (`--apple-blue`, `--apple-red`) | Raw color |
| **Contrast (ratio)** | Luminance ratio between foreground and background — WCAG AA requires 4.5:1 for body text, 3:1 for large text | Visibility |
| **Accent** | The single hue that marks interactive / active state (Atrium: Apple blue) | Highlight |
| **Surface** | A background layer — Atrium has `bg`, `bg-secondary`, `bg-tertiary`, `bg-card` | Fill (too vague) |

## Elevation & depth

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Elevation** | Perceived Z-distance above the base surface, typically expressed via shadow | Shadow (output), depth |
| **Shadow** | The visual treatment that conveys elevation | Drop-shadow |
| **Layer** | A horizontal plane in the z-stack (base, card, modal, tooltip, toast) | Z-level |
| **Backdrop** | The dimmed/blurred layer behind a modal that visually demotes the content beneath | Overlay |

## Component taxonomy

Atrium's codebase has two tiers — know which you're in.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Primitive** | A single-responsibility building block in `src/components/ui/` (Button, Badge, Card) | Atom, basic component |
| **Feature component** | A composed component tied to Atrium's domain (TaskCard, Sidebar, Board) | — |
| **Compound component** | A feature component exposing sub-pieces (e.g. `Modal.Header`, `Modal.Body`) | — |
| **Slot** | A named region inside a component where a parent can inject content | Placeholder |
| **Variant** | A named styling option on a primitive (`<Button variant="primary">`) | Style, mode |
| **Story (Storybook-ish)** | An isolated render of a component at a specific variant + state (Atrium has `__stories__/*.jsx`) | Demo |

## State & feedback

How components behave in time.

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Default state** | The resting appearance of an interactive element | Normal |
| **Hover state** | Cursor-over appearance; signals affordance on desktop | Mouseover |
| **Focus state** | Keyboard-focused appearance; must be clearly visible (accessibility requirement) | Selected |
| **Active state** | Currently-pressed or currently-selected appearance | Pressed |
| **Disabled state** | Non-interactive appearance; must not meet affordance contrast | Grayed-out |
| **Loading state** | Async-in-progress appearance (spinner, skeleton, shimmer) | Spinner (output) |
| **Empty state** | The display when there is no data to show; needs explicit design | Blank |
| **Error state** | Appearance when a control has invalid input or a call failed | Fail state |
| **Skeleton** | A gray placeholder that mimics final content shape while data loads | Ghost, shimmer |
| **Micro-interaction** | A small animation/transition tied to a specific user action (button press, toast enter) | Animation (too vague) |

## Consistency & drift

The vocabulary for "the tokens exist but the UI still feels off."

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Design system** | The full set of tokens + primitives + rules + stories that defines the visual language | Style guide |
| **Token drift** | A feature component using a raw value (e.g. `padding: '13px'`) instead of a token — invisible individually, corrosive at scale | Inconsistency (too vague) |
| **Primitive drift** | A feature component reimplementing a primitive (hand-rolled button instead of `<Button>`) | Duplication |
| **Variant explosion** | A primitive grew so many variants that callers stop knowing which to pick | Too many options |
| **One-off** | A component used in exactly one place that should have been composed from primitives | Custom |
| **Dead primitive** | A primitive in `ui/` that few feature components actually use | Unused |

## Polish

What separates "works" from "feels crafted."

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Affordance** | A visual cue that communicates what an element does (buttons look pressable, links look clickable) | Discoverability |
| **Feedback** | The system's visible acknowledgement of a user action (hover cue, toast, state flip) | Response |
| **Alignment (grid vs optical)** | Grid: bounding boxes align. Optical: adjusted by eye so ink looks aligned even when boxes aren't | — |
| **Easing** | The velocity curve of an animation (`ease-out` for enters, `ease-in` for exits) | Timing |
| **Delight moment** | A small, earned flourish (subtle animation, unexpected detail) that rewards attention | Easter egg |

---

## Relationships

- The **Design system** is composed of **Tokens** + **Primitives** + **Stories**; **Feature components** consume them.
- **Primitives** have **Variants** and **States**; **Feature components** inherit both by composing primitives.
- **Visual hierarchy** is produced by varying **Weight** across elements — weight is driven by **Type scale**, **Color contrast**, **Spacing**, and **Elevation**.
- **Rhythm** is **Spacing scale** applied consistently across components; breaks in rhythm are perceived as "sloppy" even when each local choice looks fine.
- **Token drift** and **Primitive drift** are the root causes of "the design system is there but the UI feels unrefined."
- **Polish** emerges from correct **States** + **Feedback** + **Easing** + **Optical alignment** — all cheap individually, compounding in effect.

## Example dialogue

> **You**: "The board feels cluttered but I can't say why."
> **Me**: "Two candidates — **density** (too many columns / too-small **gutters**) or **rhythm break** (inconsistent **grouping gap** between task cards vs between columns). Which is stronger on reload?"

> **You**: "This button is ugly."
> **Me**: "Separate the complaint. Is it **weight** (too loud/quiet for the **primary action**), **affordance** (doesn't look pressable), or **token drift** (custom padding bypassing the primitive)?"

> **You**: "The whole thing looks inconsistent."
> **Me**: "That's usually **token drift** + **primitive drift**. I can grep for raw hex and inline spacing in feature components to produce a drift audit — then we name specific offenders instead of a global vibe."

> **You**: "It's missing polish."
> **Me**: "Most common gap is missing **states** (focus, empty, loading, error), not missing animation. I'd audit states before touching micro-interactions."

## Flagged ambiguities

- **"Card"** is overloaded in this repo: `src/components/ui/Card.jsx` is a **Primitive**; `src/components/TaskCard.jsx` is a **Feature component**. When you say "the card," say which tier you mean or say "**task card**" vs "the card primitive."
- **"Refinement"** is what you reached for in natural language; it actually decomposes into **Rhythm**, **Drift**, **States**, and **Polish**. Prefer the specific term — "fix token drift in TaskCard" is actionable; "make the UI more refined" is not.
- **"Padding"** and **"Spacing"** are used interchangeably but shouldn't be. **Padding** is inside a box; **spacing** is between boxes. Mixing them in conversation hides whether you mean a layout issue or a component issue.
- **"Apple-style"** is used as shorthand for the token system but Apple HIG is a full philosophy (**optical alignment**, **rhythm**, **restraint in color**, **precise easing**). "Using the Apple tokens" ≠ "looks Apple-like."
- **"Sidebar"** means both the left nav in `Sidebar.jsx` and occasionally the right task detail panel in `TaskModal`. Prefer "**left nav**" and "**task detail panel**."
- **"Modal"** is used for any overlay; technically an overlay without a **backdrop** is a popover, not a modal.

## How to use this file

1. When the UI bugs you, skim the tables and find the word. "It's cluttered" → probably **density** or **rhythm**. "It feels off" → probably **drift**. "It's unpolished" → probably **states** or **feedback**.
2. In tasks, prefer specific terms: "Audit **token drift** in `TaskCard`" beats "clean up task card styling."
3. Add a term here when you catch one in conversation that isn't defined — this file is living.
