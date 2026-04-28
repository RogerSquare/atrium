# Implementation plan — GraphView polish

Plan for `ui-graph-polish-001-plan`. Pairs with `graph-polish-2026-04-28.md` (intake) and `design-research/codepen-qwqmkwg.md` (reference cache).

**Goal**: lift the CodePen QWQmKWG motion + node aesthetic onto Atrium's `GraphView.jsx`. Continuous drift, elastic drag, all 32 preserved affordances unchanged. Renderer stays `@xyflow/react`; we add `d3-force` to drive positions.

**Working assumptions** (confirmed by requestor 2026-04-28):
1. `springLength` tuned empirically during implement, starts at 200.
2. `prefers-reduced-motion` users get the current static layout (no drift).
3. Drop-on-drag releases the node back into the simulation (no shift-click-to-pin in v1).
4. Orphan-region nodes stay parked in their tile, not in the simulation.
5. Performance threshold measured during Phase 5; freeze-after-settle is fallback if <60fps at 292 nodes.

---

## Phase 1 — Add `d3-force` + build `useForceSimulation` hook

**Goal**: ship a self-contained, unit-testable hook that wraps d3-force. No GraphView changes yet.

**Files:**
- `frontend/package.json` — add `"d3-force": "^3.0.0"` (~30KB; tree-shakes if we import named exports).
- `frontend/src/components/viz/useForceSimulation.js` — new file. API:
  ```js
  // Returns a Map<nodeId, {x, y}> updated per tick.
  // Caller subscribes via onTick or pulls latest via the returned ref.
  useForceSimulation({
    nodes,             // [{ id }]
    edges,             // [{ source, target }]
    initialPositions,  // Map<id, {x, y}> — from radial/tiled layout
    excludedIds,       // Set<id> — orphans, never enter the simulation
    enabled,           // false → no ticks (reduced motion or unmount safety)
    onTick,            // (positions: Map<id, {x, y}>) => void
    config,            // optional override of force constants
  })
  ```
  - Internally uses `forceSimulation`, `forceManyBody`, `forceLink`, `forceCenter` from `d3-force`.
  - **Force constants** (port from CodePen, scaled — see Open question #1):
    - `forceManyBody().strength(-26 * SCALE_REPULSION)` — repulsion
    - `forceLink(edges).id(d => d.id).distance(200).strength(0.18)` — springs (start at 200)
    - `forceCenter(0, 0).strength(0.0025)` — gentle pull to center
    - `simulation.velocityDecay(0.4)` — keeps motion gentle
    - `simulation.alphaDecay(0)` — **continuous** drift (no auto-stop)
  - Drag pinning helpers (used by Phase 3):
    ```js
    return { positions, pin, release, restart }
    ```
    - `pin(id, {x, y})` — sets node.fx / fy
    - `release(id)` — clears fx / fy
    - `restart(alpha = 0.3)` — bumps alpha to re-energize the sim
- `frontend/src/components/viz/__tests__/useForceSimulation.test.js` — new file. Tests:
  - Deterministic seed: 3 nodes + 1 edge, fixed initial positions → after N ticks, edge endpoints converge toward `springLength`.
  - `excludedIds` honored: excluded node never moves from initial position.
  - `enabled: false` → `onTick` never fires.
  - `pin()` then `release()` → node moves freely after release.

**TDD note**: Phase 1 has testable behavior — write tests first. (Plan does not tag the implement task `tdd` because Phases 2–5 are visual; flag in the implement task that Phase 1 should follow red-green-refactor anyway.)

**Verification:**
- `npm test` passes (4 new unit tests).
- `npm run build` succeeds. Bundle size delta ≤ 35KB (d3-force tree-shaken).
- Hook works in isolation in a Storybook story (optional, defer if Storybook setup is friction).

**Rollback:** revert the commit. No GraphView changes — system unchanged.

---

## Phase 2 — Wire simulation into `GraphView`

**Goal**: replace static positioning with live simulation output. Visual: graph drifts gently; everything else unchanged.

**Files:**
- `frontend/src/components/GraphView.jsx` — edits:
  - Import `useForceSimulation` from `./viz/useForceSimulation`.
  - `model.positions` (line ~109) becomes the **initial** state. Keep the radial/tiled layout call — it still produces the seed.
  - Build `nodes`, `edges` arrays for d3 from `model.byId` and `model.depEdges` + `model.parentEdges`. Edges go in deduped (a parent edge from A→B and a dep edge B→A both create one spring).
  - Add `useForceSimulation(...)` call. Pass `excludedIds = model.orphanIdSet`. `onTick` calls `reactFlow.setNodes(prev => prev.map(n => positions.has(n.id) ? { ...n, position: { x: positions.get(n.id).x - NODE_BOX/2, y: positions.get(n.id).y - NODE_BOX/2 } } : n))`.
  - Wrap setNodes in a tick-throttle (only call every other tick) to reduce reconciler pressure — see Phase 5 if more needed.
  - Keep `baseNodes` memo as the initial-frame snapshot; live positions take over after first tick.

**Caveats:**
- **Hover dim still works** because `nodes` memo at line ~242 layers `dim`/`isHovered` on top of whatever positions exist.
- **Edges follow automatically** — `CenterEdge` (`edges.jsx:73-83`) reads `useInternalNode().internals.positionAbsolute`, which reactflow updates on `setNodes`. Worth a smoke test to confirm reactflow re-renders edge paths on internal-position change; if not, force re-render via a tick counter passed to `buildEdges`.
- **Tiled mode** keeps its layout strategy — single global simulation; long springs keep components apart naturally. If components drift into each other, add a per-component `forceCenter` instead.

**Verification:**
- `npm run build` succeeds.
- Visual smoke (manual, dev server): open Atrium → graph view → confirm nodes drift continuously, hover dim still works, click still opens task panel.
- All FR-001 through FR-030 still functional. Walkthrough:
  - FR-001 click → task opens
  - FR-002 hover → neighbors stay bright, others dim
  - FR-006 Cmd+K → search opens
  - FR-009 Work overlay → toggles per-node decorations
  - FR-015 orphans → still in their tile, NOT moving with the simulation

**Rollback:** revert the commit. Static layout returns.

---

## Phase 3 — Enable elastic drag

**Goal**: user grabs a node, drags it, and watches springs propagate to neighbors. CodePen behavior.

**Files:**
- `frontend/src/components/GraphView.jsx` — edits:
  - Flip `nodesDraggable={true}` (line ~379).
  - Add three handlers, wired to `useForceSimulation` returns:
    ```js
    const onNodeDragStart = useCallback((_, node) => sim.pin(node.id, node.position), [sim])
    const onNodeDrag = useCallback((_, node) => sim.pin(node.id, node.position), [sim])
    const onNodeDragStop = useCallback((_, node) => { sim.release(node.id); sim.restart(0.3) }, [sim])
    ```
  - Pass to `<ReactFlow>` props.

**Click-vs-drag distinction:**
- Reactflow's `onNodeClick` only fires if mouse moved <5px between mousedown and mouseup (built-in threshold). FR-001 (click-to-open) is preserved without code changes.
- Confirm during smoke test: tap a node without moving → task panel opens. Drag a node 50px → springs propagate, no panel open.

**Verification:**
- Visual smoke: drag a node 100px and release. Connected nodes should spring back toward equilibrium over ~1s.
- Click any non-dragged node → task panel still opens.
- Double-click in tiled mode (FR-003) still focuses component — confirm reactflow's drag handler doesn't intercept double-click.

**Rollback:** revert the commit. Drag goes away; sim still runs.

---

## Phase 4 — Reduced-motion + orphan exclusion polish

**Goal**: vestibular safety + confirm orphans behave correctly.

**Files:**
- `frontend/src/components/viz/useForceSimulation.js` — edits:
  - At hook entry, read `const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches`.
  - If `reducedMotion`: set `alphaDecay` to 0.0228 (d3-force default — settles in ~300 ticks) and stop ticking after settle. Pin all node fx/fy to their settled positions.
  - Listen for changes to the media query; if user toggles reduced-motion mid-session, restart appropriately.
- `frontend/src/components/GraphView.jsx` — confirm `excludedIds = model.orphanIdSet` is passed (already in Phase 2 plan; verify here).

**Verification:**
- DevTools → Rendering → emulate `prefers-reduced-motion: reduce`. Reload graph. Nodes should settle once and stop. Drag still works (drags re-energize per Phase 3 `restart`).
- Inspect orphan region — every node in `orphanIdSet` stays at its packed position regardless of simulation activity.

**Rollback:** revert this commit. Continuous drift returns for everyone (still respects orphan exclusion if Phase 2 wired it correctly).

---

## Phase 5 — Performance pass + spring tuning

**Goal**: confirm 60fps at Atrium scale (292 nodes today), tune springLength to taste.

**Steps:**
1. **Measure baseline** on a 292-node snapshot (use the Atrium project itself):
   - Chrome DevTools → Performance tab → record 10 seconds of idle drift.
   - Look for: scripting time, frame drops, GC pressure.
2. **If <60fps**, apply mitigations in order:
   - **Throttle `setNodes` to every 2nd or 3rd tick** (Phase 2 already includes a stub for this).
   - **Switch to direct rfStore.setState** instead of `reactFlow.setNodes` to bypass React reconciliation per tick. Costs: leaks reactflow internals into our hook; revisit only if throttle isn't enough.
   - **Freeze after settle**: set `alphaDecay` to 0.0228 (default), let sim stop after ~300 ticks. Re-warm on `onNodeMouseEnter` / `onNodeDragStart` via `sim.restart(0.1)`.
3. **Tune springLength** by feel. Start 200 (per Open Question #1 default). Acceptance criteria: subjectively, the graph feels as airy as the CodePen reference at comparable density. Document the final value in a comment on the `useForceSimulation` config.
4. **Profile result**: attach a screenshot of the DevTools timeline (60fps frames green) to the task's `### Comments`.

**Files:**
- `frontend/src/components/viz/useForceSimulation.js` — apply tuning + (if needed) freeze-after-settle logic.
- `frontend/src/components/GraphView.jsx` — wire `sim.restart(0.1)` into `onNodeMouseEnter` and `onNodeDragStart` if freeze-after-settle is on.

**Verification:**
- Performance recording on 292-node Atrium snapshot: ≥55fps sustained idle (some headroom for system noise).
- Visual: drag a node 200px and release; springs converge over ≤1.5s.
- All FR-001 through FR-030 still functional.

**Rollback:** revert this commit. Falls back to Phase 4 behavior (continuous drift, no freeze, springLength 200). Acceptable to ship that as v1 if Phase 5 tuning runs long.

---

## Out of scope

- **vis-network swap** — researched, rejected. Loses every reactflow integration.
- **Per-element framer-motion transitions** — `framer-motion` is installed but not needed; d3-force handles the motion brief on its own.
- **Shift-click-to-pin** — defer to a follow-up task once v1 ships and we have feel for it.
- **Multi-component separate simulations** in tiled mode — defer; long springs should keep components separated naturally. Revisit if Phase 5 reveals component drift.
- **New keyboard shortcuts** — none added; the brief is "look + feel of the CodePen."
- **Animated entrance** (nodes flying in from off-canvas) — CodePen doesn't have this; out of scope.

## Affected files (summary)

| Path | Change |
| --- | --- |
| `frontend/package.json` | + `d3-force` dep (Phase 1) |
| `frontend/src/components/viz/useForceSimulation.js` | NEW (Phase 1, edited Phase 4 + 5) |
| `frontend/src/components/viz/__tests__/useForceSimulation.test.js` | NEW (Phase 1) |
| `frontend/src/components/GraphView.jsx` | EDIT (Phases 2, 3, 5) |

No other source files touched. `radial.js`, `tiled.js`, `TaskNode.jsx`, `edges.jsx`, `GraphView.css`, `GraphSearch.jsx`, `WorkOverlayToggle.jsx`, `OrphanRegion.jsx`, `OverviewBackButton.jsx` all preserved as-is.

## Acceptance for the implement task

- [ ] All 5 phases shipped as separate commits on `feat/ui-graph-polish-001-impl`.
- [ ] `npm test` passes (existing + 4 new hook tests).
- [ ] `npm run build` passes; bundle size delta ≤ 35KB.
- [ ] Visual smoke walkthrough confirms FR-001 through FR-030 (intake checklist).
- [ ] Performance: ≥55fps sustained idle on 292-node Atrium snapshot (DevTools recording attached).
- [ ] `prefers-reduced-motion` smoke test: nodes settle once and stop.
- [ ] PR opened against `main` linking back to `ui-graph-polish-001-impl`.
- [ ] After merge: schedule a 1-week soak observation; if smooth, queue a follow-up task for shift-click-to-pin.
