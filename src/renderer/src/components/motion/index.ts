// The motion and surface kit (phase 1 of the redesign). Classes these drive,
// and the tokens, are in styles.css: surface, surface-raised, card-hover,
// spotlight, reveal, reveal-scale, stagger, collapsible, chevron, indicator,
// shimmer, drift, pulse-ring, live-border, live-glow, text-brand, bg-brand,
// btn-primary, page-header, canvas, vt-panel; hero-tile, stat-pill, live-line,
// trace-sketch, side-in.
export { Collapse } from '@/components/motion/collapse'
export { CountUp, useCountUp } from '@/components/motion/count-up'
export { CursorAura } from '@/components/motion/cursor-aura'
export { HeroTile, Stat, StatSkeleton } from '@/components/motion/hero'
export { useIndicator, type IndicatorOptions } from '@/components/motion/indicator'
export { PageHeader } from '@/components/motion/page-header'
export { prefersReducedMotion, useReducedMotion } from '@/components/motion/reduced-motion'
export { Reveal, revealStyle } from '@/components/motion/reveal'
export { RunAura } from '@/components/motion/run-aura'
export { spotlight } from '@/components/motion/spotlight'
export { Segmented, type SegmentedOption, Tab, TabBar } from '@/components/motion/tabs'
export { type TransitionKind, viewTransition } from '@/components/motion/view-transition'
