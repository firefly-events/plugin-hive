# TPM Sequencing Memo — Phase B2

**Epic:** `sandcastle-adoption-followon`
**Author:** TPM (Claude/Opus)
**Date:** 2026-05-12
**Inputs:** `design-discussion.md`, `research-brief.md`, `research-findings.md`, `user-decisions-b1.md`, `.pHive/cycle-state/sandcastle-adoption-followon.yaml`
**Output consumer:** technical-writer (next) — authors `horizontal-plan.md` + `vertical-plan.md` from this memo.

---

## Horizontal layers

Seven architectural layers participate in this epic. Cross-layer dependencies are explicit; circular references are absent.

### H1. Auth/setup layer
- **Surface:** new `/hive:sandbox-setup` skill (R-A, per Q3 user decision deferred to B2 — recommendation = dedicated setup skill, kept here as primary surface). Owns `auth.json` mount semantics, container image expectations, podman-rootless prerequisites.
- **Files (new):** `skills/hive/skills/sandbox-setup/SKILL.md`, supporting setup-checklist reference doc.
- **Files (touched):** none of the existing dispatch paths — this is a one-time per-project setup, NOT in the hot path.
- **Cross-layer deps:** none upstream. Provides a precondition signal that the Sandcastle execution-mode skill (H5) checks/expects.

### H2. Logging/redaction layer
- **Surface:** in-Hive stdout/stderr redaction wrapper around the Sandcastle file logger (per research-findings §5.3 / D.3); default `.gitignore` template gains `.sandcastle/` entry.
- **Files (new):** wrapper module under `hive/lib/` (location TBD by architect during story-spec phase) covering `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `*_TOKEN`, `*_KEY` regex masks.
- **Files (touched):** project `.gitignore` template ships the `.sandcastle/` line; doc reference updates.
- **Cross-layer deps:** consumed by Sandcastle provider wrapping (H3) — the wrapper must wrap the logger BEFORE `SandboxProvider` instantiation, so H2 is ship-gated for H3 / H5.

### H3. Sandcastle provider wrapping layer
- **Surface:** module that wraps `createBindMountSandboxProvider` / `createIsolatedSandboxProvider` / built-in `podman()` factory with Hive defaults (`userns: false` for parallel macOS, `branchStrategy: { type: "branch", branch: <story-id> }`, podman default + docker opt-in).
- **Files (new):** provider wrapper module + tests.
- **Cross-layer deps:**
  - Consumes H2 (logger redaction wrapper must be in place).
  - Consumes H1 (mount expects `auth.json` already provisioned).
  - Consumed by H5 (execution mode skill instantiates via this wrapper).
  - Owns `wt.close()` for worktrees it creates (architect-flagged ownership rule; legacy `.claude/worktrees/{story-id}` retains its existing owner — story spec must declare which path is Sandcastle-owned).

### H4. Hooks layer
- **Surface:** wires exactly one hook point — `host.onWorktreeReady` — used to invoke `copyToWorktree` for persona files, memory dir paths, in-worktree config snapshot (per Q4 user decision). `host.onSandboxReady` and `sandbox.onSandboxReady` are deferred and NOT shipped in V1.
- **Files (touched):** provider wrapping module (H3) is where the single hook is declared; no new YAML template surface.
- **Cross-layer deps:** lives inside H3 module; surfaced through H5 SKILL prose; documented in H6 hooks-reference doc. NO standalone story for hooks wiring — it's part of the provider-wrapping slice.

### H5. Execution-mode routing layer
- **Surface:** new `execute-mode-sandcastle/SKILL.md` + `mode_decision` enum gains 5th value `sandcastle` (per Q1 user decision); `field_sources` extension gains `execution_mode` tracked field with env/config/default attribution + warning + telemetry; caller switch at `skills/execute/SKILL.md:143` adds the `sandcastle` case (hidden coupling).
- **Files (touched):**
  - NEW: `skills/hive/skills/execute-mode-sandcastle/SKILL.md`
  - MOD: `skills/hive/skills/execute-dispatch/SKILL.md` (enum + `field_sources`)
  - MOD: `skills/execute/SKILL.md` (line 143 switch case)
- **Cross-layer deps:** consumes H3 (instantiates wrapped provider). Live-quota merge validation (H5b) lives logically inside this layer but is a distinct story because it's net-new validation work that wasn't reached during the spike (OpenAI quota zero).
- **Sub-surface — merge-behavior validation (H5b):** end-to-end test that `branchStrategy: branch` + named-branch parallel runs reach the merge step with a live quota. Net-new vs the spike. Distinct story scope.

### H6. Documentation layer
- **Surface:** reference docs for sandbox setup, auth mount expectations, podman/docker provider defaults, branch strategy, hooks scope, and logging redaction. TPM-flagged as **likely 2 docs stories** given 5+ surfaces in one doc would over-stuff. Final split validated by writer against vertical-plan content volume.
- **Recommended split:**
  - **Doc story A — Adoption guide:** auth-setup walkthrough, podman/docker provider defaults, branch strategy semantics, logger-redaction rationale + `.sandcastle/` gitignore note.
  - **Doc story B — Hooks reference (minimal):** the one wired `host.onWorktreeReady` point + "Sandcastle hooks are lifecycle-only and additive, NOT Hive tool-hook replacement" framing + deferral rationale for the other two hook points.
- **Cross-layer deps:** trails all execution-touching layers (H1-H5); ship after they land so doc content matches code reality.

### H7. Defer-marker / upstream-watch layer
- **Surface:** explicit defer-marker story for upstream issue #191 (`claudeCode()` lane), per Q5 user decision.
  1. Create `.pHive/upstream-watch/sandcastle-191.md` with link, current behavior, unblock condition, owner.
  2. Add audit-script check (extend `hive/scripts/gate-mode-audit.mjs` pattern OR new lightweight script) that fails if any Hive code wires `claudeCode()` lane via Sandcastle while #191 is open.
  3. Project memory entry pointing at the watch file.
- **Cross-layer deps:** none — orthogonal to runtime path. Status-flip cleanup story authored only when upstream resolves; that cleanup is OUT of scope for this epic.

### Cross-layer dependency map (textual DAG)

```
H1 (auth/setup)        ──┐
H2 (logging/redaction) ──┼──> H3 (provider wrapping) ──> H5 (execution mode + routing)
                         │       (incl. H4 single hook inline)        │
                         │                                            ├──> H5b (merge-behavior live-quota)
                         │                                            │
                         └────────────────────────────────────────────┴──> H6 (docs ×2)

H7 (defer-marker)  — independent — ships any time, sequenced last per Tier-3
```

---

## Vertical slices

Seven slices, each producing a working state. Sequenced; tiered per user-confirmed ordering (Tier-1 ship-gated, Tier-2 core mode, Tier-3 follow-on).

### Slice S1 — Ship-gate prerequisites (auth + redaction + gitignore)

- **Goal:** Land the security/log-leak prerequisites and the `auth.json` plumbing so subsequent slices can wire the provider without security review re-litigation.
- **Working state after slice ships:** A maintainer can run `/hive:sandbox-setup` end-to-end; `auth.json` is mounted into a test container; logger redaction is verified against an injected fake `OPENAI_API_KEY`; `.gitignore` template carries `.sandcastle/`. No execution-mode story yet uses any of this — it's purely scaffolding, but inspectable.
- **Stories included:**
  - `codex-auth-setup-skill` — new `/hive:sandbox-setup` skill + auth.json mount semantics + minimal setup-checklist doc.
  - `logger-redaction-wrapper` — in-Hive stdout/stderr wrapper + redaction regexes.
  - `gitignore-template-update` — add `.sandcastle/` to default template; touch existing project `.gitignore` if applicable.
- **depends_on:** none.
- **Tier:** **Tier-1.**
- **Notes / cross-cutting:**
  - `security:plan-audit` (major, pre-exec) already raised — this slice IS the audit subject; sidecar reviewer runs first.
  - `security:impl-audit` (moderate, append) attaches per-story for auth-setup + redaction-wrapper.
  - Three small stories. Architect re-validates `wt.close()` ownership rule against post-PR-#62 worktree paths BEFORE this slice authors (open item routed from B1).

### Slice S2 — Sandcastle provider wrapping + minimal hooks

- **Goal:** Land the provider-wrapper module with Hive defaults (podman, `userns: false`, `branchStrategy: branch`) and the single `host.onWorktreeReady` hook for `copyToWorktree`. No mode routing yet.
- **Working state after slice ships:** A direct call (test harness, NOT user-facing) instantiates the wrapped provider, creates a worktree, runs a no-op command inside the sandbox, and tears down cleanly. Logger redaction is exercised in this path. Hook fires and copies a marker file into the worktree.
- **Stories included:**
  - `sandcastle-provider-wrapping` — wrapper module + defaults + `wt.close()` ownership declaration + the one `host.onWorktreeReady` hook wired inline.
- **depends_on:** S1.
- **Tier:** **Tier-2.**
- **Notes / cross-cutting:**
  - `security:impl-audit` attaches.
  - `performance:audit` (minor, post-exec) starts here — capture cold-start baseline for future warm-pool decision.
  - Hooks layer (H4) ships inside this story; no standalone hooks-wiring story exists in V1.

### Slice S3 — Execution-mode SKILL + dispatch routing

- **Goal:** Plug the wrapped provider into the dispatcher via a new `execute-mode-sandcastle/SKILL.md`; extend `mode_decision` enum + `field_sources`; add the caller switch case.
- **Working state after slice ships:** A user can set `HIVE_EXECUTION_MODE=sandcastle` (or `execution.mode: sandcastle` in root config) and `/execute` routes through the Sandcastle path. Telemetry shows the mode attribution; warnings fire on misconfig. Existing `team-cmux` and `session` users see zero behavior change.
- **Stories included:**
  - `execution-mode-skill` — new `execute-mode-sandcastle/SKILL.md` body.
  - `mode-routing-integration` — `execute-dispatch/SKILL.md` enum + `field_sources` extension + `skills/execute/SKILL.md:143` switch case.
- **depends_on:** S2.
- **Tier:** **Tier-2.**
- **Notes / cross-cutting:**
  - These two are tightly coupled but split because one is SKILL-prose authoring (writer-heavy) and the other is dispatch-mechanics + telemetry-attribution code (developer-heavy). Splitting reduces single-story blast radius and lets the routing change ship with isolated tests.
  - Hidden-coupling warning: writer/architect must call out the `skills/execute/SKILL.md:143` change in the routing-integration story's acceptance criteria — easy to miss.
  - `performance:audit` attaches.

### Slice S4 — Merge-behavior live-quota validation

- **Goal:** Run the end-to-end validation the spike couldn't (OpenAI quota was zero): two parallel stories on named branches both reach merge, no race, no double-worktree-ownership bug.
- **Working state after slice ships:** Documented validation run + result table; Sandcastle mode is operationally verified, not just architecturally wired.
- **Stories included:**
  - `merge-behavior-validation` — live-quota run + recorded findings + any small fix-forward stories that fall out get appended to this slice or queued.
- **depends_on:** S3.
- **Tier:** **Tier-2.**
- **Notes / cross-cutting:**
  - `performance:audit` (minor, post-exec) attaches — this is the slice where the perf signal becomes concrete.
  - If the live run uncovers a defect, story spec MUST permit a same-slice fix-forward; do NOT force a separate Tier follow-on for a small fix.

### Slice S5 — Documentation (Adoption guide + Hooks reference)

- **Goal:** Reference docs catch up with the shipped code.
- **Working state after slice ships:** Two docs land in `hive/references/` (or equivalent canonical doc location); user can read end-to-end how to adopt Sandcastle mode, configure podman, understand `auth.json` semantics, and grok the minimal hooks contract.
- **Stories included:**
  - `docs-adoption-guide` — auth-setup walkthrough + provider defaults + branch strategy + redaction rationale + `.sandcastle/` gitignore note.
  - `docs-hooks-reference-minimal` — the single hook point + deferral rationale + Sandcastle hooks ≠ Hive tool-hook framing.
- **depends_on:** S4 (writer can verify against operational reality, not architectural intent).
- **Tier:** **Tier-3.**
- **Notes / cross-cutting:**
  - Writer re-validates 2-stories-vs-1 split when authoring `vertical-plan.md` based on content volume; if Adoption guide stays under 200 lines and Hooks reference under 80 lines, hold the 2-story split (better review granularity).
  - Hooks reference doc covers ONLY the wired hook + framing — does NOT speculatively document the deferred hook points.

### Slice S6 — #191 defer-marker

- **Goal:** Make the `claudeCode()` lane block enforceable, not aspirational.
- **Working state after slice ships:** `.pHive/upstream-watch/sandcastle-191.md` exists; audit-script check is wired into CI/local gate; project memory entry points at the watch file.
- **Stories included:**
  - `sandcastle-191-defer-marker` — watch file + audit-script gate + memory entry.
- **depends_on:** none (independent of S1-S5). Can ship any time after S1 cleared security audit; sequenced last in Tier-3 because it's lowest priority + standalone.
- **Tier:** **Tier-3.**
- **Notes / cross-cutting:**
  - When upstream resolves, a separate cleanup story (NOT in this epic) removes the audit gate and archives the watch file. Story spec must explicitly call out that follow-on out-of-scope.

### Slice S7 — Warm-pool placeholder (informational only)

- **Goal:** Capture the `createSandbox()` long-lived warm-pool option as a parked optimization, with the cold-start baseline (from S2/S4 perf audit) as the future trigger threshold.
- **Working state after slice ships:** A short architecture note (1 file, ~50 lines) lives next to provider docs explaining when/why a future story would adopt the warm-pool primitive. NO code change.
- **Stories included:**
  - `warm-pool-placeholder` — single doc-only story; references performance baseline from S4.
- **depends_on:** S4 (needs the perf baseline).
- **Tier:** **Tier-3.**
- **Notes / cross-cutting:**
  - This is intentionally NOT a code story. If the writer feels it should be folded into Doc story A (S5) instead of standing alone, that's an acceptable refactor — flag to TPM during outline.

### Slice summary table

| Slice | Tier | Stories | depends_on |
|---|---|---|---|
| S1 — Ship-gate prereqs | 1 | 3 (auth-setup, redaction-wrapper, gitignore-template) | — |
| S2 — Provider wrapping + minimal hooks | 2 | 1 (provider-wrapping) | S1 |
| S3 — Execution-mode SKILL + dispatch routing | 2 | 2 (execution-mode-skill, mode-routing-integration) | S2 |
| S4 — Merge-behavior live-quota validation | 2 | 1 (merge-behavior-validation) | S3 |
| S5 — Documentation (2 docs) | 3 | 2 (docs-adoption-guide, docs-hooks-reference-minimal) | S4 |
| S6 — #191 defer-marker | 3 | 1 (sandcastle-191-defer-marker) | — (indep.) |
| S7 — Warm-pool placeholder | 3 | 1 (warm-pool-placeholder) | S4 |

**Total slices: 7. Total stories: 11. Tier-1 stories: 3.**

---

## Sidecar bundle treatment (Q6)

**Confirmed NEUTRAL — no consume / no produce in V1.**

- **No horizontal layer for sidecar bundle exists in this epic.** Epic A W5 sidecar work is still consolidating; binding Sandcastle to a moving contract would force re-cuts.
- **No vertical slice depends on Epic A W5 landing.** S1-S7 are all sidecar-independent.
- **Forward-compat seam (contract-only, zero code now):** `field_sources` extension in S3 keeps `execution_mode` cleanly attributable. A post-Epic-A-W5 follow-on can add `sidecar_bundle_path` as a separate tracked field without re-touching `execute-mode-sandcastle/SKILL.md`. Architect-confirmed `field_sources` is extension-friendly.
- **Logger redaction wrapper (S1) is local to the mode** — does NOT flow into the sidecar bundle stream. If sidecar bundles later need redaction-tagged spans, that's a sidecar-side feature, not a Sandcastle obligation. Writer should note this once in the Adoption guide doc to head off confusion.
- **Re-evaluation tag:** lives in `.pHive/cycle-state/sandcastle-adoption-followon.yaml` (or audit log), NOT in this epic's story set.

---

## Placement (Q7)

**Confirmed post-2.0 placement implications:**

- Branch: `feat/sandcastle-adoption-followon` lives on top of `dev/hive-2.0` integration branch.
- Sequence: Epic A (catalog + borrows), Epic B (structural refactor + gate-lift, MERGED via PR #62), Epic C (Adapter ABI) ship to `dev/hive-2.0` first; this epic merges to `dev/hive-2.0` AFTER they do.
- Rebase posture: branch stays alive on top of `dev/hive-2.0`; rebases as Epic A / C land. No fold-in pressure.
- Soft Epic C synergy: if `branchStrategy.branch` gets wired into Adapter ABI as a tracked surface, that's a follow-on adapter story authored on-demand against Epic C — NOT coupled into this epic. Sandcastle stays mode-layer; Epic C stays adapter-layer.
- Story-level implication: writer can author all 11 stories now while research is fresh; landing them serially after 2.0 ships is fine. Tier-1 (S1) is the first concrete merge target after the gate clears.

---

## Open items for writer

The technical-writer should amplify the following in `horizontal-plan.md` / `vertical-plan.md`:

1. **Mode enum lock.** `mode_decision` = 5th value `sandcastle` (architect-corrected — existing 4 are `sessions | team | team-cmux | sequential`). Writer must reference `skills/hive/skills/execute-dispatch/SKILL.md:16` as the canonical source.
2. **Hidden coupling at `skills/execute/SKILL.md:143`.** Routing-integration story acceptance criteria must call this out explicitly. Easy to miss; one-line change but real blast radius if forgotten.
3. **`field_sources` extension is the forward-compat seam for sidecar.** Writer should note in horizontal-plan that `execution_mode` is the first tracked-field extension; future `sidecar_bundle_path` field follows the same pattern.
4. **`wt.close()` ownership rule.** Sandcastle owns `wt.close()` for worktrees it creates. Legacy `.claude/worktrees/{story-id}` retains its owner. The `execute-mode-sandcastle/SKILL.md` body must declare this explicitly. Architect re-validates this rule against post-PR-#62 worktree paths BEFORE story-spec authoring (B1 open item).
5. **Hooks framing.** Sandcastle hooks are container-lifecycle, NOT Hive tool-hook replacement. The Hooks reference doc must lead with this framing — readers expecting PreToolUse-style hooks will misread.
6. **Logger redaction is a ship gate, not cleanup.** Writer should NOT soften this. It's pre-exec security audit material; S1 cannot ship without it.
7. **2-docs-vs-1 split validation.** Writer owns the final call in `vertical-plan.md` based on content volume. Default to 2 stories unless Adoption guide drops below ~120 lines + Hooks reference below ~50 lines, in which case fold to 1.
8. **Warm-pool placeholder folding.** Writer's call whether to fold S7 (warm-pool-placeholder) into Adoption guide (S5) or keep standalone. TPM default is standalone for review granularity; if folding cleaner, fold and shrink story count to 10.
9. **Sandcastle hooks ≠ PreToolUse note in Adoption guide.** Adoption guide should carry a one-paragraph "what these hooks ARE NOT" note next to the hooks section so the Hooks reference doc framing isn't the only place that lands.
10. **Defer-marker scope clarity.** S6 story spec must say cleanup-when-upstream-resolves is OUT of scope (separate future story); writer should make the boundary explicit so a future planner doesn't accidentally fold the cleanup into this epic.

---

## Story count refinement

**Previous estimate:** 8-10 stories (TPM revised from initial 6-8; conflations resolved: auth-setup vs execution-mode SKILLs distinct, live-quota merge validation net-new, ref-docs likely 2 stories).

**Current estimate:** **11 stories across 7 slices.**

Breakdown:
- Tier-1: 3 stories (auth-setup skill, redaction wrapper, gitignore template).
- Tier-2: 4 stories (provider wrapping, execution-mode skill, mode-routing integration, merge-behavior validation).
- Tier-3: 4 stories (docs-adoption-guide, docs-hooks-reference, defer-marker, warm-pool-placeholder).

**Range delta:** 9-11 → **11**, at the top of the prior range. Drivers of the +2 from initial 8-10 floor:
- Auth-setup and execution-mode SKILLs split confirmed (de-conflated): +1 vs initial.
- Mode-routing-integration extracted from execution-mode SKILL (hidden coupling + telemetry-attribution work substantial enough to merit isolation): +1 vs initial.
- #191 defer-marker added as explicit Tier-3 story per Q5: +1 vs initial.
- Warm-pool placeholder added as Tier-3 doc-only story: +1 (may fold to 10 if writer collapses into Adoption guide).
- Docs confirmed at 2 stories: matches prior 8-10 ceiling.

**Floor risk:** writer may legitimately fold warm-pool-placeholder into docs-adoption-guide (S5 ←  S7), reducing total to 10. This is acceptable; TPM defers to writer judgment based on content volume in `vertical-plan.md`.

**Ceiling risk:** if S4 (merge-behavior-validation) live run uncovers a defect requiring a distinct fix-forward story rather than a same-slice fix, total could grow to 12. Story spec for S4 should permit same-slice fix-forward to keep this contained.

---

*End of memo. Writer takes over for `horizontal-plan.md` + `vertical-plan.md` authoring.*
