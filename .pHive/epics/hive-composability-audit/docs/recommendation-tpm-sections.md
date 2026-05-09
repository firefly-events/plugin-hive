# Recommendation — TPM Sections (1, 3, 4)

**Status:** TPM draft, pre-merge with architect Sections 2 + 5.
**Author:** TPM (audit-s4-synthesis team)
**Inputs cited:** s1 sandcastle findings (`spikes/sandcastle/findings.md`), s2 atoshell findings (`spikes/atoshell/findings.md`), s3 skills-lens (catalog-matrix / borrows-scope / sidecar-edits / posture-check), design-discussion (`epics/hive-composability-audit/docs/design-discussion.md`), cycle-state YAML.

---

## Section 1 — CWC 2026 A-group resume strategy

### Conclusion

**Verdict: PROCEED-AS-DESIGNED.**

Sandcastle adoption (Output.object, Output.string, runtime guards) lands **inside the S14/B1 rubric design**, not by altering A-group story scope. A-group resumes immediately on synthesis sign-off with zero scope delta and zero effort delta.

### Justification

s1's per-primitive decision table classified 4 distinct adoption lanes (`spikes/sandcastle/findings.md` §3 verdict + per-primitive table):

1. **Adopt now / in S14-B1 design:** `Output.object()` (#11), `Output.string()` (#12), runtime guards.
2. **Adopt in follow-on epic:** `SandboxProvider` (#7), `branchStrategy` (#8), `createWorktree` (#16), sandcastle hooks (#9, #10).
3. **Retain Hive:** `run()`, `interactive()`, `codex()` — Hive's TeamCreate + cmux + codex-companion are richer (persona + memory + skills).
4. **N/A — blocked or no backend:** `claudeCode()` (issue #191), `opencode()`, `pi()`, `resumeSession`, JSONL capture.

Crucially, lane 1 (the only "adopt now" lane) operates **inside** S14/B1 — the rubric format design — not by modifying any A-group story (S4–S10). s1 §4 CWC 2026 delta confirms this row-by-row:

| CWC story | Sandcastle delta | Effort delta |
|---|---|---|
| S4 / a1 — session-spec rewrite as Messages-API substrate | Untouched (sandcastle wraps CC CLI, not Messages API) | None |
| S5 / a2 — messages-session.js loop module | Untouched (no Messages-API surface in sandcastle) | None |
| S6 / a3 — prior_knowledge_block | Untouched (no memory/KG injection concept) | None |
| S7 / a6 — cc_session_id correlation | Untouched (sandcastle's JSONL capture is separate; Hive registry still owns correlation) | None |
| S8 / a4 — execution.substrate flag flip | Untouched (Hive-internal substrates; sandcastle is coarser layer) | None |
| S9 / a5 — cloud-mode dead-code gating + fixture rot guard | Untouched (internal Sessions-API) | None |
| S10 / a8 — chrome runtime guards | Untouched as A-group scope (sandcastle has no equivalent; runtime guards remain Hive-owned) | None |
| S14 / b1 — rubric / structured-output design | **Adopt Output.object as design option** (Standard Schema + XML tag scan) | Within design effort; not an A-group line item |

### Per-story impact

- **Replaced:** none.
- **Partially-replaced:** none in A-group. S14/B1 (B-group) gains `Output.object` as a design option to evaluate during its design phase — this is a B-group design decision, not an A-group story rewrite.
- **Untouched:** S4, S5, S6, S7, S8, S9, S10 (all of A-group).
- **Superseded:** none.

### Effort delta

Zero on A-group. S14/B1 design effort gains a new option (Output.object as rubric substrate) to weigh against existing alternatives — net effort change is "evaluate one more option during design" which is bounded and absorbed in B-group story estimation.

### Open questions (defer past sign-off)

1. If the sandcastle follow-on epic lands and adds `SandboxProvider` as a 3rd `execution.substrate`, S8's flag may grow a 3rd value. Out of A-group scope; flagged for follow-on planning.
2. Sandcastle session-JSONL capture coexisting with Hive's `~/.claude/projects/...` namespace if S7 ever wants to reuse that capture path. Speculation only; no S7 change today.

### Verdict (closing)

**PROCEED-AS-DESIGNED.** A-group resumes on sign-off. S14/B1 design phase will weigh `Output.object()` as a candidate rubric substrate. All sandcastle "adopt now" primitives manifest inside design phases that are already on the roadmap.

---

## Section 3 — `task_tracking.adapter` direction

### Conclusion

**Verdict: SKIP** (atoshell), with explicit reconsider triggers preserved and the adapter-ABI question deferred to its own follow-on epic.

### Justification

s2 verdict was SKIP per spec's allowed values — developer + tester convergence was `SKIP-FOR-NOW / RECONSIDER-ON-UPSTREAM-BASH-3.2-COMPAT-OR-HIERARCHY-FORK` (`spikes/atoshell/findings.md` verdict; cycle-state `s2_verdict: SKIP`). Three blockers from `cycle-state.s2_blockers_for_synthesis` materially raise the adoption bar:

1. **Hive has no executable `task_tracking.adapter` ABI today** — Linear and GitHub adapters are prose-runbooks. Adopting atoshell would require defining the ABI Hive doesn't yet have, so atoshell can't be plugged into "the" adapter slot — there is no slot.
2. **Atoshell scope is 30 files / ~210KB production bash**, not the "single bash file" framing in the original spike spec. Vendor-fork burden is materially higher than originally estimated.
3. **`noSandbox()` is `interactive()`-only per sandcastle 0.5.10 types** — original synergy test framing (atoshell-as-tracker behind sandcastle's noSandbox) was incorrect at the API level.

### Reconsider triggers (preserved)

Per s2 (`cycle-state.s2_reconsider_triggers`), adoption gets revisited if **either**:

- **Trigger A — bash 3.2 compatibility:** atoshell upstream rewrites the 11 bash-4+ syntax sites OR adds explicit bash-version detection. macOS default is bash 3.2; without this, vendor burden compounds.
- **Trigger B — hierarchy fork:** atoshell adds a `parent_id` field OR Hive accepts flatten-with-tags as canonical. Today the data models disagree; without one side flipping, integration cost is structural.

Either trigger flipping materially changes the adoption math. Both flipping makes adoption likely.

### Adapter ABI decision

s2 surfaced that **Hive has no executable `task_tracking.adapter` ABI** — Linear and GitHub adapters today are prose-runbooks consumed by humans, not pluggable code modules.

This is its own decision point, independent of atoshell. TPM recommendation:

- **Defer ABI definition to a follow-on epic.** Do not block this audit's sign-off on ABI work.
- **Accept current prose-runbook state for now.** Linear and GitHub adapters continue as prose-runbooks; no behavior change.
- **When ABI is defined** (in a future epic), atoshell becomes one of N candidate implementations evaluated against it — alongside any Linear/GitHub executable adapters built at that time.
- **Scoped explicitly out of this audit:** what the ABI looks like, what fields it requires, whether it ships as TS interface vs MCP vs CLI contract. Each of those is a design decision deserving of its own review gate.

### Open questions (defer past sign-off)

1. Does the future ABI epic depend on any KG-augmented meta-signal work or memory-autonomy merge? Likely no, but flag for next-epics dependency mapping.
2. If atoshell trigger A flips but trigger B does not (or vice versa), do we partial-adopt or wait for both? TPM view: wait for both; one-sided flip is not enough to justify vendor-fork overhead.

### Verdict (closing)

**SKIP** with reconsider triggers preserved and adapter-ABI deferred to a follow-on epic. No `task_tracking.adapter` change today; no atoshell vendor work today.

---

## Section 4 — Cross-tool synergy decisions (sandcastle ↔ atoshell stack)

### Conclusion

**Verdict: SKIP-SYNERGY** with explicit AND-gate for revisit.

### Justification

The originally-imagined synergy was: atoshell as task-tracker behind sandcastle's `noSandbox()`, branch naming integration via sandcastle `branchStrategy:branch` keyed off atoshell IDs, status sync on completion. s1 + s2 together demonstrate this synergy is **doubly-blocked today**:

1. **Sandcastle side (s1, HYBRID verdict):** the primitives that would carry the synergy — `SandboxProvider` (#7), `branchStrategy` (#8), `createWorktree` (#16), sandcastle hooks (#9, #10) — are all "adopt in follow-on epic" per s1's per-primitive table, gated on s1 §5 surprises being mitigated (rootless podman race, file-logger key leak, issue #191 subscription auth).
2. **Atoshell side (s2, SKIP verdict):** SKIP-FOR-NOW with two named reconsider triggers (bash 3.2 compat, hierarchy fork). Until at least one flips, atoshell is not a candidate.
3. **API-level correction:** `noSandbox()` is `interactive()`-only per sandcastle 0.5.10 types (`cycle-state.s2_blockers_for_synthesis[2]`). The original synergy framing was incorrect at the API level — the noSandbox path doesn't compose the way the spec assumed.

s2 §5.4 makes the sequencing explicit: "Until that [sandcastle follow-on] epic lands: branch naming integration is **gated**" (`spikes/atoshell/findings.md` §5.4). Per s2 the status-sync piece is "trivial-when-present" but waits on the same gate.

### Synergy AND-gate (revisit conditions)

Synergy is revisited if **and only if BOTH**:

- **(a) Sandcastle follow-on epic has landed** — `SandboxProvider` + `branchStrategy` + `createWorktree` are shipped in Hive, with s1 §5 surprises mitigated; **AND**
- **(b) At least one atoshell reconsider trigger has flipped** — bash 3.2 compat shipped upstream OR hierarchy fork resolved (parent_id added or flatten-with-tags canonicalized).

If only (a) holds: Hive has sandboxes but no compelling tracker integration to leverage them with. Synergy stays deferred.
If only (b) holds: atoshell becomes a candidate adapter (Section 3 reconsider), but with no Hive sandbox primitives to compose against, the "synergy" reduces to "use atoshell as one task tracker among others" — that is a Section 3 decision, not Section 4.

Both must hold for the synergy question (this section) to be reopened.

### North-Star alignment justification

Per `project_oss_rollout_brand` (locked 2026-04-30) and s3 posture-check §4.5: Hive's brand vision is *"a director's chair for the agentic SDLC — disciplined swarms, kickoff to ship."* The product trajectory is prompter → director → reviewer. Process-ownership IS the product, not incidental implementation.

A FULLY-LOCAL-STACK-ADOPT (sandcastle for substrate + atoshell for tracking) would flatten Hive into a vendor-orchestration shell — which is not the product. Even if both gates above flipped tomorrow, FULLY-LOCAL-STACK-ADOPT remains misaligned: the right shape is *Hive directs the agentic SDLC; sandcastle and atoshell are substrate-level primitives Hive can compose with where useful, not co-equal stacks the framework defers to.*

PARTIAL-ADOPT (sandcastle Output primitives now, sandbox primitives in follow-on, atoshell SKIP) is the brand-aligned path — and it is exactly what Sections 1 + 3 specify. Calling it "PARTIAL-ADOPT" at the synergy level would conflate substrate-primitive adoption (Section 1) with cross-tool stack adoption (Section 4). They are not the same decision.

Therefore Section 4 verdict — the *synergy* question — is **SKIP-SYNERGY**. Sandcastle Output primitives still adopt per Section 1; sandcastle sandbox primitives still get a follow-on epic per Section 1. The synergy *between* sandcastle and atoshell is what gets skipped.

### Open questions (defer past sign-off)

1. If/when the AND-gate flips, does synergy belong to a single epic or split (sandcastle follow-on + tracker integration as separate)? TPM view: split. Sandbox primitives are infra; tracker integration is workflow.
2. If atoshell upstream goes silent indefinitely, do we re-evaluate other trackers (Linear executable adapter, GitHub Issues adapter) as the synergy partner under the same gate? Likely yes; flag for next-epics planning.

### Verdict (closing)

**SKIP-SYNERGY.** Revisit only when both (a) sandcastle follow-on epic has landed AND (b) at least one atoshell reconsider trigger has flipped. Brand-level North-Star (director's-chair) constrains even a future "both flipped" outcome away from FULLY-LOCAL-STACK-ADOPT toward composable-primitive use.

---

## Hand-off to architect (Sections 2, 5)

- Section 2 (skill catalog reshape) — input is s3 catalog-matrix + posture-check §6.5 (9 stories sketch) + borrows-scope (Borrow 1 atomic shape per posture-check §5.1 is authoritative).
- Section 5 (North-Star alignment statement) — input is s3 posture-check §4.5 (brand vision citation) + `project_oss_rollout_brand` memory + README canonical text. Recommend verifying against `/Users/don/Documents/plugin-hive/README.md` per `feedback_check_readme_first`.

TPM stands by Section 1 PROCEED-AS-DESIGNED, Section 3 SKIP, Section 4 SKIP-SYNERGY through joint-merge unless architect's Sections 2 / 5 surface contradicting evidence.
