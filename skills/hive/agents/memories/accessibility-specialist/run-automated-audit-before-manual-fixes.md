---
name: run-automated-audit-before-manual-fixes
description: "always run an automated a11y audit (axe, pa11y) before writing any manual ARIA fixes; automated scans catch violations you will miss in a code-only read"
type: pattern
last_verified: 2026-04-13
ttl_days: 90
source: agent
---

Before writing a single ARIA attribute or keyboard-nav fix, run an automated audit.

Priority order:
1. **axe-core** — `npx axe <url>` or via the axe browser extension
2. **pa11y** — `npx pa11y <url>` (HTML report if multiple pages)
3. **eslint-plugin-jsx-a11y** — for React components without a running server

Why this comes first:
- Automated scanners catch ~30–40% of WCAG violations that are invisible in a code read
  (e.g., missing alt text, unlabeled form fields, insufficient contrast ratios in computed styles)
- Manual fixes applied without a scan baseline produce a report with no before/after comparison
- The audit output becomes the Findings section of your Work Report

If no audit tooling is available in the project:
1. Note "No automated a11y tooling detected" in your Work Report Findings section
2. Conduct a manual code audit using the WCAG 2.1 AA checklist as your audit frame
3. Do NOT skip producing Findings — the manual checklist is your audit output

Protocol:
1. Check for `axe`, `pa11y`, or `eslint-plugin-jsx-a11y` in `package.json`
2. If present: run the audit, capture output, use it as your Findings baseline
3. Then make code fixes, targeted at the violations the audit surfaced
4. Re-run the audit after fixes to confirm violations are resolved
5. Include before/after audit summary in your Work Report
