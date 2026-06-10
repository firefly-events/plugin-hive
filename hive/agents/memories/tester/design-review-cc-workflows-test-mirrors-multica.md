---
name: design-review-cc-workflows-test-mirrors-multica
description: When testing a cc-workflows atom that mirrors a Multica atom, invert the substrate-specific assertions — episode marker is cc-workflows-run.yaml not multica-run.yaml, no assertWorktreeIsolation check in Multica tests but required in cc-workflows tests.
applies_to: tester
---

The dr-2 (Multica) and dr-3 (cc-workflows) resolver tests cover the same 5-tier resolver and 4-step dispatch shape, but diverge on substrate-specific assertions.
In dr-2: assertWorktreeIsolation must NOT appear; multica-story-dispatch must appear; marker is multica-run.yaml; ONE Multica issue shape tested.
In dr-3: assertWorktreeIsolation IS required (s-3 Check 4 enforces it); marker is cc-workflows-run.yaml with {unit_id} path; ONE Workflow TOOL run, FOUR agent() calls.
When copying the Multica resolver test as the starting template, audit every substrate-specific block and flip accordingly — missing this produces false green tests that assert the wrong marker file or skip the preconditions import check entirely.
See: skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs lines 420-428 (the Multica-specific no-codex block that explicitly asserts assertWorktreeIsolation is absent).
