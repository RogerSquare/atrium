// Motion primitives for the facelift initiative (see tasks/Atrium/ui-facelift-*).
//
// Re-exports framer-motion's building blocks plus a reduced-motion-aware helper.
// All animations in the facelift layer must honor prefers-reduced-motion; this
// module is the single place we wrap that contract so consumers don't each
// re-implement it.

import { useReducedMotion as _useReducedMotion } from 'framer-motion'

export { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'framer-motion'

// Standard motion durations (milliseconds). Mirror the CSS tokens in
// index.css --duration-* so consumers can pass raw numbers to framer-motion's
// transition={{ duration: ... }} API (which expects seconds, so divide by 1000).
export const MOTION_DURATIONS = {
  fast: 0.15,       // --duration-fast
  normal: 0.25,     // --duration-normal
  slow: 0.35,       // --duration-slow
  morph: 0.24,      // --duration-morph (card -> detail pane shared element)
  palette: 0.16,    // --duration-palette (Cmd+K open/close)
  viewFade: 0.18,   // page/view cross-fade
  tabFade: 0.14,    // tab switch crossfade inside detail pane
  rowStagger: 0.10, // list row stagger step
  cardStagger: 0.14 // kanban card stagger step
}

// Spring presets.
export const MOTION_SPRINGS = {
  drop: { type: 'spring', stiffness: 280, damping: 28 },  // drag drop / filter reflow
  paletteOpen: { type: 'spring', stiffness: 300, damping: 30 }
}

// Pick a transition that collapses to { duration: 0 } when prefers-reduced-motion is set.
// Usage:
//   const transition = useMotionTransition({ duration: MOTION_DURATIONS.morph, ease: 'easeOut' })
//   <motion.div animate={{ opacity: 1 }} transition={transition} />
export function useMotionTransition(transition) {
  const reduced = _useReducedMotion()
  if (reduced) return { duration: 0 }
  return transition
}
