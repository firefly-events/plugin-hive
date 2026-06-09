# Squad-leader brief — multica-plugin-ui structured outline (Phase D)

**You are `tpm`, leader of `planning-team-squad`** (architect=codex/gpt-5.5,
technical-writer=codex/gpt-5.4-mini, researcher=codex). **You ORCHESTRATE — delegate.**

### Delegation (gap-corrected + anti-stall)
Create a FRESH issue assigned to the member at creation (`multica issue create --assignee
<member> --status todo …`). A status-flip does NOT spawn. **ANTI-STALL: if a child you
created sits in `todo` for more than ~3 minutes without going in_progress, it failed to
spawn — CANCEL it and create a brand-new fresh issue assigned to the same member.** (The
prior H/V round lost the writer-synth child this way.) Poll children to in_review/done;
read via `multica issue comment list`. Members commit to work_dirs (human reconciles).

## Context — H/V is APPROVED (read first, on origin `feat/multica-plugin-ui`)
- `.pHive/epics/multica-plugin-ui/docs/vertical-plan.md` — the **6 approved slices** (Step 1
  proof-gate w/ hard bail, Steps 2-4 the views, Step 5 skills catalog, Step 6 upstream seam).
- `.pHive/epics/multica-plugin-ui/docs/horizontal-plan.md` — the 9-layer map.
- `.pHive/epics/multica-plugin-ui/docs/design-discussion.md` — 4 locked forks.

Do NOT re-plan slices or re-litigate forks. Expand them into a story-level outline.

## The job — produce the structured outline

Delegate:

1. **Outline content → `architect`.** For EACH of the 6 slices, decompose into 1-3
   **stories**. Per story specify: a stable handle (e.g. `mpu-1`…), title, the slice it
   belongs to, concrete **acceptance criteria** (testable, tied to the slice's verified-by),
   **dependencies** (story handles it blocks/blocked-by), layers touched, and any
   cross-cutting note. Slice 1 stories must encode the **hard BAIL gate** as an explicit AC.
   Keep Steps 2-4 stories parallel (depend only on Slice-1 stories). Use real file:line
   seams from the H/V docs where they sharpen an AC. Target ~8-12 stories total.

2. **Synthesize → `technical-writer`.** Write `.pHive/epics/multica-plugin-ui/docs/
   structured-outline.md` (commit to branch): an intro (epic goal + the bail gate), then
   per-slice sections each listing its stories with handle/title/AC/deps. Preserve all
   acceptance criteria verbatim from the architect; drop no stories. End with a story
   dependency summary (which stories are parallel vs sequential).

## Boundaries
- Produce structured-outline.md only. Do NOT write story YAML files, do NOT publish to
  Multica, do NOT advance any user gate. The human runs the sign-off gate, then story
  decomposition + publish locally.
- When children terminal + the doc committed, post a final summary comment on THIS issue:
  child id + member + status + the full story handle list (mpu-1 … mpu-N w/ one-line titles).
