---
title: Architect outline stress-test review
author: architect (codex-backed)
date: 2026-04-20
epic: meta-improvement-system
phase: B3 collab review
inputs: structured-outline.md
---

# 1. Alarm-by-alarm verification (4 alarms + self-corruption)
## Alarm 1: Epic C / Epic B coupling
Status: preserved.
`S1` remains a real B0 gate before `S2` schema freeze, and that dependency is repeated in success criteria, phase dependencies, and the risk registry. This preserves the original consumer-contract-first alarm as an enforced serialization, not a note.
Evidence: `structured-outline.md:49-50`, `125-131`, `160-194`, `760-766`.

## Alarm 2: Dual-schema metrics carrier
Status: preserved.
The outline still uses one carrier under `.pHive/metrics/` with separate event and experiment schemas, separate docs, and separate primitive behavior. No slice drifts back toward one overloaded schema.
Evidence: `structured-outline.md:33-34`, `46-47`, `203-250`, `695-701`.

## Alarm 3: Experiment isolation asymmetry
Status: preserved.
The asymmetry is still real policy: `meta-meta-optimize` is local-only, worktree-default, direct-commit; `meta-optimize` is shipped, user-project facing, PR-only.
Evidence: `structured-outline.md:31-33`, `51-52`, `530-577`, `580-685`.
Residual weakness: Part 7 recognizes direct-commit vs PR evidence-shape asymmetry for close records, but Part 6 does not register it as a tracked risk.

## Alarm 4: Unified baseline + rollback envelope
Status: mostly preserved.
Baseline, compare, close, and rollback still live in one lifecycle object. `rollback_ref` remains mandatory, the close gate still depends on the same artifact family, and rollback-watch stays inside the shared lifecycle library rather than splitting into a separate subsystem.
Evidence: `structured-outline.md:48-50`, `188-189`, `474-516`, `615-618`.
Remaining pressure point: `S9` still needs tighter wording so the real revert is proven as a lifecycle/watch-triggered rollback, not just “some real revert happened.”

## Alarm 5: Self-corruption risk
Status: preserved.
The outline still treats `meta-meta-optimize` as the highest-integrity-risk surface and keeps the right mitigations attached to it: worktrees, non-bypassable close, trivial proving target, and artifact-backed rollback proof.
Evidence: `structured-outline.md:71`, `584`, `763`.

Conclusion: the original four alarms survive, and self-corruption also survives as a first-class risk. The main weakening is `S9` rollback-trigger realism, not overall slice structure.

# 2. S9 BL2.6 rollback-realism check
Verdict: flagged.
The outline is much stronger than the prior H/V state, but `BL2.6` still admits a weak reading.
What it already gets right:
- real committed experiment, not fixture-only
- real revert, not mock
- observable artifacts
- MVL explicitly tied to this proof
Evidence: `structured-outline.md:71`, `591-593`, `615-618`.
What is still ambiguous:
- The text does not explicitly require the rollback-watch path to detect a regression and trigger the auto-revert end-to-end.
- A weak implementation could still pass by committing a trivial change, manually invoking a revert during the observation window, and producing real artifacts, while never proving the watch-trigger chain.
Why that matters:
- Q3 locked delayed-regression behavior to unconditional auto-revert.
- The architectural risk was not “can git revert run?” It was “can regression-watch produce a real rollback through the same lifecycle object that justified promotion?”
Conclusion: `S9` is close, but not airtight. Treat this as a major pre-exec clarification for `BL2.4-BL2.6`.

# 3. File manifest gaps
Verdict: flagged, moderate.
The outline is generally strong, but it still leaves several implementation-critical files vague or omitted even where the repo already identifies the owner surfaces.

## Gap A: Stop-hook ownership is already known
The repo already shows the current Stop hook in `.claude-plugin/plugin.json`, but `S5` still says “potentially `.claude-plugin/plugin.json` or adjacent hook/config files,” “existing Stop hook path or wrapper mechanism,” and “existing agent-spawn, PostToolUse, or session-end handlers.”
Refs: `structured-outline.md:393-396`, `882-906`.
Architectural read:
- `.claude-plugin/plugin.json` should be explicit, not “potential.”
- If Part 8’s dispatcher recommendation stands, a concrete wrapper/dispatcher file under `hooks/` should be named as an expected create/modify target.

## Gap B: Kickoff manifest is too broad
The repo currently exposes `skills/kickoff/SKILL.md`, which points to `hive/references/kickoff-protocol.md`. `S6` only says “Modify `skills/kickoff/` assets...”
Ref: `structured-outline.md:441-446`.
Likely missing explicit files:
- `skills/kickoff/SKILL.md`
- `hive/references/kickoff-protocol.md`

## Gap C: Boot / analysis / backlog-fallback step ownership is under-named
Upstream planning named `step-01-boot.md`, `step-02-analysis.md`, and `step-03b-backlog-fallback.md`. The outline names only steps `04-08` in `S4`, then refers more vaguely to baseline capture at step 01 and helper logic for step-03b later.
Refs: `structured-outline.md:326-340`, `546-551`, `597-600`.
Why it matters: these are not incidental files; they own baseline-read and backlog-branch semantics.

## Gap D: S9 proof-artifact location remains unresolved too late
`S9` requires a durable verification doc, but the destination is still left open.
Refs: `structured-outline.md:601`, `720`.

## Gap E: Execution-split config touchpoint is left optional
`hive/hive.config.yaml` already carries the signed execution split. Treating this as optional in `S4` is fine only if Phase C explicitly treats it as already satisfied; otherwise the outline should say “verify, not modify.”
Ref: `structured-outline.md:340`.

# 4. Risk registry audit
Verdict: mostly complete, with one missing registered risk.
Preserved memo risks:
- self-corruption -> `R1`
- schema freeze before consumer contract -> `R2`
- parallel attribution ambiguity -> `R4`
- shared-policy asymmetry collapse -> `R5`
- performative rollback -> `R6`
Preserved DD / H-plan / punt-list risks:
- token metric feasibility -> `R3`
- Stop-hook conflict -> `R8`
- brownfield metrics confusion -> `R9`
- state-dir punt pressure -> `R10`
- scheduler-boundary drift -> `R11`
- historical `commit: TBD` integrity -> `R12`
- accidental maintainer-skill bundling -> `R13`
- backlog auto-surfacing creep -> `R14`
- documentation drift -> `R15`
- unknown-dimension validation weakness -> `R16`
- thin S9 proof doc -> `R17`
- `github_forwarding` migration drop -> `R18`

Missing risk: closure-validator evidence-shape mismatch across the two promotion adapters.
Why it is real:
- Part 7 Q6 already surfaces it (`structured-outline.md:804-808`).
- `S9` proves direct-commit close evidence.
- `S10` requires PR-based close evidence.
- The shared validator can easily overfit one evidence shape and reject the other.
Current state: elicited in Part 7; not tracked in Part 6.
Novel outline-surfaced risk: Stop-hook ownership is acknowledged as a gap, but mitigation remains under-concretized for a high-blast-radius slice.

# 5. Elicitation quality review
Verdict: solid overall, but not complete.
Strong answers: Q2 worktree leak, Q4 stop-hook conflict, Q5 archive/reset vs stale consumers, Q8 accidental bundling, Q10 `commit: TBD` preservation, Q11 unknown-dimension tolerance boundary.
Weak or hand-wavy answers:
- Q1 (`structured-outline.md:784-786`) hand-waves the exact boundary where missing metrics evidence becomes close-blocking by slice.
- Q6 (`structured-outline.md:804-808`) is a real architecture seam, not just a hypothetical; it should be a registered risk.
- Q12 (`structured-outline.md:828-830`) correctly flags Stop-hook discovery but misses a second likely regret: under-named ownership for step-01 baseline capture and step-03b backlog-fallback.
Question the outline should also have asked: what happens if `S9` direct-commit proof assumptions leak into `S10` and the shared close validator rejects valid PR-only evidence objects?

# 6. Execution-split coherence
Verdict: coherent.
The outline consistently applies the signed split: Codex for implementation, scaffolding, testing, and proving runs; Claude Opus for reviewer and peer-validator gates.
Evidence: `structured-outline.md:140-143`, `178-182`, `229-231`, `344-348`, `403-406`, `451-453`, `504-507`, `555-559`, `608-611`, `661-665`.
Nuance: the `S4` config touchpoint is coherent only if Phase C treats current backend mapping as already satisfied or explicitly verifies it.

# 7. Stop-hook decision dissent (or concurrence)
Verdict: concur.
Architecturally, Part 8’s recommendation is the right call: use a combined Stop-hook dispatcher rather than invent a second “run end” surface.
Why:
- story-end wall-clock and token totals belong at the same authoritative boundary as the interrupt sentinel
- a separate mechanism creates split-brain end semantics that later slices must correlate manually
- the repo already has a single obvious owner surface today: `.claude-plugin/plugin.json`
Caveat: this concurrence depends on true handler isolation. Sentinel behavior must remain non-optional, and metrics failure must not suppress it.
The weakness here is not the recommendation. It is the outline’s file-manifest precision around the dispatcher implementation.

# 8. Story-shape drift
Verdict: minor-to-moderate drift present.
- The outline under-names `step-01-boot.md`, `step-02-analysis.md`, and `step-03b-backlog-fallback.md` relative to upstream plan expectations.
- L11 language has drifted from singular “meta-backlog substrate” to split queue files. That is acceptable if treated as “or equivalent,” but Phase C should keep the operator vocabulary coherent.
- `S9` claims a very strong MVL proof while leaving proof-artifact location and rollback-trigger wording looser than the milestone language implies.

# 9. Overall verdict
Verdict: approve-with-escalation.
The outline is architecturally sound enough to move into Phase C. It preserves the original alarms, keeps signed decisions intact, respects the execution split, and makes the right stop-hook call.
The escalation is narrow:
- `S9` rollback realism still allows a weak reading
- the manifest is not fully concrete where the repo already names the owner files
- one real cross-adapter closure risk is elicited but not registered

# 10. Flagged items (with line refs)
- `S9` rollback realism is still ambiguous: the outline requires a real revert, but not explicitly a regression-watch-triggered auto-revert end-to-end. Refs: `structured-outline.md:591-593`, `615-618`.
- `S5` keeps Stop-hook ownership too vague even though the repo already shows the current owner in `.claude-plugin/plugin.json`. Refs: `structured-outline.md:393-396`, `882-906`.
- `S6` kickoff manifest is too broad; likely owner files are `skills/kickoff/SKILL.md` and `hive/references/kickoff-protocol.md`. Ref: `structured-outline.md:441-446`.
- `S4/S8/S9` under-name step-01, step-02, and step-03b surfaces. Refs: `structured-outline.md:326-340`, `546-551`, `597-600`.
- `S9` leaves the verification-doc destination open too late for an MVL proof artifact. Refs: `structured-outline.md:601`, `720`.
- Part 6 is missing a risk entry for direct-commit vs PR-only close-evidence mismatch, even though Part 7 Q6 already surfaces it. Refs: `structured-outline.md:757-780`, `804-808`.
