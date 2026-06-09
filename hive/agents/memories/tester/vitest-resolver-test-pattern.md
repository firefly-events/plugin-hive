---
name: vitest-resolver-test-pattern
description: Mirror the sibling resolver test shape exactly — vitest, 5-tier permutations, only-winning-tier assertion, plus a raw-token footgun test for ctx.env.
applies_to: tester
---

All dispatch resolver tests use vitest (not node:test). The canonical pattern is in skills/hive/skills/review-dispatch/test/resolver.test.mjs: one describe block per tier, one it per permutation, asserting both the decision value and that Object.keys(result.sources) contains only the winning tier key. Add a footgun test confirming that passing a bare value to ctx.env (without VARNAME=) silently falls through — mode-resolver.mjs:75 parses at '=' and mismatched varName drops to the next tier. Adding the new test file to hive/lib/package.json scripts.test vitest file list is required or it is never run.
