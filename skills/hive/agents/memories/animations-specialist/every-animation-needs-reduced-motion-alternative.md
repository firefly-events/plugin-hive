---
name: every-animation-needs-reduced-motion-alternative
description: "every animated element MUST have a prefers-reduced-motion alternative before the implementation is considered done; this is not optional even on deadline"
type: pitfall
last_verified: 2026-04-13
ttl_days: 180
source: agent
---

No animation is done until it has a `prefers-reduced-motion: reduce` alternative.

This is not optional. WCAG 2.1 SC 2.3.3 (AAA) and real user accessibility require it.
Many users with vestibular disorders experience nausea, vertigo, or seizures from motion.

The check is simple and must happen before you write your Work Report:
```css
@media (prefers-reduced-motion: reduce) {
  .my-animated-element {
    animation: none;
    transition: none;
  }
}
```

Or in JS (React example):
```js
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

Rules:
1. Every CSS animation and transition you add must be wrapped or overridden in
   `@media (prefers-reduced-motion: reduce)`
2. Every JS-driven animation must check `prefers-reduced-motion` before starting
3. The fallback must be meaningful — either instant state change or a subtle opacity fade
   (opacity fades ≤ 150ms are generally safe for vestibular sensitivity)
4. Do NOT use `animation-duration: 0.01ms` as a hack — use `animation: none`

Audit step (add this to every implementation):
- Search for `animation:`, `transition:`, `animate(`, `gsap.to(`, `useSpring(`, `motion.`
  in all files you touched
- For each match: verify a reduced-motion override exists

If you find an existing animation in the codebase that lacks a reduced-motion alternative
and it's in scope: fix it. Add the finding to your Work Report under Changes Made.
If it's out of scope: add it to Remaining Issues.
