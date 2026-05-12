# Architect Review — Phase B2 H/V Plans

**Verdict:** approve-with-escalation

## Pass 1: Horizontal plan feasibility

### H1. Auth/setup Layer

**Verdict:** approve.

**Observed in plan:** H1 owns a dedicated `/hive:sandbox-setup` skill and keeps setup out of `/execute` hot-path dispatch (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:17-27`). It provides preconditions to H3 and H5 (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:29-35`).

**Contract evidence:** user decisions lock the dedicated setup skill as a Tier-1 hard prerequisite (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:7-12`).

**Seam cleanness:** clean. One-time host auth setup is a separate operational surface from per-run Sandcastle execution.

**Touched-file correctness:** correct. `skills/hive/skills/sandbox-setup/SKILL.md` is a new setup skill; existing dispatch paths are intentionally untouched in this layer (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:25-27`).

**Cross-layer dependency completeness:** complete for H3 auth mount and H5 fail-fast/warn behavior (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:33-34`).

**Hidden coupling missed:** none. H1 correctly does not modify `execute-dispatch` or `backend-dispatch`.

**Architectural judgment:** the setup checklist reference should name the exact canonical path during story spec authoring, but this is not a feasibility blocker.

### H2. Logging/redaction Layer

**Verdict:** approve.

**Observed in plan:** H2 adds an in-Hive stdout/stderr redaction wrapper and `.sandcastle/` gitignore coverage before provider instantiation (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:44-69`).

**Contract evidence:** user decisions lock in-Hive logger redaction as a Tier-1 hard prerequisite (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:7-12`). The sequencing memo requires the wrapper before `SandboxProvider` instantiation (`.pHive/epics/sandcastle-adoption-followon/docs/tpm-sequencing-memo-b2.md:21-25`).

**Seam cleanness:** clean. Redaction sits at the Hive boundary around Sandcastle logger output and does not flow into sidecar bundles.

**Touched-file correctness:** correct at the architectural level. New module under `hive/lib/`, default `.gitignore` template, and docs are the right surfaces (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:48-54`).

**Cross-layer dependency completeness:** complete. H2 gates H3 provider construction, H5 execution-mode routing, and H6 documentation (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:56-62`).

**Hidden coupling missed:** minor implementation detail only: story spec must identify the actual default `.gitignore` template file. The layer is still feasible.

**Architectural judgment:** in-Hive wrapper is the right location because the leak is in local Sandcastle process/container logging before downstream consumers see it.

### H3. Sandcastle Provider Wrapping Layer

**Verdict:** approve with minor contract addition.

**Observed in plan:** H3 centralizes Sandcastle factories behind Hive defaults: Podman default, Docker opt-in, `userns: false`, `branchStrategy: { type: "branch", branch: <story-id> }`, logger wrapping, and worktree lifecycle cleanup (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:71-99`).

**Contract evidence:** H3 consumes H1 and H2, contains H4, and provides the wrapper to H5 (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:83-90`).

**Seam cleanness:** mostly clean. The provider wrapper is the correct boundary for Sandcastle lifecycle defaults. It keeps factory construction out of the execution-mode SKILL.

**Touched-file correctness:** correct. New provider wrapper module and tests are sufficient; no existing dispatch file should be touched in this layer (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:75-81`).

**Cross-layer dependency completeness:** complete for auth, redaction, hook containment, and execution-mode consumption (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:83-90`).

**Hidden coupling missed:** version drift. Sandcastle is a 0.x package, and the plan does not currently require a dependency/runtime contract check. The spike and current npm metadata both resolve to `@ai-hero/sandcastle@0.5.10`; S2/S3 should fail fast below that version.

**Architectural judgment:** add provider wrapper tests for lifecycle cleanup ownership and a mode preflight for package version. This is an implementation acceptance addition, not a layer recut.

### H4. Hooks Layer

**Verdict:** approve.

**Observed in plan:** H4 wires exactly one lifecycle hook, `host.onWorktreeReady`, inside the provider wrapper and avoids standalone hook YAML or speculative hook surfaces (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:100-126`).

**Contract evidence:** user decisions specify exactly one V1 hook and defer `host.onSandboxReady` plus `sandbox.onSandboxReady` (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:21-30`).

**Seam cleanness:** clean. Hooks are lifecycle preparation, not Hive PreToolUse/PostToolUse replacement.

**Touched-file correctness:** correct. Provider wrapper, `execute-mode-sandcastle/SKILL.md` prose, and docs are the right surfaces (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:104-111`).

**Cross-layer dependency completeness:** complete. H4 lives inside H3, is surfaced by H5, and documented by H6 (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:113-119`).

**Hidden coupling missed:** none. The plan explicitly blocks speculative hook templates.

**Architectural judgment:** the hook boundary is thin enough for V1 and preserves future expansion without shipping unused configuration.

### H5. Execution-mode Routing Layer

**Verdict:** approve with required acceptance precision.

**Observed in plan:** H5 adds `execute-mode-sandcastle/SKILL.md`, extends `mode_decision`, adds `field_sources.execution_mode`, and updates the caller switch in `skills/execute/SKILL.md:143` (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:128-157`).

**Contract evidence:** `skills/hive/skills/execute-dispatch/SKILL.md:16` currently says `mode_decision enum sessions | team | team-cmux | sequential`. `skills/hive/skills/execute-dispatch/SKILL.md:44-63` tracks only `sessions_enabled`, `parallel_teams`, `terminal_mux`, and `executor`. `skills/execute/SKILL.md:143` currently switches only `sessions`, `team-cmux`, `team`, and `sequential`.

**Seam cleanness:** clean. Sandcastle belongs as an execution mode, not a backend. `skills/hive/skills/backend-dispatch/SKILL.md:32-40` resolves only model provider backend `claude | codex`; Sandcastle should not enter that enum.

**Touched-file correctness:** correct. The three routing surfaces listed in the plan are necessary and sufficient for the hidden coupling (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:132-139`).

**Cross-layer dependency completeness:** complete for H3/H4 consumption and H6 docs. H5b live-quota validation is correctly separated as confidence work (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:141-148`).

**Hidden coupling missed:** none. The plan explicitly calls out `skills/execute/SKILL.md:143`.

**Architectural judgment:** `execution_mode` must be resolved with the same env > config > default source tracking discipline as existing fields; do not overload `terminal_mux` or `executor`.

### H6. Documentation Layer

**Verdict:** approve.

**Observed in plan:** H6 trails execution-touching layers and splits docs into adoption guide, hooks reference, and warm-pool note (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:159-186`).

**Contract evidence:** vertical plan makes S5 depend on S4 so docs reflect operational validation, not design intent (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:168-206`).

**Seam cleanness:** clean. User-facing adoption docs are separated from the minimal hooks reference and future warm-pool architecture note.

**Touched-file correctness:** correct. Canonical Hive references are the right home for durable behavior docs (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:163-169`).

**Cross-layer dependency completeness:** complete. H6 consumes H1-H5 and H5b (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:171-178`).

**Hidden coupling missed:** none.

**Architectural judgment:** the two-doc split is justified; the warm-pool note may remain standalone because S7 is explicitly doc-only.

### H7. Defer-marker / Upstream-watch Layer

**Verdict:** approve.

**Observed in plan:** H7 creates an upstream watch file, audit gate, and project memory pointer for Sandcastle issue #191 while keeping the Codex-path runtime independent (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:188-212`).

**Contract evidence:** user decisions require an explicit defer-marker story rather than memory-only tracking (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:31-39`).

**Seam cleanness:** clean. H7 is an enforcement guardrail, not runtime routing.

**Touched-file correctness:** correct. `.pHive/upstream-watch/sandcastle-191.md`, a targeted audit script, and memory pointer are the right surfaces (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:192-198`).

**Cross-layer dependency completeness:** complete. It has no runtime dependency and guards H5 indirectly (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:200-205`).

**Hidden coupling missed:** none.

**Architectural judgment:** the audit gate must search only for `claudeCode()` Sandcastle wiring so it does not block Codex-path Sandcastle mode.

## Pass 2: Vertical plan feasibility

### S1. Ship-gate Prerequisites - Auth, Redaction, Gitignore

**Verdict:** approve.

**Observed in plan:** S1 includes `codex-auth-setup-skill`, `logger-redaction-wrapper`, and `gitignore-template-update`; its working state validates setup, fake-key redaction, and `.sandcastle/` ignore coverage before routing exists (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:19-55`).

**Working-state achievability:** achievable. It is inspectable without any Sandcastle execution-mode route.

**Slice boundary cleanliness:** clean. Auth setup and redaction are prerequisites, not provider or routing behavior.

**depends_on correctness:** correct: none (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:43`).

**Could be thinner:** yes technically, but not usefully. Splitting auth/redaction/gitignore into separate slices would lose the Tier-1 security gate as a coherent working state.

**Issue:** no blocker. Story specs must name the `.gitignore` template path.

### S2. Sandcastle Provider Wrapping + Minimal Hooks

**Verdict:** approve with minor acceptance addition.

**Observed in plan:** S2 adds the provider wrapper and inline `host.onWorktreeReady` hook without user-facing `/execute` selection (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:57-91`).

**Working-state achievability:** achievable through a direct harness that creates a worktree, runs a no-op, exercises redacted logging, fires the hook, and tears down cleanly (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:63-69`).

**Slice boundary cleanliness:** clean. It validates lifecycle mechanics before routing.

**depends_on correctness:** correct: S1 is required for auth and redaction (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:79`).

**Could be thinner:** no. Splitting hooks from wrapper would create a non-working hook slice because H4 lives inside provider construction.

**Issue:** add explicit `@ai-hero/sandcastle >=0.5.10` dependency/runtime preflight to acceptance, either in S2 wrapper tests or S3 mode preflight.

### S3. Execution-mode SKILL + Dispatch Routing

**Verdict:** approve.

**Observed in plan:** S3 adds the Sandcastle execution-mode SKILL and mode-routing integration, including enum extension, field-source attribution, and `skills/execute/SKILL.md:143` switch update (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:93-129`).

**Working-state achievability:** achievable. A user can opt in via `HIVE_EXECUTION_MODE=sandcastle` or `execution.mode: sandcastle`, and existing paths must pass regression checks (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:99-129`).

**Slice boundary cleanliness:** clean. SKILL prose and dispatch mechanics are split as two stories inside one slice, which preserves one working state.

**depends_on correctness:** correct: S2 provides the wrapped provider (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:116`).

**Could be thinner:** not without losing working state. Shipping the SKILL without dispatch, or dispatch without the SKILL, is not useful.

**Issue:** no blocker. Acceptance must assert non-Sandcastle mode behavior remains unchanged.

### S4. Merge-behavior Live-quota Validation

**Verdict:** approve.

**Observed in plan:** S4 runs two parallel named-branch Sandcastle runs through merge behavior under live quota and records findings, allowing small same-slice fix-forward (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:131-166`).

**Working-state achievability:** achievable if live quota is available. The output is a validation artifact and result table, not a speculative unit test.

**Slice boundary cleanliness:** clean. This is validation of shipped S1-S3 behavior, not new architecture.

**depends_on correctness:** correct: S3 is required because S4 must exercise the complete routed mode (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:154`).

**Could be thinner:** no. One parallel-run validation story is already the thinnest meaningful merge-behavior proof.

**Issue:** same-slice fix-forward is acceptable only for defects directly exposed by the validation run and bounded to S1-S3 surfaces.

### S5. Documentation - Adoption Guide + Hooks Reference

**Verdict:** approve.

**Observed in plan:** S5 lands two docs after S1-S4: adoption guide and hooks reference (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:168-206`).

**Working-state achievability:** achievable. Docs can be reviewed against shipped behavior and S4 validation evidence.

**Slice boundary cleanliness:** clean. The adoption guide and hooks reference are separate story surfaces but one documentation slice.

**depends_on correctness:** correct: S4 prevents docs from documenting unvalidated behavior (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:194-200`).

**Could be thinner:** yes, the two docs could be two slices, but that would add planning overhead without improving working state.

**Issue:** no blocker. Hooks docs must not document deferred hook points as available.

### S6. #191 Defer-marker

**Verdict:** approve.

**Observed in plan:** S6 creates the upstream watch file, CI/local audit gate, and project memory pointer (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:208-241`).

**Working-state achievability:** achievable. A deliberate test fixture can prove the audit gate catches `claudeCode()` Sandcastle wiring while allowing Codex-path mode.

**Slice boundary cleanliness:** clean. Runtime-independent guardrail work is isolated.

**depends_on correctness:** mostly correct. Runtime dependency is none; sequencing after S5 is priority-based, not technical (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:229`).

**Could be thinner:** no. Watch file without audit gate would not be enforceable; audit gate without watch context would be opaque.

**Issue:** no blocker. The gate must be narrow to avoid blocking Codex-path Sandcastle code.

### S7. Warm-pool Placeholder

**Verdict:** approve.

**Observed in plan:** S7 is a doc-only architecture note tied to S2/S4 performance evidence and includes no runtime code (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:243-276`).

**Working-state achievability:** achievable. The output is one architecture note describing when `createSandbox()` would be justified.

**Slice boundary cleanliness:** clean. It parks a future optimization without leaking into the provider wrapper.

**depends_on correctness:** correct: S4 provides the performance/validation signal (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:264`).

**Could be thinner:** no. It is already doc-only.

**Issue:** no blocker. The note must avoid inventing an unmeasured threshold.

## Pass 3: Writer-flagged re-validation items

### 1. wt.close() ownership

**Verdict:** split-ownership rule holds.

**Observed in plan:** H3 says Sandcastle owns `wt.close()` only for worktrees it creates; legacy `.claude/worktrees/{story-id}` retains its existing owner (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:96-97`). S2 includes the ownership declaration in the provider-wrapping story (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:67-69`).

**Contract evidence:** `hive/references/sandboxing-patterns.md:19-22` creates legacy worktrees at `.claude/worktrees/{story-id}`. `hive/references/sandboxing-patterns.md:38-42` removes those worktrees with `git worktree remove .claude/worktrees/{story-id}`. That is a legacy orchestrator ownership path, not a Sandcastle-created `Worktree`.

**Definitive rule:** Sandcastle mode owns `wt.close()` exactly when the Sandcastle provider created the worktree object. Legacy orchestrator/team execution owns cleanup for `.claude/worktrees/{story-id}` when that path created the worktree.

**Required story-spec wording:** "Do not call `wt.close()` for a legacy `.claude/worktrees/{story-id}` worktree handed in by another owner; do call `wt.close()` for the Sandcastle-created worktree before returning from the Sandcastle execution path."

### 2. Redaction wrapper location

**Verdict:** in-Hive wrapper is correct.

**Observed in plan:** H2 places the wrapper under `hive/lib/` and requires wrapping before `SandboxProvider` instantiation (`.pHive/epics/sandcastle-adoption-followon/docs/horizontal-plan.md:48-62`). S1 tests fake-key masking before any execution-mode path routes through Sandcastle (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:25-55`).

**Contract evidence:** user decisions lock R-B as an in-Hive logger redaction wrapper and Tier-1 hard prereq (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:7-12`).

**Rationale:** the leak surface is local Sandcastle file/logger output from container invocation. Hive controls the wrapper boundary and can test it deterministically with fake keys; waiting for upstream would leave the ship gate unresolved.

**Correction needed:** none. Story spec should choose a precise module name under `hive/lib/`, for example `hive/lib/sandcastle-redaction.*`, but the layer location is feasible.

### 3. S4 fix-forward boundary

**Verdict:** permit same-slice fix-forward, narrowly.

**Observed in plan:** S4 explicitly permits a small same-slice fix-forward if live validation exposes a defect (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:156-162`). The TPM memo says not to force a separate Tier follow-on for a small fix (`.pHive/epics/sandcastle-adoption-followon/docs/tpm-sequencing-memo-b2.md:125-136`).

**Allowed:** fixes directly required to make the S4 validation pass across S1-S3 surfaces: branch naming, cleanup ownership, route invocation, redaction application, or validation harness adjustments.

**Not allowed:** new features, warm-pool behavior, sidecar bundle integration, `claudeCode()` lane work, or broad refactors unrelated to the live validation failure.

**Rationale:** S4 exists because merge behavior is unproven. Forcing a separate story for a small validation-discovered defect would turn validation into paperwork and delay docs without improving architecture.

### 4. Sandcastle version check

**Verdict:** yes, include a runtime/preflight version check.

**Minimum supported version:** `@ai-hero/sandcastle >= 0.5.10`.

**Evidence:** design discussion names `@ai-hero/sandcastle@0.5.10` as the spike version (`.pHive/epics/sandcastle-adoption-followon/docs/design-discussion.md:96`). Current npm metadata checked during this review returns `0.5.10`.

**Required behavior:** the Sandcastle execution mode or provider wrapper preflight should fail fast if the resolved package version is missing or below `0.5.10`, with an actionable message to install/update the dependency.

**Rationale:** this plan depends on 0.x APIs: provider factories, `branchStrategy`, `createWorktree()`, `wt.run()`, `wt.close()`, and lifecycle hooks. A 0.x package has no stable semver guarantee. A runtime/preflight check turns dependency drift into a clear setup error instead of a partial sandbox failure.

## Pass 4: Architectural concerns

### Existing escalations

Do not re-emit existing security or performance triggers. They are already present in `.pHive/cycle-state/sandcastle-adoption-followon.yaml`:

- `security:plan-audit` major, pre-exec, for auth mount and key-leak surface.
- `security:impl-audit` moderate, append, for auth/redaction/provider implementation.
- `performance:audit` minor, post-exec, for cold-start baseline.

### New concern: dependency contract drift

**Severity:** minor.

**Observed gap:** H/V plans mention an optional Sandcastle version check only as an architect re-validation flag (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:317-324`), not as acceptance behavior in S2/S3.

**Why it matters:** the execution mode relies on Sandcastle 0.x APIs verified against `0.5.10`. Without a preflight, an older local install can fail after auth, redaction, and provider setup have already run.

**Required correction:** add `@ai-hero/sandcastle >=0.5.10` to S2 provider wrapper acceptance or S3 execution-mode acceptance. Prefer both a package/dependency pin and runtime/preflight error.

### Non-concern: backend-dispatch separation

**Observed contract:** `skills/hive/skills/backend-dispatch/SKILL.md:32-40` resolves model provider backend `claude | codex`; `skills/hive/skills/backend-dispatch/SKILL.md:42-53` delegates Codex dispatch to `codex-invoke`.

**Judgment:** the H/V plans correctly avoid adding Sandcastle to backend resolution. Sandcastle remains an execution mode selected before backend dispatch.

### Non-concern: sidecar-neutral V1

**Observed contract:** user decisions state Sandcastle V1 neither consumes nor produces sidecar bundles and uses `field_sources.execution_mode` as the forward-compat seam (`.pHive/epics/sandcastle-adoption-followon/docs/user-decisions-b1.md:41-49`).

**Judgment:** this is feasible. Do not add a sidecar horizontal layer or dependency on Epic A W5.

### Non-concern: doc sequencing

**Observed contract:** S5 depends on S4 and docs trail shipped behavior (`.pHive/epics/sandcastle-adoption-followon/docs/vertical-plan.md:194-206`).

**Judgment:** correct. This prevents docs from locking speculative provider or merge behavior.

## Open items remaining

- S1 story spec must name the exact default `.gitignore` template path that receives `.sandcastle/`.
- H2 story spec must choose the exact wrapper module name under `hive/lib/`.
- S2/S3 story spec must add the Sandcastle version preflight: `@ai-hero/sandcastle >=0.5.10`.
- S4 story spec must define "small same-slice fix-forward" as bounded to validation-discovered defects across S1-S3 surfaces.

## Escalation Flags

- [minor] dependency:version-gate — Sandcastle is a 0.x runtime dependency and H/V plans do not yet require a preflight for the validated API contract; require `@ai-hero/sandcastle >=0.5.10` before Sandcastle mode runs.
