# Redesign intake — Project hub (feat-project-hub-001)

Requestor brief, verbatim: "make both the loops and demos view a single view
and have a file explorer for all projects and it gets filtered if a
particular project gets selected."

Two tracks: (A) merge the Loops and Demos top-bar views into one; (B) a NEW
read-only file explorer for project folders. Everything scopes to
`activeProject` like Board/List already do.

## Design Direction

### References

| Source | URL | Why this one |
| --- | --- | --- |
| Linear (view IA) | https://linear.app/now/how-we-redesigned-the-linear-ui | "Increase hierarchy and density of navigation" — fewer top-level views, richer views. Cache: `design-research/linear.md` (fresh). |
| VS Code explorer (pattern, not fetched) | — | The canonical lazy folder tree: per-directory loading, chevron disclosure, dotfile dimming. All values `[best-guess]` from common knowledge — no style tokens needed since Atrium's own tokens govern. |
| Atrium internal precedents | frontend/src/components/ListView.jsx · TestsTab.jsx | The just-shipped thread tree (collapse rows, lazy structure) and the Tests tab's artifact file list are the in-house vocabulary the explorer should extend. |

### Distilled palette

Structural only — colors/type are Atrium tokens:

- **One view, three sub-surfaces**: segmented sub-tabs inside the merged view (Loops · Demos · Files), mirroring the DetailPane's tab pattern `[best-guess]`
- **Explorer anatomy**: lazy directory tree, one fetch per expanded folder, never recursive `[best-guess: VS Code]`; monospace names, dimmed dotfiles, size + mtime muted on the right
- **Empty-state doctrine**: every sub-surface keeps its current contextual empty state (Loops and Demos both have good ones — preserved)

## Preservation Contract

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |
| FR-065 | Loop rows: name, scope badge (project / repo / global), status dot (idle/running/error), watch badges, ran/next relative times | frontend/src/components/LoopsView.jsx:34 | core-flow | preserved |
| FR-066 | Row click opens the LoopDetailModal cockpit | frontend/src/components/LoopsView.jsx:36 | core-flow | preserved |
| FR-067 | Per-row enable/disable checkbox | frontend/src/components/LoopsView.jsx:55 | core-flow | preserved |
| FR-068 | Run-now button with busy state | frontend/src/components/LoopsView.jsx:58 | core-flow | preserved |
| FR-069 | Edit button → LoopModal | frontend/src/components/LoopsView.jsx:61 | core-flow | preserved |
| FR-070 | Delete with confirm dialog | frontend/src/components/LoopsView.jsx:64 | core-flow | preserved |
| FR-071 | activeProject scoping: filters project-scope loops, contextual header + empty state | frontend/src/components/LoopsView.jsx:82 | core-flow | preserved |
| FR-072 | "New loop" button, project-prefilled when scoped (data-testid new-loop-button) | frontend/src/components/LoopsView.jsx:110 | core-flow | preserved |
| FR-073 | Loops loading / error states | frontend/src/components/LoopsView.jsx:120 | layout-invariant | preserved |
| FR-074 | LoopDetailModal cockpit: runs, summarize, instructions, templates, terminal runs, activity — socket-live | frontend/src/components/LoopDetailModal.jsx:1 | core-flow | preserved |
| FR-075 | LoopModal create/edit form with project picker | frontend/src/components/LoopModal.jsx:1 | core-flow | preserved |
| FR-076 | useLoops socket-live status updates | frontend/src/hooks/useLoops.js:1 | layout-invariant | preserved |
| FR-077 | Demos: service groups with demos nested (ServiceGroup) | frontend/src/components/DemosView.jsx:174 | core-flow | preserved |
| FR-078 | Demos activeProject filter incl. the Unassigned-bucket rule | frontend/src/components/DemosView.jsx:59 | core-flow | preserved |
| FR-079 | Demos count chip + "filtered to X" note (glossary-compliant "No project") | frontend/src/components/DemosView.jsx:92 | decorative | preserved |
| FR-080 | "Demos only / All services" toggle (data-testid demos-show-all-services-toggle) | frontend/src/components/DemosView.jsx:109 | power-user | preserved |
| FR-081 | Service start/stop from a group, 400ms settle + reload, inline error pill | frontend/src/components/DemosView.jsx:43 | core-flow | preserved |
| FR-082 | Demo cards: open link, task chip → onSelectTask (demo-card / demo-open-link / demo-task-chip testids) | frontend/src/components/ServiceGroup.jsx:1 | core-flow | preserved |
| FR-083 | Demos loading / error+retry / empty state with the add-a-demo how-to | frontend/src/components/DemosView.jsx:130 | layout-invariant | preserved |
| FR-084 | Empty service groups default-collapsed | frontend/src/components/DemosView.jsx:185 | decorative | preserved |

Consolidation verdict: **every affordance survives — the merge relocates, it
does not remove.** The only replaced element is the pair of stand-alone view
headers (each view's H1 becomes a sub-tab label; the count chip and scope
note move to the shared hub header).

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |
| Stored-view migration | `taskBoardView` may hold 'loops' or 'demos' (AppShell.jsx:122) — after the merge these ids must map to the hub (+ the right sub-tab) or users land on a dead view. | add |
| ViewSwitcher shrink | ViewSwitcher.jsx:4-10 goes 6 → 5 entries; e2e specs and the MobileTabBar cycle (board/list/changes only — loops/demos never were in it) must stay consistent. | add |
| Native confirm/alert in Loops | LoopsView uses window.confirm/alert (LoopsView.jsx:89-94) — a vocabulary mismatch with the app's modals; NOT in scope to fix, but the merge must not double-wrap them. | leave |
| Explorer perf trap | Today's cleanup found 12GB target/ and 6GB node_modules dirs INSIDE project folders — the explorer must list one directory per request, never recurse, and ignore heavy dirs by default. | add |
| Jail integrity | Path traversal AND symlink escape from workingDirectory; response must not leak absolute host paths beyond the jail root. requireAuth (source code is sensitive — stricter than the preview proxy's optionalAuth). | add |
| Unmapped projects | Only 8/14 registry projects match a folder by case-insensitive name (10/14 with space/hyphen normalization: 'Atrium 2'→atrium2, 'GitHub Collab Manager'→gh-collab-manager). Loops/Notion-Copy/RemotePilot/Spoony resolve to nothing — the explorer needs an honest "no folder linked" state, not a silent blank. | add |

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |
| FR-074 | The loop cockpit is the app's richest modal (6 data surfaces); it mounts FROM the view but is self-contained — the merge must only re-point its mount. | preserved unique |
| FR-080 | "Demos only / All services" is the app's only eye-icon visibility toggle. | preserved unique |
| FR-081 | Demos is the only place services start/stop OUTSIDE Settings. | preserved unique |

## Research findings beyond the contract

1. **The merge is cheap; the explorer is the real feature.** LoopsView (175
   lines) and DemosView (192) are both thin, self-contained, and already
   activeProject-aware with compatible scoping semantics. Wrapping them in
   sub-tabs is low-risk; their modals/hooks/testids are untouched.
2. **Seams**: ViewSwitcher.jsx:4-10 (VIEWS array), AppShell.jsx:122
   (activeView + `taskBoardView` persistence), FocalZone.jsx:83-140 (view
   branches; LoopsView gets projects/activeProject/socketRef, DemosView gets
   tasks/onSelectTask), MobileTabBar.jsx:14 (cycle excludes both — mobile
   unchanged by the merge).
3. **Project → directory is the open data question.** There is NO existing
   link from projects.json to a source folder. Measured against the real
   registry: 8/14 exact-insensitive, 10/14 with slug normalization. The
   durable fix is an optional `directory` field per project (registry
   already carries per-project metadata), with the normalized-name heuristic
   as fallback and an explicit unlinked state.
4. **Backend precedents to reuse**: `lib/sanitize.safePath` (jail),
   `routes/e2eRuns.js` GET :task/:run/files (directory listing shape),
   `lib/dataDir.js` (workingDirectory resolution; container = /workspace).
   The explorer should be `requireAuth` — source files are more sensitive
   than previews.
5. **e2e inventory**: loops.spec.js (render + project-scoped + token-gated
   backend flow; testids loop-row/loop-open/loop-modal/loop-detail/
   new-loop-button/loops-view) and demos.spec.js (demos-view, service-group,
   demo-card/open-link/task-chip, show-all-services toggle). All keep
   passing if testids survive the merge; each spec's `goto` seeds
   `taskBoardView` — update to the hub id + sub-tab.

## Open questions for the requestor (starred = recommended default)

- **Q1 — What is the merged view called?** ★ **"Hub"** (short, unclaimed by
  the glossary). Alternatives: "Studio", "Workspace" (collides with the
  workingDirectory concept), "Projects" (collides with the project anchor).
- **Q2 — IA inside the view?** ★ Segmented sub-tabs — **Loops · Demos ·
  Files** — with the last-used sub-tab remembered; stored 'loops'/'demos'
  view ids migrate to Hub + that sub-tab. Alternative: stacked sections on
  one long page.
- **Q3 — Explorer v1 scope?** ★ Read-only: lazy directory tree + text-file
  preview (≤256 KB) + copy-path; `.git`, `node_modules`, `target`, `dist`
  ignored by default behind a "show ignored" toggle; requireAuth; no
  write/rename/delete/download in v1.
- **Q4 — Project→folder mapping?** ★ Optional `directory` field on
  projects.json entries + normalized-name heuristic fallback (covers 10/14
  today); unmapped projects render a "no folder linked" hint pointing at the
  future Settings field. Alternative: heuristic-only.
