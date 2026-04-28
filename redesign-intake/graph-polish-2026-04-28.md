# Redesign intake — GraphView polish

Pre-plan briefing for `ui-graph-polish-001`. Lifts the **motion + node aesthetic** of CodePen QWQmKWG (vis-network force-directed graph) onto the existing `GraphView.jsx`. All surrounding chrome (toolbar, search, work overlay, controls, legend) and all task-semantic affordances (dependency edges colored by category, parent edges dashed and muted, status overlay, orphan region) are **preserved unchanged**.

## Design Direction

### References

| Source | URL | Why this one |
| --- | --- | --- |
| CodePen — KG example (satyasingh) | https://codepen.io/satyasingh/pen/QWQmKWG | The motion anchor. Force-directed (`forceAtlas2Based`), continuous drift, elastic drag-propagation. Provides node aesthetic (dot, white-haloed verdana label) and the physics constants we'll port. Cached at `design-research/codepen-qwqmkwg.md`. |

Single reference by design — requestor confirmed CodePen-only. Palette / density / surrounding chrome lift from Atrium's existing tokens (`design-research/linear.md`).

### Distilled palette

- **Canvas background**: keep Atrium's `--bg-card` `[token: atrium/design-system]` — do NOT switch to vis-network's white. Surrounding chrome already assumes the dark/themed canvas.
- **Node fill**: keep Atrium's `categoryColor(task.id)` `[token: atrium/categoryColors]` — mapping `feat`/`bug`/`ui`/`opt`/`devops`/`comp`/`mobile` to existing hexes is a load-bearing affordance. Vis-network's auto-by-group palette is dropped — categories are our groups.
- **Node shape**: `dot` (circle) `[token: codepen/QWQmKWG]`. Currently a `<circle>` inside an SVG wrapper — already aligned visually; the renderer change is the load-bearing part, not the shape.
- **Node size**: `size: 12` base `[token: codepen/QWQmKWG]`, but **keep Atrium's log-scaled `nodeRadiusFor(childCount, max)`** `[token: atrium/GraphView.jsx:64-70]` — hub-vs-leaf differentiation is a load-bearing affordance.
- **Node label**: keep current `task.id` below the node, `--font-sans` 10px `[token: atrium/design-system]`. Do NOT switch to vis-network's 24-36px verdana with white halo — that scale fights the surrounding UI.
- **Edge — depends_on**: keep `categoryColor(target)`, `1.5px`, opacity 0.7 `[token: atrium/edges.jsx:50-54]`. Solid line, straight (already matches CodePen's straight-line treatment).
- **Edge — parent_task**: keep dashed `3 3`, `--text-tertiary`, opacity 0.4 `[token: atrium/edges.jsx:35-38]`. Dashed-vs-solid is the dependency-vs-parent distinction — preserved.
- **Motion** (the actual lift): port forceAtlas2Based with the pen's exact constants `[token: codepen/QWQmKWG]`:
  - `gravitationalConstant: -26`
  - `centralGravity: 0.0025`
  - `springLength: 400` (may need scaling to Atrium's coordinate space — see open question)
  - `springConstant: 0.18`
  - `maxVelocity: 146`
  - `timestep: 0.35`
  - `stabilization: { iterations: 150 }`
- **Idle behavior**: continuous low-energy drift `[token: codepen/QWQmKWG]`. Implement via `d3-force` running `tick()` on `requestAnimationFrame` without auto-stopping (or vis-network's default behavior if we swap renderers).
- **Drag behavior**: elastic spring propagation `[token: codepen/QWQmKWG]`. Currently `nodesDraggable={false}` in `GraphView.jsx:379` — flip to true and hand drag to the simulation.
- **Smaller identity** (preserved from Atrium): hover dim via `dim/isHovered` props `[token: atrium/TaskNode.jsx:19,28-29]`, root highlight via `--text-app` stroke `[token: atrium/TaskNode.jsx:28]`, status ring overlay when work-overlay is on `[token: atrium/TaskNode.jsx:82-92]`, PR dot in upper-right `[token: atrium/TaskNode.jsx:103-114]`, orphan dashed stroke `[token: atrium/TaskNode.jsx:30-31]`.

## Preservation Contract

### Literal affordances

| FR | Affordance | Source | Category | Decision |
| --- | --- | --- | --- | --- |
| FR-001 | Click node → fires `onSelectTask(task)` opens task panel | `GraphView.jsx:265-271` | core-flow | preserved |
| FR-002 | Hover node → dims non-neighbors, full opacity on node + neighbors | `GraphView.jsx:242-256, 263-264` | core-flow | preserved |
| FR-003 | Double-click node (tiled mode only) → focuses the component | `GraphView.jsx:272-279` | power-user | preserved |
| FR-004 | Esc → clears focused component | `GraphView.jsx:304-312` | power-user | preserved |
| FR-005 | `OverviewBackButton` appears while a component is focused | `GraphView.jsx:391-393` | power-user | preserved |
| FR-006 | Cmd+K / Ctrl+K → opens `GraphSearch` modal | `GraphView.jsx:315-324` | power-user | preserved |
| FR-007 | Search modal: type to fuzzy-rank by id/title/tag, ↑↓ to navigate, Enter to select, Esc to close | `GraphSearch.jsx:30-76` | power-user | preserved |
| FR-008 | Selecting search result → `fitView` to that node (or switches focused component in tiled mode) | `GraphView.jsx:326-349` | power-user | preserved |
| FR-009 | `WorkOverlayToggle` (top-right) → flips per-node decorations: status ring, PR dot, recency fade | `GraphView.jsx:394-397`, `WorkOverlayToggle.jsx:10-41` | power-user | preserved |
| FR-010 | Status ring (outer concentric circle, status-tinted) when overlay enabled | `TaskNode.jsx:82-92` | power-user | preserved |
| FR-011 | PR dot (upper-right corner, color-coded by PR state) when overlay enabled | `TaskNode.jsx:103-114` | power-user | preserved |
| FR-012 | Stale-task fade (>30 days untouched) when overlay enabled | `TaskNode.jsx:39, GraphView.jsx:45-46, 233-235` | power-user | preserved |
| FR-013 | Radial layout for ≤150 nodes | `GraphView.jsx:51, 105-107`, `radial.js` | layout-invariant | replaced (becomes initial positions for force simulation; layout math survives) |
| FR-014 | Tiled layout for >150 nodes with multiple components | `GraphView.jsx:102-107`, `tiled.js` | layout-invariant | replaced (same — initial positions only) |
| FR-015 | Orphan region (right of main layout) for isolated tasks | `GraphView.jsx:131-146, 175-188`, `OrphanRegion.jsx` | layout-invariant | preserved (orphans stay parked in their tile, NOT pulled into the simulation) |
| FR-016 | Orphan node visual: dashed stroke, capped at radius 7, opacity 0.85 | `TaskNode.jsx:25, 30-31, 101` | decorative | preserved |
| FR-017 | Node radius scales log of out-degree (range 7–22) | `GraphView.jsx:64-70, 195` | decorative | preserved |
| FR-018 | Root node visually emphasized (thicker stroke, label bold) | `TaskNode.jsx:28-29`, `GraphView.jsx:206` | decorative | preserved |
| FR-019 | Node fill via `categoryColor(task.id)` (feat/bug/ui/opt/devops/comp/mobile) | `TaskNode.jsx:20`, `categoryColors.js` | decorative | preserved |
| FR-020 | Depends_on edges: solid line, `categoryColor(target)`, opacity 0.7, drawn over parent edges | `edges.jsx:43-60` | decorative | preserved |
| FR-021 | Parent_task edges: dashed `3 3`, `--text-tertiary`, opacity 0.4, drawn under depends_on | `edges.jsx:26-41` | decorative | preserved |
| FR-022 | Hover dims non-incident edges (opacity 0.08 / 0.10) | `edges.jsx:21-22, 37, 53` | decorative | preserved |
| FR-023 | Reactflow `<Controls />` (zoom in/out/fit) | `GraphView.jsx:383` | power-user | preserved (or equivalent if renderer swaps — see Open questions) |
| FR-024 | Reactflow `<MiniMap />` (pannable, zoomable, category-colored) | `GraphView.jsx:384-389` | power-user | preserved (or equivalent if renderer swaps) |
| FR-025 | Pan-on-drag, zoom-on-scroll, min/max zoom bounds | `GraphView.jsx:375-378` | core-flow | preserved (or equivalent) |
| FR-026 | Category-color legend at bottom-left | `GraphView.jsx:428-449` | layout-invariant | preserved |
| FR-027 | "No tasks to graph" empty state | `GraphView.jsx:351-360` | a11y | preserved |
| FR-028 | Reactflow node selection ring suppressed (Atrium uses stroke change instead) | `GraphView.css:11-17` | decorative | preserved (port to new renderer if swap) |
| FR-029 | Title attribute on each node (`task.title`) for native browser tooltip | `TaskNode.jsx:49` | a11y | preserved |
| FR-030 | `aria-pressed` on work overlay toggle | `WorkOverlayToggle.jsx:15` | a11y | preserved |
| FR-031 | `nodesDraggable={false}` — nodes are not currently draggable | `GraphView.jsx:379` | layout-invariant | replaced (becomes draggable so the user can grab a node and watch springs propagate — this IS the CodePen feel) |
| FR-032 | Static layout (nodes never move post-initial-render) | `GraphView.jsx:73-165` | layout-invariant | replaced (force simulation runs continuously, low-energy drift) |

### Implicit affordances flagged

| Concern | Detail | Decision |
| --- | --- | --- |
| Motion sickness / vestibular accessibility | Continuous drift will trigger `prefers-reduced-motion` users. CodePen has no such guard. | add — gate continuous simulation on `!prefers-reduced-motion`; reduced-motion users get the current static layout |
| Drag conflict with click-to-open | Once `nodesDraggable={true}`, distinguishing a click (FR-001) from a drag-start matters. Reactflow + d3-drag both handle this via threshold + drag-distance, but worth confirming. | add — verify click still fires on `mouseup` without movement; if not, add a 5px drag threshold |
| Pinned nodes during interaction | When user grabs a node and lets go, should it (a) snap back into the simulation, (b) stay pinned where dropped, (c) stay pinned briefly then release? CodePen behavior: snaps back into simulation. | add — match CodePen: drop = release back to simulation. Optionally support shift-click to pin (defer to plan phase) |
| Performance at 292 nodes (Atrium today) | CodePen has ~70 nodes. forceAtlas2Based at 4× node count + 80 nodes' worth of d3-force ticks per frame may drop fps. | add — measure during plan phase; if fps drops, freeze simulation after settle and only re-warm on user interaction |
| Hover dim coupling with motion | FR-002 dims via `opacity` updates per-node. If the node is also moving (drift), the visual transition may flicker. | leave — opacity changes are instant, motion is per-frame; no expected interaction. Re-flag if observed |
| Edge endpoints during drift | `CenterEdge` (`edges.jsx:68-97`) computes endpoints from `useInternalNode().internals.positionAbsolute`. If positions update every tick, edges should follow automatically — but worth confirming reactflow re-renders edges on internal-position change. | add — verify; if reactflow caches edge paths, force re-compute on tick |

### Uniqueness flags

| Affordance | What's unique | Decision |
| --- | --- | --- |
| FR-009 / WorkOverlayToggle | Only floating toolbar pill on the canvas; uses `apple-press` class + `--accent-app` active state. No siblings — solitary by design. | preserved unique |
| FR-021 / parent_task edge styling | Dashed `3 3` muted is the only dashed line in the canvas; depends_on uses solid color. The dash IS the dep-vs-parent distinction the user explicitly asked to preserve. | preserved unique |
| FR-016 / orphan node styling | Only nodes with dashed stroke + capped radius. Visually flags "no relationships" without hiding them. | preserved unique |
| FR-018 / root node styling | Only node with `--text-app` stroke + bolder label. Visually flags "this is the canvas anchor." | preserved unique |
| FR-026 / legend | Only static UI element on the canvas (other than toolbar pills) — non-interactive (`pointerEvents: 'none'`). No siblings. | preserved unique |

## Renderer recommendation (informational — plan phase decides)

Three weighed options. The intake documents tradeoffs; the **plan phase picks**.

1. **Stay on `@xyflow/react` + add `d3-force`** as a custom hook (`useForceSimulation`).
   - **Pros**: Existing layouts (`radial.js`, `tiled.js`) become initial positions; all chrome (Controls, MiniMap, search, focus, work overlay) keeps working as-is; FR-023 / FR-024 / FR-025 free; smallest diff. `framer-motion` already installed for any per-element transitions.
   - **Cons**: Reactflow not designed for per-tick position updates at scale — ~292 nodes ticking at 60fps may stress reconciler. Mitigation: update positions via `setNodes` with a throttled tick or use `useStore.setState` directly.
   - **New dep**: `d3-force` (~30KB).
2. **Swap to vis-network wholesale.**
   - **Pros**: Free physics that exactly match the CodePen by definition; built-in click/hover/drag.
   - **Cons**: Loses every reactflow integration — Controls / MiniMap / focus state / search highlight need re-wiring against vis-network's API; node rendering goes through vis-network's canvas (not React), so `TaskNode.jsx` (overlay rings, PR dots) becomes dead and must be reimplemented as canvas drawing. Largest diff. Highest risk of regressing FR-009 through FR-012.
   - **New dep**: `vis-network` (~150KB).
3. **Hybrid: reactflow shell + d3-force settling, then freeze.**
   - **Pros**: Same chrome as option 1; performance trivial because simulation only runs while user interacts; lowest fps risk.
   - **Cons**: Loses the **continuous drift** that defines the CodePen feel. Per requestor's stated goal ("look and feel of the codepen example") this misses the brief.
   - **New dep**: `d3-force` (~30KB).

**Researcher's lean**: option 1. Preserves all FR-001 through FR-030 trivially (chrome stays); meets the motion brief (continuous drift); single dependency add; the 292-node performance question is the only real risk and is mitigatable. Confirm during plan phase with a perf spike on a 292-node Atrium snapshot.

## Open questions (plan phase must answer before code)

1. **Coordinate-space scaling**: CodePen's `springLength: 400` is in vis-network's pixel space at 1000×1000. Atrium's radial layout produces coordinates in a much larger space (positions can range thousands of pixels). Should we (a) keep `400` literally and let nodes pile up, (b) scale by ratio of layout-bbox to canvas, or (c) tune empirically? **Recommend (c) — start at 200, dial in by feel during implement.**
2. **Reduced motion**: confirm we want the current static layout as the reduced-motion fallback (keeps everything visually the same minus drift).
3. **Pinning on drop**: confirm CodePen behavior (release back to simulation) vs add Atrium-only feature (shift-click to pin).
4. **Orphan region behavior**: confirm orphans stay in their fixed tile and are NOT pulled into the simulation (they have no edges → simulation would just push them apart pointlessly).
5. **Performance threshold**: at what node count do we freeze the simulation after settle and only re-warm on interaction? Suggest measure first, threshold after — likely 200+ nodes.
