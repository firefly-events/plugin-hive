---
name: find-skills
description: Surface candidate skills mined from project signals — rank by occurrence × recency × distinctness, write `.pHive/meta/skill-candidates.yaml`, and (on operator accept) hand off to `/write-skill`. Discovery-only; does NOT author or run skills.
---

# Hive Find-Skills

Surface recurring patterns in this project's signals (metric events, KG triples, commits, cycle-state escalations) as candidate skills the operator might want to author. The skill calls into the se-4 mining helper for observations, ranks them with a deterministic formula, filters out noise, writes a candidate yaml to `.pHive/meta/skill-candidates.yaml`, and offers a one-click hand-off to `/write-skill`. Discovery is the entire job — authoring stays with `/write-skill`.

**Input:** `$ARGUMENTS` is optional. The skill accepts no required arguments and runs against the current project state. Supported optional flags:

- `--state-dir <path>` — override the default `.pHive` state directory (matches the se-4 helper's signature).
- `--existing-skills <comma-list>` — manual override for the existing-skills catalog used when computing distinctness. Defaults to scanning `skills/*/SKILL.md` names.

## Skill Preamble

See [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate (initialization check) + persona / config / memory loading.

**Kickoff gate override — warn, don't block.** This skill is meta tooling (it discovers skill ideas, not project work) and should be runnable in fresh repos. If the kickoff checks fail, emit the warning below and proceed.

> Warning: Hive not initialized for this project. `/find-skills` is running with defaults — mining will draw from whatever signals exist on disk; if there are none, the output yaml will note "no candidates met threshold" and the skill will exit cleanly.

## Process

1. **Mine observations.** Call `hive.lib.skill_candidate_mine.mine()` to retrieve the deterministic observation list. The helper already applies the project-maturity gate (greenfield/early → returns `[]`), so an empty result here is the expected propagation path — proceed to step 4 with an empty list and emit the empty-yaml shape. No special-casing required.

   ```python
   from hive.lib.skill_candidate_mine import mine
   observations = mine(state_dir=state_dir)
   ```

2. **Rank.** Pass the observations to `hive.lib.skill_candidate_rank.rank()`. Supply the existing-skills catalog (default: kebab-name list from `skills/*/SKILL.md`) so distinctness can downscore patterns whose suggested name overlaps with an already-shipped skill.

   ```python
   from hive.lib.skill_candidate_rank import rank, filter_threshold
   ranked = rank(observations, existing_skills=existing_skills_catalog)
   ```

   The ranking formula is `occurrence_count × recency_factor × distinctness`:
   - `recency_factor`: linear decay from `last_seen` floored at 0.25 over a 90-day window.
   - `distinctness`: `1.0 - max similarity (difflib.SequenceMatcher) to any existing skill`. Empty catalog → 1.0.

   The returned list is sorted by `(-score, name)` for deterministic output.

3. **Filter by quality threshold.** Call `filter_threshold(ranked)` to keep only candidates with `occurrence_count >= 3` AND `distinctness >= 0.5`. Anything below is treated as noise and excluded from the yaml.

4. **Write the candidate yaml.** Ensure `.pHive/meta/` exists (mkdir if absent) and write `.pHive/meta/skill-candidates.yaml`. Use `hive.lib.skill_candidate_rank.write_candidates_yaml(filtered, path)` — it encodes the empty-list contract (single `note:` key, no `candidates:` key) and the non-empty shape (ordered `candidates:` list + `generated_at:` audit stamp) in one place so the prose below and the code stay in sync.

   - **When the filtered list is empty** (mining returned nothing OR every observation fell below the threshold), the yaml MUST contain exactly one top-level key — a one-line note — and NOTHING else:

     ```yaml
     note: "no candidates met threshold"
     ```

     Do NOT emit `candidates: []`, do NOT emit individual observation rows below threshold, do NOT include the raw mine output. The acceptance criterion is explicit: no noise rows.

   - **When the filtered list is non-empty,** emit a top-level `candidates:` list of dicts. Each dict has the fields produced by the ranker: `name`, `triggers`, `scope_hint`, `recent_examples`, `occurrence_count`, `distinctness`, `score`, `source_kind` (and pass-through `first_seen` / `last_seen` for traceability).

     ```yaml
     candidates:
       - name: commit-feat-skill-ergo
         triggers:
           - "when a recurring commit-type pattern needs automation"
           - "as part of the commit/PR workflow"
           - 'when the "feat(skill-ergo)" pattern recurs'
         scope_hint: "atomic-skill — single-shot, codebase-touching"
         recent_examples:
           - "feat(skill-ergo-may2026): signal-mining module (se-4)"
         occurrence_count: 6
         distinctness: 0.82
         score: 4.32
         source_kind: commit
         first_seen: "2026-04-08T10:14:00Z"
         last_seen: "2026-05-18T09:01:00Z"
     ```

5. **Present and offer hand-off.** Print the ranked candidates to the operator as a numbered list (name, score, occurrence_count, distinctness, top recent example). End with the prompt:

   > Type a candidate number to hand off to `/write-skill`, or `skip` to exit without authoring.

   On a numeric reply, compose a brief from the selected candidate and invoke `/write-skill` via an atomic external Skill call — DO NOT inline `/write-skill`'s template-rendering logic. The brief MUST use the format `/write-skill` expects (see [`skills/write-skill/SKILL.md`](../write-skill/SKILL.md)):

   ```
   Skill(
     skill="write-skill",
     args="name: <candidate.name>\nproblem: <one-sentence problem derived from candidate.recent_examples + source_kind>\ntriggers: <candidate.triggers joined by '; '>\nscope: <candidate.scope_hint>"
   )
   ```

   Hand-off is OPT-IN. Never auto-trigger `/write-skill` — the operator must explicitly select a candidate. On `skip` (or no reply), exit cleanly with a one-line summary of what was written ("Wrote N candidates to `.pHive/meta/skill-candidates.yaml`. No hand-off requested.").

## What this skill is NOT

- **Not a writer of new skills.** Authoring is `/write-skill`'s job. `/find-skills` produces a yaml + an invocation of `/write-skill` if the operator opts in — it does not template, render, or scaffold any `SKILL.md`.
- **Not auto-triggered.** The hand-off to `/write-skill` is user-in-the-loop. There is no daemon, watcher, or cron that fires `/find-skills` and chains to `/write-skill` unattended.
- **Not a runner of the produced skill.** `/find-skills` exits after the yaml is written and (optionally) the `Skill` hand-off completes. Running the newly-scaffolded skill is a separate operator step.
- **Not a re-implementation of mining.** Observation collection lives entirely in `hive/lib/skill_candidate_mine.py` (se-4). This skill consumes that output and is intentionally thin above it.

## Atomic-composition invariants

- **External boundary to `/write-skill`.** The hand-off is a `Skill(skill="write-skill", ...)` call — never an inline import or duplicate template render.
- **Empty-yaml shape is contractual.** When nothing meets the threshold, the yaml has exactly one short key (`note:`), no `candidates:` list, no observation rows.
- **Maturity gate is implicit.** `mine()` returns `[]` on greenfield/early; that propagates naturally to the empty-yaml shape. `/find-skills` does NOT re-check maturity.
- **Deterministic output.** Re-running with the same signals produces a byte-identical yaml — the ranker sorts by `(-score, name)` and the mine helper is itself deterministic.

## See also

- [`skills/write-skill/SKILL.md`](../write-skill/SKILL.md) — downstream hand-off target; consumes the candidate brief produced by step 5.
- [`hive/lib/skill_candidate_mine.py`](../../hive/lib/skill_candidate_mine.py) — upstream observation source (story se-4).
- [`hive/lib/skill_candidate_rank.py`](../../hive/lib/skill_candidate_rank.py) — ranking + threshold helper this skill orchestrates.
- [`hive/references/skill-prelude.md`](../../hive/references/skill-prelude.md) — kickoff gate + persona loading.
