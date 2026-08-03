---
source: primer.style
fetched_at: 2026-08-03T08:00:00Z
ttl_days: 30
fetched_via:
  - primer.style/product/components/data-table (first-party design-system docs)
---

# GitHub Primer DataTable — reference cache (ui-list-redesign-001)

First-party design-system documentation, so most values here are `[token]`.

## Density

Three cell-padding densities: **condensed / normal (default) / spacious**.
Spacious "enhances readability for dense or complex content".
`[token: primer.style]`

## Column widths

Strategies: `grow` (fill, optional maxWidth) · `growCollapse` (optional
minWidth) · `auto` (content-driven) · fixed px. Undefined defaults to `grow`.
`[token: primer.style]`

## Alignment

Left-aligned default; right-align (`align: end`) reserved for numbers.
`[token: primer.style]`

## Row actions

- One action: pull it out as a visible icon button.
- Multiple: put them in a dropdown; pull out AT MOST one heavily-used action.
- Action column headers visually hidden but present for a11y.
`[token: primer.style]`

## Sorting

- **One column must be sorted by default** — never present an "unsorted"
  table.
- Click toggles asc/desc; first click on an unsorted column sorts ascending.
`[token: primer.style]`

## Table anatomy

Title (h2) + optional subtitle (aria-describedby) + table-level actions slot +
divider. `[token: primer.style]`
