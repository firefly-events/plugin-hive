# H/V collab review record — substrate-coverage-and-test-cleanup

**Phase:** B2 (H/V collab review)
**Run ID:** wf_c2824b18-0ab
**Generated:** 2026-06-05T12:30:00Z
**Reviewers:** researcher, architect (TPM = author, skipped; UI-designer N/A for hive)
**Inputs reviewed:** horizontal-plan.md (326 lines), vertical-plan.md (415 lines), plus design-discussion + research-brief cross-refs

Both reviewers returned `approve-with-escalation`. Findings are authoring-time guidance for Phase B3 structured outline + Phase C story authoring; H/V docs do NOT need revision.

---

## Researcher review

REVIEW: researcher
VERDICT: approve-with-escalation
COMMENTS:
  - H-plan L5 ABI claims accurate: `markNeedsRework` proposal correctly cites `hive/lib/task-tracking-dispatch/index.ts:205-282` (verified: invoke dispatch logic at lines 205-282) and `285-288` (verified: `capability(field)` reader). Multica `updateStory({status})` confirmed at line 335-348 (research-brief said 335-348, code shows 335-348 — exact match). GitHub `updateStatus({state})` with OPERATION_UNSUPPORTED confirmed at lines 291-309 with throw at 299-302 (matches brief).
  - H-plan L4 cc-workflows precedent claims trace cleanly: defensive args parse contract `const a = typeof args === 'string' ? JSON.parse(args) : args;` verified verbatim at `plan-mode-cc-workflows/SKILL.md:146`. "No Codex agentType" rule verified at line 144. Episode marker shape verified at lines 190-219. H-plan L4 mirroring claims are grounded.
  - H-plan L2 helper extraction citation accurate: `execute-dispatch/SKILL.md:46-101` Step 0 field-source-tracking resolver verified (lines 46-101 contain the 5-tier resolution with `field_sources` recording per field). 5-tier precedence `env > root config > shipped baseline > skill override > default` confirmed at line 50 and at lines 81-86 for `execution_runtime`. Brief and H-plan refs match.
  - V-plan Slice 2 TDD ordering correct: brief Section 8 lists `__resetHandleCache` + `__resetNoAdapterWarningForTests` at `task-tracking-dispatch/index.ts:92, 521` as test scaffolding — vertical plan correctly identifies this. Adapter contract-first then two implementations is well-grounded against brief Recommendation #1.
  - V-plan Slice 0 audit recovery has CONCRETE three-branch path (a) locate-and-copy, (b) re-run + fresh timestamp, (c) explicitly accept single-citation risk + write `audit-recovery-decision.md`. NOT a "find or rewrite" hand-wave — each branch has a verifiable artifact. Confirmed via brief Q4 + Risk #2 traceability.
  - L6 step-file vs persona discipline correctly preserved: H-plan §L6 explicitly notes `test-sentinel.md` is prose-only (no executable change) and emit lives in `step-06-triage.md` — matches brief Signal #2 grounding. Good catch from grill carry-forward.
  - One escalation flag: H-plan §L4 line 21 reads "lint asserting every atom imports it" but in §L6 wireframe handoff line 167 leaves Q9 default as "include constraint doc" — this contradicts brief Section 6 carry-forward question "Wireframe-artifact handoff payload (PNG + `.f0` only, or include constraint doc?)" which has not been operator-resolved in design-discussion. V-plan Slice 3 §"NOT YET" defers Q9 to story-writing-time default. This is technically grounded (defaulted-by-default rather than gated) but the operator should confirm the default-choice direction before `d-5` AC lands. Surface as escalation, not block.
  - Minor: H-plan §1 row L3 says "3 net-new Multica atoms" after self-correction, but the prior sentence ("4 multica atoms; only 3 are net-new because `test-mode-multica` is already shipped") leaves the rough-draft thinking inline. Reads slightly noisily for downstream consumers but is technically accurate — brief Section 2 confirms `test-mode-multica/SKILL.md:1-100+` exists at 415 lines. Cosmetic; not a grounding issue.
ESCALATION_FLAGS:
  - Q9 (wireframe handoff payload shape) defaulted in V-plan Slice 3 to "include constraint doc" without operator decision; brief Section 6 lists this as carry-forward; recommend operator confirms default before `d-5` AC authoring to avoid post-hoc rewrite

---

## Architect review

REVIEW: architect
VERDICT: approve-with-escalation
COMMENTS:
  - L2 mode-resolver boundary is clean: `{decision, sources}` return contract preserves field-source telemetry across all 6 dispatch sites; resolver name vars are declarative (HIVE_*_MODE) and contain no adapter knowledge. No dispatch site leaks adapter awareness upward — routers consume an opaque `mode_decision` and route to a path. Solid.
  - L4 cc-workflows-preconditions boundary is clean across all 4 atoms: `assertWorktreeIsolation()` is a precondition contract (throws if main checkout), not a runtime branching helper. Atoms call it at Step 0 and never re-check. The orchestrator's cwd is observed in the precondition itself, not surfaced to the mode-skill body — that's correct DRY.
  - L5 markNeedsRework ABI is symmetric from test-sentinel's perspective: both adapters land on `terminal-state + 'hive:needs-rework' label`. test-sentinel calls `markNeedsRework({id, reason})` and never branches on adapter. The `in_review` vs `reopen` asymmetry is contained inside the adapter and surfaces only through `capability('supports_needs_rework')`. Clean.
  - Slice 1 foundation: deliverable as ONE slice but with internal sub-sequencing risk. The back-fit of `cc-workflows-preconditions` into EXISTING `plan-mode-cc-workflows` + `execute-mode-cc-workflows` (vertical-plan line 83) is a same-slice modification that depends on the helper landing first within the slice. s-2 (mode-resolver extract) also touches `execute-dispatch` Step 0 — another co-evolution. Order within slice MUST be: (1) s-2 helper + execute-dispatch refactor, (2) s-4 helper + back-fit to existing 2 atoms, (3) s-3 lint. Each is a separate commit per the per-story commit rule, which preserves this naturally — but story authoring needs to lock the within-slice commit order explicitly.
  - Parallel-eligibility of Slices 2-5 after Slice 1 is sound from L2/L3/L4/L5 perspective. One hidden L6 cross-coupling worth flagging: `.pHive/cross-cutting-concerns.yaml` is touched by Slice 2 (t-1 retires simulated-manual entry at lines 99-126). If any other slice ALSO touches cross-cutting-concerns.yaml (none planned currently, but worth a story-authoring guard), parallel execution would conflict on that file. Current plan is safe — flag is preventative.
  - Slice 6 governance is genuinely build-AFTER: `dispatch-parity.md` is a 6×3 matrix that READS paths from L2/L3/L4 artifacts shipped in 1-5. No authoring effort lives upstream. The verification is "every cited path resolves" — pure summary work. Correctly sequenced last.
  - Slice 2 risk note in vertical-plan §5 is accurate: TDD-first on `markNeedsRework` adapter contract is mandatory because the non-symmetric backing state machines (Multica 5-state vs GitHub 2-state) cannot be silently bridged. The plan correctly puts contract test BEFORE both adapter implementations (vertical-plan line 122 ordering). Sound.
  - One architectural concern on Slice 3 d-1: the recommendation to keep as ONE story (Phase A structural insert + Pattern B toggle + 3-persona handoff payload) is defensible but creates a story with three orthogonal acceptance dimensions. The AC anchor citing `design-review.workflow.yaml:8-81` is good but doesn't constrain the toggle semantics. If story authoring lets d-1 grow past ~250 lines of AC, the "three-in-one" risk surfaces. Recommend story authoring add explicit toggle-behavior AC subsection separate from structural-insert AC subsection to keep verification orthogonal.
ESCALATION_FLAGS:
  - Slice 1 within-slice commit order must be locked at story-authoring time: s-2 (mode-resolver + execute-dispatch refactor) → s-4 (cc-workflows-preconditions + back-fit existing 2 atoms) → s-3 (lint). Reverse order causes lint to fail on missing imports OR helper extract to land post-hoc.
  - Slice 3 d-1 acceptance-criteria authoring should split into 3 named subsections (Phase A structural insert / Pattern B toggle semantics / 3-persona handoff payload) even while keeping a single story, to prevent the "three-in-one" verification drift flagged by collab-review.

---

## Carry-forward to Phase B3 + Phase C

1. **Q9 wireframe handoff payload** — operator decision pending; brief carry-forward. Default in V-plan = "include constraint doc". User confirmation needed before d-5 AC authoring.
2. **Slice 1 within-slice commit order LOCKED:** s-2 (mode-resolver + execute-dispatch refactor) → s-4 (cc-workflows-preconditions + back-fit existing 2 atoms) → s-3 (lint). Reverse order causes lint to fail on missing imports.
3. **Slice 3 d-1 AC split into 3 named subsections:** Phase A structural insert / Pattern B toggle semantics / 3-persona handoff payload. Single story, 3 verification dimensions.
