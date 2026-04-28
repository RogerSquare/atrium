---
source: codepen.io/satyasingh/pen/QWQmKWG
fetched_at: 2026-04-28T17:22:00Z
ttl_days: 30
---

# CodePen QWQmKWG — vis-network knowledge graph

Pen titled "KG example" by satyasingh. Force-directed knowledge graph rendered with vis-network. Notable for its airy, continuously-drifting feel — that motion is what we want to lift.

## Fetch quirk

`codepen.io/satyasingh/pen/QWQmKWG` returns 403 to scrapers (referer-checked). Use `https://cdpn.io/satyasingh/fullpage/QWQmKWG` instead — the fullpage subdomain serves the rendered iframe HTML inside an HTML-entity-encoded `srcdoc=""` attribute. Decode `&quot;` → `"` etc. to recover the source.

## Stack

- **Library**: vis-network (vis.js standalone UMD build) — `https://visjs.github.io/vis-network/standalone/umd/vis-network.min.js`
- **Container**: `<div id="mynetwork">` sized 1000×1000

## Nodes

- ~70 nodes
- `shape: 'dot'`, `size: 12`
- 5 logical `group` values — vis-network auto-colors by group from its default palette (orange, blue, red, cyan, green, purple, yellow ish)
- Labels: `font: '24px verdana black'` for leaf nodes, `'36px verdana black'` for the central "Project" node — `strokeColor: '#ffffff'`, `strokeWidth: 3` (white halo so labels read on any background)

## Edges

- `[{ from: <id>, to: <id> }]` — undirected default; vis-network draws straight lines between node centers, thin gray stroke
- ~80 edges
- No styling overrides — pure default

## Physics (the core of the "polish")

```js
physics: {
  forceAtlas2Based: {
    gravitationalConstant: -26,   // node-node repulsion
    centralGravity: 0.0025,       // gentle pull to center (very low → sprawling layouts ok)
    springLength: 400,            // long springs → airy spacing
    springConstant: 0.18,
  },
  maxVelocity: 146,
  solver: 'forceAtlas2Based',
  timestep: 0.35,
  stabilization: { iterations: 150 },
}
```

Behavior produced:
- **Idle**: nodes never fully settle — there's a slow, low-energy continuous drift.
- **Drag**: grab a node, springs propagate elastically through the graph.
- **Click**: vis-network's default selection ring outlines the node.
- **Zoom/pan**: vis-network built-in (scroll = zoom, drag empty canvas = pan).
- **No custom hover handlers** — interaction is library default.

## Palette (provenance)

Vis-network defaults — these are `[token: vis-network/defaults]`:
- background: white `#FFFFFF`
- node group palette (cycles): orange `#FFA807`, blue `#97C2FC`, red `#FB7E81`, cyan `#7BE141`, green `#7BE141`, purple `#AD85E4`, yellow `#FFFF00` (approximate; vis-network's exact group palette is documented in their `Network` source — verify before lifting)
- edge stroke: `#848484` ish
- selection outline: blue `#2B7CE9`

## Typography

- Family: `verdana` `[token: from pen source]`
- Sizes: 24px / 36px depending on hierarchy
- Stroke: 3px white halo `[token: from pen source]`

## What's NOT in the pen (gaps for our use)

- No keyboard shortcuts
- No search affordance
- No status overlay / metadata layers
- No orphan handling (no isolated nodes in the dataset)
- No tooltips
- No dependency-vs-parent edge distinction (all edges look the same)
