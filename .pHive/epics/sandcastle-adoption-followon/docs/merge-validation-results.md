# Merge Validation Results — S4 (sandcastle-adoption-followon)

**Date:** 2026-05-12  
**Branch:** feat/sandcastle-adoption-followon  
**Story:** s4-merge-validation  
**Tester:** tester agent (Sonnet 4.6)

---

## Environment Table (Preflight Probes)

| Probe | Command | Result | Status |
|---|---|---|---|
| Node version | `node --version` | v25.9.0 | PASS |
| Podman binary | `which podman` | `/opt/homebrew/bin/podman` | PRESENT |
| Podman daemon | `podman version 2>&1 \| head -3` | `Cannot connect to Podman. Please verify your connection to the Linux system using podman system connection list, or try podman machine init and podman machine start` | **FAIL — daemon not running** |
| Docker binary | `which docker` | not-found | INFO (not required) |
| OPENAI_API_KEY | `printenv OPENAI_API_KEY \| wc -c` | `0` | **FAIL — key not set** |
| auth.json | `ls -la .sandcastle/codex-config/auth.json` | `No such file or directory` | **FAIL — file absent** |
| @ai-hero/sandcastle (npm ls) | `npm ls @ai-hero/sandcastle` | `(empty)` — no dep in root package.json | **FAIL — not installed** |
| @ai-hero/sandcastle (require) | `node -e "require('@ai-hero/sandcastle/package.json').version"` | `not-installed: MODULE_NOT_FOUND` | **FAIL — not installed** |

---

## Outcome Class: B — Live Run NOT Possible

**Reason:** Four independent prerequisites are missing. Any single one would block the live run; all four are absent.

| # | Missing Prerequisite | Required Value | How to Unblock |
|---|---|---|---|
| 1 | `OPENAI_API_KEY` | Non-empty string (sk-…) | Export the key in the dispatch environment: `export OPENAI_API_KEY=sk-...` |
| 2 | Sandcastle package | `@ai-hero/sandcastle` resolvable via `require()` | `npm install @ai-hero/sandcastle` (or add to root `package.json` devDependencies and `npm install`) |
| 3 | Podman daemon | Running Podman machine or socket | `podman machine init && podman machine start` (macOS) |
| 4 | `.sandcastle/codex-config/auth.json` | JSON file with Codex auth credentials | Follow `.pHive/spikes/sandcastle/README.md` auth setup; see `feedback_sandcastle_codex_auth_gap.md` — env key alone causes 401; mount required |

Per the story AC OR-branch: *"produce a documented blocking failure"* — this document is that record. The story remains **validation-blocked-on-prerequisite**.

---

## Unit-Test Re-Attestation (S1–S3 surfaces — run regardless of class)

All four S1–S3 unit suites executed successfully. No failures.

| Suite | File | Tests | Pass | Fail | Duration |
|---|---|---|---|---|---|
| Log Redaction | `tests/hive-lib/sandcastle-log-redaction.test.js` | 22 | 22 | 0 | 82.5 ms |
| Provider | `tests/hive-lib/sandcastle-provider.test.js` | 15 | 15 | 0 | 84.6 ms |
| Provider Hooks | `tests/hive-lib/sandcastle-provider-hooks.test.js` | 14 | 14 | 0 | 84.4 ms |
| Dispatch Routing | `tests/execute-dispatch-sandcastle.test.js` | 9 | 9 | 0 | 69.2 ms |
| **Total** | | **60** | **60** | **0** | |

S1–S3 shipped behavior is confirmed sound. No fix-forward is needed.

---

## Validation Not Executed

No live parallel-branch Codex runs were attempted. The following commands would constitute the Class A validation when prerequisites are met:

```js
// Planned harness shape (from .pHive/spikes/sandcastle/harness.ts)
// Two parallel named-branch Sandcastle runs through createSandcastleProvider
const t0 = Date.now();
const [r1, r2] = await Promise.all([
  runWithBranch('validation-branch-a'),
  runWithBranch('validation-branch-b'),
]);
console.log(`elapsed: ${Date.now() - t0}ms`);
// Verify: both r1.ok and r2.ok, wt.close() invoked, no key in logs
```

Branch names to use when re-running: `validation-branch-a`, `validation-branch-b`.

---

## Findings

No defects discovered. Validation was blocked before any code path was exercised.  
No fix-forward patches were applied.

No follow-on items surfaced from this story; the only open item is the re-run itself once prerequisites are satisfied.

---

## Re-Run Checklist

Before re-dispatching s4-merge-validation:

- [ ] `export OPENAI_API_KEY=sk-...` in the dispatch environment
- [ ] `npm install @ai-hero/sandcastle` (confirm `node -e "require('@ai-hero/sandcastle/package.json').version"` prints a version)
- [ ] `podman machine start` (confirm `podman version` succeeds without socket error)
- [ ] Create `.sandcastle/codex-config/auth.json` with valid Codex credentials (ref: `feedback_sandcastle_codex_auth_gap.md`)
- [ ] Re-run the four unit suites to confirm S1–S3 still green
- [ ] Run `scripts/sandcastle-merge-validation.mjs` (to be authored in Class A pass)

---

## Cleanup Result

N/A — no worktrees were created. No `wt.close()` calls were needed. Legacy `.claude/worktrees/` was not touched.

---

## Redaction Check

No live run executed, so no logs to inspect. As a proxy: `sandcastle-log-redaction.test.js` passed 22/22, confirming the redaction module correctly strips key values before they reach any log output. No key value leaked in this validation run (key was absent from the environment).

---

*Outcome class B recorded per story s4-merge-validation AC OR-branch.*
