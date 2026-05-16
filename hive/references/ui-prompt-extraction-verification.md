# UI Prompt Extraction Verification

Regression-catching gates for Epic F's ui-designer prompt extraction.
Run periodically or in CI to catch re-inlined ui-designer prompts.

## Gates

### 1. Direct SKILLs have no inline ui-designer task blocks

```bash
rg "Task for ui-designer|Spawn a subagent with the full ui-designer persona and this task:" \
  skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md
```

Expected: exit code 1 from `rg`, zero matches.

> **Regex note.** The earlier draft of this gate matched only on `Spawn a subagent with the full ui-designer persona`, which collides with the NEW load → cite → inject → spawn envelope phrasing (e.g., ``Spawn a subagent with the full ui-designer persona (`hive/agents/ui-designer.md`) and the rendered prompt body.``). The distinguishing suffix of the OLD inline-task header was `and this task:` — the gate above anchors on that.

### 2. Direct SKILLs cite their prompt files

```bash
rg "hive/references/ui-prompts/" \
  skills/{brand-system,design-system,polish-audit,visual-qa}/SKILL.md
```

Expected: exit code 0 from `rg`, exactly 4 matches, one citation per direct SKILL.

### 3. Design-review workflow cites extracted ui-designer prompt files

```bash
rg "hive/references/ui-prompts/design-review-" \
  hive/workflows/design-review.workflow.yaml
```

Expected: exit code 0 from `rg`, exactly 2 matches, one per extracted ui-designer step.

### 4. Design-review workflow uses step_file for ui-designer prompts

```bash
rg "step_file: hive/references/ui-prompts/" \
  hive/workflows/design-review.workflow.yaml
```

Expected: exit code 0 from `rg`, exactly 2 matches.

### 5. Specialist design-review steps keep inline task content

```bash
rg "task: >" hive/workflows/design-review.workflow.yaml
```

Expected: exit code 0 from `rg`, exactly 2 matches, for accessibility-critique and animations-critique only.

## Prompt File Existence

```bash
for f in brand-system design-system polish-audit visual-qa \
         design-review-design-critique design-review-synthesis; do
  test -f "hive/references/ui-prompts/$f.md"
done
```

Expected: all six `test -f` checks exit 0.

## Aggregate Delta

- `skills/brand-system/SKILL.md`: 109 -> 72 (-37)
- `skills/design-system/SKILL.md`: 89 -> 75 (-14)
- `skills/polish-audit/SKILL.md`: 162 -> 134 (-28)
- `skills/visual-qa/SKILL.md`: 128 -> 82 (-46)
- Aggregate: -125 lines across the four direct UI cluster SKILLs
- `hive/workflows/design-review.workflow.yaml`: 5750 -> 3698 bytes (-2052 bytes)
- `skills/design-review/SKILL.md`: +287 bytes (extension code)
