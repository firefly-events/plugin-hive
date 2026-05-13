## Performance Audit: Sandcastle Adoption (post-run, minor severity)

**Date:** 2026-05-12
**Branch:** feat/sandcastle-adoption-followon
**Reviewer:** performance-reviewer (Sonnet 4.6)
**Severity:** minor — informational only

---

## Cold-Start Surface

Every routed `mode: sandcastle` invocation calls `createSandcastleProvider()`, which
immediately constructs a live `sandboxProvider` via the Podman (or Docker) factory.
The construction boundary is:

- `hive/lib/sandcastle-provider.js:264–268` — Podman default path:
  ```js
  const podmanFactory = deps.podmanFactory || (function loadPodman() {
    return require('@ai-hero/sandcastle/sandboxes/podman').podman;
  }());
  sandboxProvider = podmanFactory(sandboxOptions);
  ```
- `hive/lib/sandcastle-provider.js:257–261` — Docker opt-in path (analogous).

`podmanFactory(sandboxOptions)` is the point at which Sandcastle initiates the
container runtime interaction. Because `createSandcastleProvider()` is called fresh
on every dispatch (no provider instance reuse between runs), any podman cold-start
cost is incurred on **every routed mode invocation**.

Subsequently, `createWorktree(storyId)` at line 300 calls Sandcastle's
`createWorktree({ sandbox: sandboxProvider, branchStrategy: ... })`, which is the
second per-run I/O boundary (worktree setup + container start).

**Cold-start cost characterization:** unmeasured-in-V1, blocked by S4 class B
prerequisite gap. No live Sandcastle runs were executed; no podman daemon was
present in the dispatch environment.

---

## Measurements

S4 validation (story `s4-merge-validation`, 2026-05-12) returned **Outcome Class B —
Live Run NOT Possible**. No timing data was produced. Zero podman operations were
executed.

The four prerequisite items required for a Class A re-run:

| # | Missing Prerequisite | How to Unblock |
|---|---|---|
| 1 | `OPENAI_API_KEY` env var | `export OPENAI_API_KEY=sk-…` in dispatch environment |
| 2 | `@ai-hero/sandcastle` package installed | `npm install @ai-hero/sandcastle` (confirm via `require('@ai-hero/sandcastle/package.json').version`) |
| 3 | Podman daemon running | `podman machine init && podman machine start` (macOS) |
| 4 | `.sandcastle/codex-config/auth.json` with Codex credentials | Follow `.pHive/spikes/sandcastle/README.md`; env key alone causes 401 (ref: `feedback_sandcastle_codex_auth_gap.md`) |

Full re-run checklist: `.pHive/epics/sandcastle-adoption-followon/docs/merge-validation-results.md`
§ Re-Run Checklist.

---

## Recommendations

- Monitor parallel-run cumulative cold-start time versus per-story workflow elapsed
  time once Class A validation is possible. If profiling or telemetry shows that
  sandbox initialization is a dominant fraction of total execution time, open a
  warm-pool planning story.
- Do not adopt the warm-pool pattern based on assumed or estimated latency. Wait
  for evidence from instrumented runs.
- Cross-link: `hive/references/sandcastle-warm-pool-placeholder.md` is the
  designated parking lot for the long-lived `createSandbox()` warm-pool pattern.
  Trigger conditions documented there are categorical (measured cost becomes
  material), not numeric — no threshold should be invented.

---

## Findings

- **[io] `hive/lib/sandcastle-provider.js:264–268`** — A new `sandboxProvider`
  (and therefore a new container runtime interaction) is constructed on every call
  to `createSandcastleProvider()`. There is no provider-instance reuse or pooling
  between dispatch cycles. Per-run podman cold-start cost will accumulate in
  high-frequency or parallel-story dispatch scenarios. Severity: minor
  (informational). Baseline measurement deferred to Class A re-run.

---

## Verdict

informational
