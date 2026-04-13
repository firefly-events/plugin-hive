---
name: compositor-only-properties-for-animation
description: "animate only transform and opacity on compositor layers; animating any other CSS property triggers layout/paint and causes jank — flag it as a performance risk"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

The GPU compositor can animate `transform` and `opacity` without triggering layout or paint.
Every other CSS property forces the browser to recalculate layout (width, height, top, left,
margin, padding) or repaint (background-color, border, box-shadow) on every frame.

Rule: **only animate `transform` and `opacity`.**

Safe — compositor-only (60fps on mid-range hardware):
```css
/* translate instead of left/top */
transform: translateX(100px);
transform: translateY(-50%);
transform: scale(1.05);

/* fade */
opacity: 0;
```

Unsafe — triggers layout or paint (flag as PERFORMANCE_RISK):
```css
width: 0 → 100%;     /* layout */
height: auto;         /* layout */
top: -10px;           /* layout */
left: 200px;          /* layout */
background-color: …;  /* paint */
border-color: …;      /* paint */
box-shadow: …;        /* paint */
```

What to do when you find an unsafe animation:
1. Add it to Findings: `path/to/file.css:42 — PERFORMANCE_RISK: animating {property} triggers layout`
2. Rewrite using `transform` equivalent if possible (e.g., `left: X` → `transform: translateX(X)`)
3. If no `transform` equivalent exists (e.g., background-color), note in Remaining Issues:
   "Cannot refactor {property} animation to compositor-only without design change"

Promote compositor layers intentionally:
```css
/* Use will-change only when you know an element will animate — not preemptively */
.animated-card {
  will-change: transform;
}
```

Remove `will-change` after the animation completes if the element returns to static state.
Leaving `will-change` permanently wastes GPU memory.
