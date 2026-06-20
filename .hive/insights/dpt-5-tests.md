# dpt-5-tests — Planning Classification Test Insights

## Prose skills need inline resolution logic

The planning-classification skill (dpt-3) is a SKILL.md — no executable code. Tests for prose skills must embed the resolution rules directly in the test harness (as a reference implementation) and then assert the catalog data satisfies the invariants. The harness function `resolvePersonas()` in `tests/skills/planning-classification.test.js` is the canonical reference: if the prose skill's rules change, this function must be updated to match, and the test set will catch regressions in the catalog data.

## YAML extraction: fence inside named section, not global first-fence

`specialist-triggers.md` has two separate `yaml` blocks: the planning_composition block and the catalog block. Always scope extraction to the section boundary (`## Planning Composition` → next `## `) before matching the fence, or you'll grab the wrong block.

## js-yaml is available but requires `npm install`

`js-yaml@4.2.0` is declared in `package.json` but the worktree may not have `node_modules/` pre-populated. Run `npm install` before running tests with `node --test`. The test runner (bun per project-profile) also resolves npm deps.

## project_gate null means always-include

The catalog uses `project_gate: ~` (YAML null) for ungated work types. Treat `null` as "always include" — do not conflate with a missing field. The only non-null gate value currently is `requires_ui`.

## Dedup order follows first-insertion

When two tags map to the same specialist (data + architecture → architect), first-insertion order governs. The spine is always inserted first, so specialists appear after tpm in insertion order. The test asserts `archIdx > tpmIdx` to lock this stable-order invariant.

## Test placement: tests/skills/

New skill-level behavioral tests go in `tests/skills/` following the `<skill-name>.test.js` naming convention. Existing files in that directory: `context-snapshot.test.mjs`, `standup-format-slack.test.js`, `triage-json.test.mjs`.
