# Insights — am-6: mode_decision actual registration

## The recognized-set is scattered across SKILL.md in 8+ places

Adding a new mode requires touching: (1) Outputs enum comment, (2) mode_decision values list, (3) env check prose, (4) config check prose, (5) Step 0 recognized values for env path, (6) Step 0 recognized values for config path, (7) Step 0 "when decision is X" clause, (8) WARNING message recognized list, (9) Step 1 switch branches, (10) Step 2 return type comment, (11) Configuration yaml/sh examples, (12) priority table examples, (13) Reuses list.

**Gotcha:** Missing any one of these is a silent omission — no test or linter catches it. The WARNING message is especially easy to miss (it lives in Step 0, far from the Step 1 dispatch branches).

## mode-resolver.mjs is the gate — SKILL.md is the contract

The resolver (`hive/lib/mode-resolver.mjs`) must have `actual` in its recognized-values registry or it silently falls through to default (per the "silencing rule"). SKILL.md describes the contract; the resolver enforces it. If a future mode fails to resolve, check the resolver registry first — the SKILL.md wording is correct but the resolver list is the real gate.

## Additive pattern is strict — do not touch existing branches

The dispatch structure (Step 0 → Step 1 → Step 2) is a structural mirror of execute-dispatch. The architect ESCALATION anchor means the shape must stay identical. Adding `actual` required only inserting new enum values, a new Step 1 branch, and updating prose — zero structural changes. Any deviation from the mirror shape is a flag for the architect.
