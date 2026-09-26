---
name: verify
description: Repository-contract evidence procedure — turns acceptance criteria, fallback claims, and command/test results into claim-by-claim evidence. Authoritative procedure bound to hive/agents/reviewer.md; owns the verify evidence contract, never the review verdict.
---

# Hive Verify

**Authoritative repository-contract evidence procedure, NOT inline persona prose.** This skill is bound to `hive/agents/reviewer.md`'s `skills:` frontmatter entry with a distinct `use-when` from the code-review binding, and governs how verification evidence is produced once that binding is resolved and loaded — see `hive/lib/skill_binding.py::resolve_skill_binding`. It owns the repository-contract evidence output: one evidence result per acceptance criterion, plus explicit fallback and command/test evidence, each with an artifact reference. It does NOT own `change_verdict` or `review.yaml` — see "What this skill is NOT".

**Input:** `$ARGUMENTS` contains the acceptance criteria, the diff, any fallback claims, and command/test results the caller already gathered — the same evidence bundle the reviewer node passes before it runs the unchanged `skills/review/SKILL.md` Process.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

If the kickoff checks pass, proceed silently.

## Process

1. **Enumerate claims.** Build one claim per acceptance criterion, plus one claim per fallback assertion and one claim per command/test result supplied in `$ARGUMENTS`. Do not merge claims — each keeps its own identity through evidence production.
2. **Locate evidence for each claim.** For an acceptance-criterion claim, search the diff for the file(s) and line(s) that implement it, or the test that asserts it. For a fallback claim, locate the fallback path in the diff or the referenced fallback-evidence file. For a command/test claim, use the actual command/test result supplied — do not re-run or infer it.
3. **Classify each claim's evidence status.** Exactly three states — no partial credit:
   - **`supported`** — evidence found; cite the exact `file:line` or command/test output that backs the claim.
   - **`failed`** — evidence found but it contradicts the claim (e.g. the cited test fails, or the diff does the opposite of the claim).
   - **`absent`** — no evidence located. Absent evidence is explicit and MUST NOT be interpreted as a pass; it is not `supported` by default and it is not silently dropped.
4. **Attach an artifact reference to every claim.** Each evidence result cites the artifact it was drawn from — a `file:line`, a command/test output path, or the fallback-evidence file — so a caller can re-derive the evidence without re-deriving reasoning.
5. **Produce the Verify Evidence Report** in the exact shape below:

   ```markdown
   ## Verify Evidence

   ### Acceptance Criteria
   - **[supported|failed|absent]** AC-{n}: {criterion text}
     Artifact: `path/to/file.ts:42` (or command/test reference)

   ### Fallback Claims
   - **[supported|failed|absent]** {fallback claim text}
     Artifact: `path/to/file.ts:42` (or fallback-evidence file)

   ### Command/Test Results
   - **[supported|failed|absent]** {command or test name}
     Artifact: {command/test output reference}

   ## Summary
   {count} supported, {count} failed, {count} absent — evidence only, no verdict.
   ```

6. **Emit the skill-owned invocation marker.** Wherever the calling seam records step outputs (a step-file/episode marker for the reviewer node, or the DAG `AgentHandler`'s `config.skill_binding` opt-in), the marker is `skill_invoked: skills/verify/SKILL.md` — durable evidence that this skill, not residual persona prose, governed the run. A caller that spawns `hive/agents/reviewer.md` for verification without resolving and loading this binding has an inert binding, not working verify evidence; that caller fails closed per `hive/lib/skill_binding.py::SkillBindingError` rather than falling back to inline persona procedure or treating missing evidence as a pass.
7. **Hand the evidence to code review.** Pass the Verify Evidence Report to the caller's `skills/review/SKILL.md` invocation as supporting input. This skill's Process ends here — it does not compute or emit `change_verdict`, and it does not write `review.yaml`.

## What this skill is NOT

- **Not reviewer evaluation.** `skills/review/SKILL.md` remains the sole procedure that computes `change_verdict` and owns `review.yaml`. This skill produces claim-by-claim evidence that review *consumes*, never a competing or replacement verdict.
- **Not peer-validator cross-story validation.** Cross-story validation is a separate contract with its own artifacts; this skill's evidence is scoped to one story's acceptance criteria, fallback claims, and command/test results.
- **Not the orchestrator's Submit→Validate→Verify handshake.** That handshake step is orchestrator-owned lifecycle plumbing; this skill is a reviewer-bound evidence procedure invoked inside the review step, not the handshake's Verify stage.
- **Not the reviewer persona.** `hive/agents/reviewer.md` supplies identity, the review rubric, and output-format contracts. This skill is a distinct, narrowly-bound procedure — it is not a substitute for `skills/review/SKILL.md` and must not be spawned in its place.

## Atomic-skill invariants

- **Top-level skill** at `skills/verify/SKILL.md` (auto-discovered), within the 800-line skill-size cap.
- **Single binding target** — bound to `hive/agents/reviewer.md` via a `use-when` distinct from the code-review binding.
- **Evidence-only output** — `supported | failed | absent` per claim. No verdict vocabulary; cannot emit `change_verdict` and does not write `review.yaml`.
- **Fail-closed** — a missing binding or unreadable skill file raises `SkillBindingError` at the calling seam; there is no persona-only fallback, and missing evidence is never interpreted as a pass.
- **Stateless across invocations** — each verify run produces one Verify Evidence Report; no incremental state carried between runs.

## Hand-off

1. A caller (the reviewer node in `hive/workflows/step-files/review/reviewer.md`) resolves `hive.lib.skill_binding.resolve_skill_binding("hive/agents/reviewer.md", "<matching use-when trigger>")` for the verify binding before running the unchanged review Process.
2. This skill's Process governs the run and produces the Verify Evidence Report plus the `skill_invoked` marker.
3. The caller feeds the Verify Evidence Report into `skills/review/SKILL.md` as supporting input. Review consumes the evidence claim-by-claim but remains the sole owner of `change_verdict` and `review.yaml`.
4. This skill ends at step 2. Verdict computation, aggregation, and status projection remain review's remit, not this skill's.

## Out of scope

- Computing or emitting `change_verdict`, or writing `review.yaml` — that stays `skills/review/SKILL.md`'s exclusive remit.
- Peer-validator cross-story validation — a separate contract with its own artifacts.
- The orchestrator's Submit→Validate→Verify handshake — separate lifecycle plumbing.
- Advisor behavior, candidate backlog, verdict vocabulary, or catalog entries — out of scope for this slice.
- Catalog `skill:` dispatch or trigger-ID-specific routing — routing stays on `placement` + `responds_with.type`.

## See also

- [`hive/agents/reviewer.md`](../../hive/agents/reviewer.md) — bound persona and verify-evidence consumer
- [`skills/review/SKILL.md`](../review/SKILL.md) — sole owner and consumer of the code-review verdict; verify evidence is supporting input only
- [`hive/workflows/step-files/review/reviewer.md`](../../hive/workflows/step-files/review/reviewer.md) — DAG review node that resolves both bindings and feeds verify evidence to review
- [`hive/lib/skill_binding.py`](../../hive/lib/skill_binding.py) — the shared match-resolve-load-invoke resolver
- [`skills/write-skill/template.md`](../write-skill/template.md) — canonical full SKILL.md format this file follows
