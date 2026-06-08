# Design Discussion — `release-lifecycle`

## §0 Prelude
- Branch: `feat/release-lifecycle` off `develop`. Tracked tree clean (chore/squash WIP stashed).
- `task_tracking` commented out in root config → Phase D no-op; local story YAMLs are source of truth.
- Methodology pinned `classic` (60 test files would auto-detect `tdd`, but these stories are prose/skill-heavy; testable stories still carry a test step).
- git_flow helper not consulted inline; base_branch=`develop`, branch_strategy=`per-epic`.

## §1 Goal
Close the loop on Hive's own SDLC: make "finished" mean something. Today work gets done but story `status` is never advanced, there's no command that *ships*, version bumps are ad-hoc, and there's no release-comms artifact. This epic adds the closing half of the lifecycle.

Four user asks, plus one surfaced during clarification:
1. `/plan` should ask about version bump.
2. A `/ship` skill (single capstone command).
3. Map every story-status point to a workflow command — be explicit about transitions; fix "work finished but never marked."
4. Release-posts as a concept (Hive-first, generic-aware): video script + post ideas + where-to-post + highlights, emitted by `/ship`.
5. **(surfaced)** "Shipped" is project-defined — App Store submit / Vercel deploy / GitHub release / npm publish / custom. The *definition* belongs in kickoff; `/ship` reads it.

## §2 Proposed approach
A six-story epic. Spine = a canonical **status-lifecycle contract** (`rl-1`); everything else binds to it.

| Story | Surface | What |
|---|---|---|
| rl-1 | `hive/references/status-lifecycle.md` (new) | Canonical state set + which command owns each transition. The contract. |
| rl-2 | kickoff + project-profile | Capture `ship_target` (enum + custom cmd) — "what does shipping mean here?" |
| rl-3 | plan/execute/test/review skills | Wire **explicit** status writes per rl-1. The "never marked" fix. |
| rl-4 | `/plan` question set + epic.yaml | Version-bump decision (major/minor/patch/none) recorded for `/ship` to consume. |
| rl-5 | `hive/references/release-post/` (new templates + gen lib) | Release post + video script + post-idea generator, Hive-first/generic-aware. |
| rl-6 | `skills/ship/SKILL.md` (new) | Capstone: mark shipped, bump version, run configured ship action, emit release artifacts. |

## §3 Status lifecycle (rl-1 sketch — to ratify)
States: `pending → in_progress → in_review → complete → shipped`, plus `blocked` (orthogonal).
Ownership (transition → owning command):
- `pending → in_progress`: `/execute` (story dispatch)
- `in_progress → in_review`: `/review` entry
- `in_review → complete`: `/review` pass (or `/test` gate)
- `complete → shipped`: **`/ship`** ← the gap today
- `* → blocked` / `blocked → *`: any command on dependency stall

`/status` stays read-only (reports). `/ship` is the only writer of `shipped`.

## §4 Risks
- **R1 (high):** rl-3 edits four command skills; over-eager status writes could fire mid-failure (mark complete when review failed). Mitigation: transitions gated on step success, not step entry.
- **R2 (med):** rl-3 and rl-4 both touch `skills/plan/SKILL.md` → file overlap. Mitigation: rl-4 `depends_on rl-3`, serial.
- **R3 (med):** `ship_target: custom` runs an arbitrary command — blast radius. Mitigation: `/ship` confirms the resolved action before executing; dry-run shown first.
- **R4 (low):** release-post generic-aware over-design. Mitigation: Hive-first, single template param'd by project name/links; defer multi-project until a consumer asks.

## §5 Dependencies
rl-1 blocks all. rl-6 depends on rl-2+rl-3+rl-4+rl-5. rl-2/rl-5 independent (parallel-eligible). rl-4 serial after rl-3.

## §6 Open questions (numbered)
1. Status set — ratify `in_review` as distinct from `complete`, or collapse? (sketch keeps both)
2. Does `/ship` operate per-epic or per-release (multiple epics)? Sketch = per-epic; release post aggregates one epic's shipped stories.
3. Version bump: does `/ship` perform the bump+commit+tag itself, or emit the intent and let the human run it? Sketch = `/ship` does it behind a confirm gate.
4. Should `complete → shipped` require all epic stories complete, or allow partial ship? Sketch = all-complete gate, override flag.

## §7 Scale
**Medium.** Multi-file, multi-skill, well-understood surfaces, no UI, no migration. H/V skip justified — vertical is obvious (contract → bind → capstone). Proceeding to stories after sign-off.
