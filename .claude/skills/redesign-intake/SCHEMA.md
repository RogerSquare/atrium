# redesign-intake — output schema

Locked schema for the markdown intake document produced by the `redesign-intake` skill. The downstream `parity-check-audit` skill parses these tables directly during post-implement verification — keep column order and headers stable.

## Top-level structure

```
# Redesign intake — <area>

## Design Direction
  ### References
  ### Distilled palette

## Preservation Contract
  ### Literal affordances
  ### Implicit affordances flagged
  ### Uniqueness flags
```

Section order matters. `parity-check-audit` reads top-down looking for the `## Preservation Contract` heading, then expects the three `### …` sub-headings in this exact order.

## Tables

### References

| Source | URL | Why this one |
| --- | --- | --- |

Free-text — informational only. Not consumed by parity-check-audit.

### Distilled palette

Bullet list (not a table). Each line carries inline `[token]` or `[best-guess]` flags per value. Example:

```
- **Palette**: accent `#5E6AD2 [token: linear.app/brand]`, surface `#1F2227 [best-guess]`
- **Typography**: Inter `[token]`, 13px body `[best-guess]`, weights 400/500/600 `[token]`
- **Motion**: 140ms `[best-guess]` ease-out
- **Smaller identity**: chip radius 6px `[token: github/primer]`, focus ring 2px `[best-guess]`
```

Free-text — informational only.

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |

- `FR` — sequential `FR-001`, `FR-002` … never reuse numbers within the same area's intake history.
- `Affordance` — short label naming the user-facing behavior.
- `Source` — `<file>:<line>` reference. Required so parity-check-audit can re-read the original.
- `Category` — exactly one of: `core-flow` · `power-user` · `admin-only` · `decorative` · `dead-code-suspect` · `a11y` · `layout-invariant`.
- `Decision` — exactly one of: `preserved` · `replaced` · `dropped` · `moved`.

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |

- `Concern` — short label, e.g. "No Cmd+F binding to focus search".
- `Detail` — one-sentence explanation of the regression risk.
- `Decision` — free-text but recommended forms: `add` · `leave` · `partial` · `defer`.

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |

- `Affordance` — link back to a literal-affordance `FR-NNN` id when applicable; otherwise free-text label.
- `What's unique` — one-sentence why this affordance differs from its siblings.
- `Decision` — exactly one of: `preserved unique` · `unified to siblings` · `dropped`.

## Caching

Reference-research artifacts go at `<project>/design-research/<reference-slug>.md`. Each starts with a YAML stub:

```yaml
---
source: linear.app
fetched_at: 2026-04-25T19:00:00Z
ttl_days: 30
---
```

Reuse if `now - fetched_at < ttl_days`. Otherwise re-fetch.

## parity-check-audit consumption

`parity-check-audit` (paired skill at `devops-claude-parity-audit-001`) maps the **Literal affordances** table directly into its Feature Registry — `FR-NNN` ids and `Source` line refs become the input rows; the `Decision` column becomes the expected post-implement state, against which parity-check-audit grades EXACT / EQUIVALENT / PARTIAL / MISSING / DIVERGED / IMPROVED.

The **Implicit affordances** and **Uniqueness flags** tables are surfaced in parity-check-audit's report as separate sections so reviewers can confirm they were addressed (the requestor's `Decision` becomes the contract; parity-check-audit confirms the implementation matches).

Do not rename the column headers, reorder the columns, or change the FR numbering format. parity-check-audit's parser is anchored to these.
