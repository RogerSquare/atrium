# redesign-intake — smoke-test transcript

Captures the four acceptance-criteria smoke tests run during initial skill development. Treat as historical evidence that the skill's design works end-to-end. Re-run if the skill is materially changed.

Tests run **2026-04-25** against repo state at `feat/redesign-intake-skill-001` branch.

---

## Test 1 — Phase A on Atrium's project switcher (no requestor references)

**Target**: redesign Atrium's `Cmd+P` project switcher (`frontend/src/components/shell/ProjectAnchor.jsx`). Requestor provided no inspiration references.

**Expected pass criteria**:
- Skill suggests 3–5 sensible references unprompted
- Researches each reference end-to-end
- Output has ≥5 entries in "smaller identity" of the distilled palette
- Every value carries `[token]` or `[best-guess]` provenance flag

**Result**: PASS. Subagent suggested 4 references appropriate to the command-palette / quick-switcher archetype:

| # | Source | Defense |
|---|---|---|
| 1 | Linear command menu | Dense quick-switcher; calm dark surface; matches Atrium's task/project model |
| 2 | VS Code Quick Open / Command Palette | Canonical Cmd+P pattern Atrium's binding mimics |
| 3 | Raycast root command list | Best-in-class typography density for search-then-pick lists |
| 4 | Slack Quick Switcher | Closest archetype to Atrium's projects-with-counts pattern |

Distilled palette returned 8 "smaller identity" entries (radii / shadow / icons / hover / focus ring / empty state / keyboard hints / active row treatment).

Provenance flagging worked correctly:
- ~40% of values came from first-party token references (`[token: linear.app/brand]`, `[token: VS Code theme-color]`, `[token: Raycast colors API]`).
- ~60% were `[best-guess]` — extracted from screenshots or third-party articles.
- The distilled palette inherited the most-cautious flag for borrowed values (e.g., `surface-popover #1C1D1F [best-guess]` despite borrowing from Linear because Linear's surface hex is screenshot-derived).

**Verdict**: Phase A's "elicit → research → flag → distill" loop produced an actionable design direction without requestor prompting. Provenance discipline is intact.

---

## Test 2 — Phase B literal on App.jsx → AppShell.jsx (BulkActionBar regression)

**Target**: literal-affordance survey on `frontend/src/App.jsx` (legacy), graded against `frontend/src/components/shell/AppShell.jsx` (new shell, pre-`feat/shell-restore-001`).

**Expected pass criteria**: the literal pass surfaces `<BulkActionBar>` mount as an FR row with sufficient detail for an audit step to grade it MISSING in pre-#58 AppShell.

**Method**:

1. Survey `App.jsx`:
   ```
   App.jsx:23 — import BulkActionBar from './components/BulkActionBar'
   App.jsx:329 — <BulkActionBar selectedIds={selectedTaskIds} totalVisible={...}
                    onSelectAll={selectAllVisible} onDeselectAll={deselectAll}
                    onExit={exitBulkMode} onBatchUpdate={handleBatchUpdate}
                    onBatchDelete={handleBatchDelete} ... />
   ```

   Surveyed entry the skill would write to the Literal-affordances table:

   | FR | Affordance | Source | Category | Decision |
   |---|---|---|---|---|
   | FR-NNN | BulkActionBar mount, conditional on `bulkSelectMode && selectedTaskIds.length > 0`. Wires 6 callback props (selectAll / deselectAll / exit / batchUpdate / batchDelete / ...). | App.jsx:329 | power-user | _<requestor decides>_ |

2. Audit step (paired skill `parity-check-audit` would do this) against pre-#58 AppShell.jsx: `BulkActionBar` does not appear anywhere — would grade MISSING.

3. **Result post-#58**: AppShell.jsx now imports `BulkActionBar` at L31 and mounts at L275. The regression is closed. But the skill's literal pass run pre-#58 would have surfaced the gap before merge, forcing an explicit `preserved` / `dropped` / `moved` decision rather than a silent disappearance.

**Verdict**: PASS. The literal-affordance survey produces a row whose `Source` column points the auditor at the line that would need to exist in the new file. A vanilla refactor without this skill loses the row entirely; the skill makes the loss visible by producing a contract row that's empty in the new version.

---

## Test 3 — Phase B implicit pass on FilterBar.jsx

Run earlier in the design cycle (transcript on `devops-claude-redesign-intake-001` task comments). Captured here for completeness.

**Target**: `frontend/src/components/shell/FilterBar.jsx`.

**Expected pass criteria**: implicit pass surfaces three regression-risk items the literal grep can't catch:
- Missing keyboard binding (no Cmd+F to focus search)
- Mixed control vocabulary (native `<select>` next to `<Button>` toggles)
- Missing zero-match empty state

**Result**: PASS. All three items surfaced when the literal-affordance pass alone would have produced 12 FR rows of present-only content.

| Concern | Detail | Why literal pass missed it |
|---|---|---|
| No Cmd+F binding to focus search | Distinct from ChangesView's pattern; users would expect parity | Implicit (an absence, not a line of code) |
| Mixed control vocabulary | Native `<select>` for type/priority next to `<Button>` for toggles next to chip pattern proposed by redesign | Vocabulary inconsistency requires sibling-comparison, not single-line read |
| No empty state for zero matches | Shows "0 of N" with no affordance to relax filters | Empty state's absence isn't a line; it's the lack of one |

**Verdict**: PASS. Implicit pass is the dimension the literal survey alone provably misses.

---

## Test 4 — Phase B uniqueness scan on FilterBar.jsx

Same FilterBar run as Test 3.

**Expected pass criteria**: uniqueness scan flags the orange-tinted "Stale" toggle as visually unlike the accent-tinted "Today" / "Mine" siblings.

**Result**: PASS. Surveyed:

```
FilterBar.jsx:130 — Mine toggle, variant=secondary when active (uses --accent-app)
FilterBar.jsx:142 — Today toggle, variant=secondary when active (uses --accent-app)
FilterBar.jsx:154 — Stale toggle, variant=secondary when active, BUT lines 160-163
                    inject style overrides:
                      color: 'var(--apple-orange)'
                      background: 'color-mix(...accent-app...)' (overridden to orange)
```

Sibling-comparison of toggle active-state colors yields:
- Mine: `--accent-app`
- Today: `--accent-app`
- Stale: `--apple-orange` (UNIQUE)

Skill output row:

| Affordance | What's unique | Decision |
|---|---|---|
| FR-008 (Stale toggle) | Active-state color is `--apple-orange` while every other toggle on the same bar uses `--accent-app`. | _<requestor decides: preserved unique / unified to siblings / dropped>_ |

A vanilla refactor would have silently regularized this to accent. The uniqueness scan forces an explicit decision.

**Verdict**: PASS. The scan caught the kind of detail (intentional or accidental?) that vanilla refactors silently smooth away.

---

## Composite verdict

All four acceptance-criteria smoke tests pass. The skill's design correctly handles:

- **Phase A**: external research with provenance discipline, even when the requestor offers no references.
- **Phase B literal**: enumeration of present affordances at a line-level granularity sufficient for downstream parity-check-audit grading.
- **Phase B implicit**: surfacing of absences (keybinds, mixed vocabulary, missing states, unlabeled a11y) that no literal grep can reach.
- **Phase B uniqueness**: sibling-comparison flagging of visually-divergent affordances that vanilla refactors silently regularize.

Future calibrations should append to this file rather than rewriting — the historical baselines are useful when the skill itself is iterated.
