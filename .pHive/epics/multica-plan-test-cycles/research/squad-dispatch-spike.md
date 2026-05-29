# Squad Dispatch Spike Verdict

Date: 2026-05-28
Story: mpt-1-squad-cell-dispatch-spike
Issue: PLU-154

## Verdict

Pick the downstream carrier: **per-persona fan-out**.

Multica accepts a squad as an issue assignee, but the observed execution model is
leader-only. A single issue assigned to `planning-team-squad` ran on the squad
leader (`tpm`) and did not fan out to the member agents (`researcher`,
`architect`, `technical-writer`).

Implication for the backend split: do not rely on one squad issue to preserve the
Codex-for-work / Claude-for-verify split. The real plan-dispatch stories must fan
out one Multica issue per persona and assign each issue to the concrete agent UUID
chosen from `agent_backends` / `.pHive/multica/agents.yaml`. For planning, this
keeps `researcher`, `architect`, and `technical-writer` on Codex while `tpm` stays
on Claude. For verification, dispatch directly to `tester` or fan out individual
verify personas; do not assign one scenario to `verify-team-squad` expecting member
fan-out.

This unblocks mpt-5 by choosing the non-squad helper branch: reuse/extend the
existing single-agent dispatch path for each persona rather than adding a
`dispatchStoryToSquad` dependency.

## Live Spike

Setup:

- The live workspace initially had only `test-spike-squad`; `planning-team-squad`
  existed in `.pHive/multica/squads.yaml` but was not seeded server-side.
- Created live squad `planning-team-squad`
  (`50d408e4-f92f-46b1-95c1-844de157f181`) with leader `tpm`.
- Added members matching the repo roster: `researcher`, `architect`,
  `technical-writer`. The leader `tpm` was auto-added as a leader member.

Throwaway issue:

- Created `PLU-165` (`f83be809-8d72-43c6-ab35-504a6ba122ba`) as
  "Throwaway squad dispatch spike for PLU-154".
- Assigned it with:
  `multica issue assign f83be809-8d72-43c6-ab35-504a6ba122ba --to-id 50d408e4-f92f-46b1-95c1-844de157f181 --output json`.
- The assignment response recorded:
  `assignee_type: squad`, `assignee_id: 50d408e4-f92f-46b1-95c1-844de157f181`.

Observed run:

- First poll after assignment showed only `tpm` in `working` status.
- `researcher`, `architect`, and `technical-writer` remained `idle`.
- The only agent-authored message on `PLU-165` was by `tpm`
  (`fecafaac-17a6-4be8-a472-9084de268bdf`): "Executing role: tpm (squad leader).
  No fan-out..."
- Final issue status for `PLU-165` moved to `in_review`; member agents were still
  idle afterward.

Provider evidence:

| Role | Agent ID | Repo provider/model | Runtime observed |
| --- | --- | --- | --- |
| researcher | e3e23ce0-059b-46e2-bd28-24d00d6e2b56 | codex / default | Codex runtime, idle |
| architect | 2da66344-9d5b-4e26-9f8b-ba8f73bec507 | codex / default | Codex runtime, idle |
| technical-writer | 27217830-0e96-4c31-ba3f-e90bb212308e | codex / default | Codex runtime, idle |
| tpm | fecafaac-17a6-4be8-a472-9084de268bdf | claude / claude-opus-4-7 | Claude runtime, executed |

## Roster Check

Checked `.pHive/multica/squads.yaml` against `.pHive/multica/agents.yaml`.

Planning squad:

| Role | Present in agents.yaml | Provider/model |
| --- | --- | --- |
| researcher | yes | codex / default |
| architect | yes | codex / default |
| technical-writer | yes | codex / default |
| tpm | yes | claude / claude-opus-4-7 |

Verify squad:

| Role | Present in agents.yaml | Provider/model |
| --- | --- | --- |
| tester | yes | claude / claude-opus-4-7 |
| test-architect | yes | claude / claude-sonnet-4-6 |
| test-scout | yes | claude / claude-sonnet-4-6 |
| peer-validator | yes | claude / claude-opus-4-7 |
| security-reviewer | yes | claude / claude-sonnet-4-6 |

Missing member roles: **none** in the checked-in repo roster. The previously risky
verify roles (`test-architect`, `test-scout`, `security-reviewer`) are present in
`.pHive/multica/agents.yaml`.

## Downstream Contract

For S4/S5 implementation:

- Treat a squad assignment as a leader-task carrier, not a multi-agent execution
  primitive.
- `plan-mode-multica` should derive the assembled persona list, create or reuse one
  issue per persona, and assign each issue to the concrete agent UUID.
- Poll each persona issue independently and aggregate terminal results into the
  episode marker.
- Preserve the existing mode shape from `/execute`, but keep the carrier internal
  to the new plan/test mode atoms.
- Do not add `dispatchStoryToSquad` for mpt-5 unless Multica later changes squad
  semantics to execute member agents directly.
