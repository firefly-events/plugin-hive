export const meta = {
  name: 'execute-d-3-design-mode-multica',
  description: 'cc-workflows single-story dispatch for d-3 (design-mode-multica atom — per-persona dispatch within team-cell + one Multica issue per persona)',
  phases: [
    { title: 'research', detail: 'researcher maps execute-mode-multica per-persona dispatch + design-discussion §6 Q10 resolution' },
    { title: 'implement', detail: 'developer creates design-mode-multica/SKILL.md (~400-450 lines) mirroring execute-mode-multica' },
    { title: 'test', detail: 'tester authors resolver vitest covering 5-tier + per-persona dispatch sequence + per-persona marker count + smoke scenario YAML' },
    { title: 'review', detail: 'reviewer architect-checks per-persona dispatch + per-persona marker + one-issue-per-persona Q10 resolution' },
  ],
};

const a = typeof args === 'string' ? JSON.parse(args) : args;
const STORY_ID = a.story_id;
const STORY_PATH = a.story_path;
const BRANCH = a.branch;
const WORKTREE = a.worktree;

const RESULT_SCHEMA = {
  type: 'object',
  required: ['files', 'notes', 'verdict'],
  additionalProperties: false,
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'change'],
        additionalProperties: false,
        properties: {
          path: { type: 'string' },
          change: { type: 'string', enum: ['created', 'modified', 'deleted'] },
        },
      },
    },
    notes: { type: 'string' },
    verdict: { type: 'string', enum: ['pass', 'fail', 'pass-with-notes', ''] },
  },
};

const baseContext = `
Worktree: ${WORKTREE}
Integration branch: ${BRANCH} (already checked out)
Story ID: ${STORY_ID}
Story spec: ${STORY_PATH}

NO-GIT CONTRACT: Do NOT run git add/commit/push. Return your structured file list. The orchestrator owns commits.

READ FIRST:
- Your persona at hive/agents/<your-role>.md
- The story spec at ${STORY_PATH} (acceptance_criteria + design_decisions + Q10 resolution)
- skills/hive/skills/execute-mode-multica/SKILL.md (LARGEST REFERENCE SHAPE — ~472 lines — per-persona dispatch within team-cell, episode markers per persona, serial within team-cell, one issue per persona)
- skills/hive/skills/design-review-mode-multica/SKILL.md (dr-2 — sister atom; uses SINGLE Multica run with 4 agent() calls. d-3 INTENTIONALLY DIFFERS — per-persona dispatch with separate markers per persona; this is the d-3 vs dr-2 asymmetry recorded in dr-2's reviewer memory)
- skills/hive/skills/review-mode-multica/SKILL.md (r-2 — solo reviewer mirror; thin wrapper shape)
- skills/hive/skills/design-dispatch/SKILL.md (d-2 router — Phase 0 wiring already shipped)
- skills/design/SKILL.md (d-1 just shipped — Phase 0 wiring + Phase A persona pipeline with --include-constraints toggle; the multica branch hands off to design-mode-multica)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q10 (RESOLVED by-default: one Multica issue per persona)
- hive/lib/mode-resolver.mjs (confirm HIVE_DESIGN_MODE registered)

d-1 SHIPPED (just): /design has Phase 0 (design-dispatch invocation) + Phase A (persona pipeline with --include-constraints toggle). d-3 is what the multica branch routes to.
d-2 SHIPPED (Slice 3 router).

KEY DESIGN DECISIONS (locked by design-discussion):
- Per-persona dispatch within a team-cell (NOT single-run); mirrors execute-mode-multica per-story precedent.
- One Multica issue per persona (Q10 RESOLVED by-default, not gated). Toggle ON = 3 issues (accessibility, animations, ui-designer). Toggle OFF = 1 issue (ui-designer).
- Episode markers per persona at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml.
- INTENTIONAL ASYMMETRY with dr-2 (which uses single Multica run with 4 agent calls). d-3 mirrors execute-mode-multica's per-persona pattern; dr-2 mirrors design-review.workflow.yaml's 4-step anchor. Both are intentional — same Multica substrate, two atom shapes for two different upstream contracts.

CONTRACT INVARIANTS:
- Per-persona dispatch (serial within team-cell)
- One Multica issue per persona dispatched
- One episode marker per persona at multica-run.yaml
- Phase 0c 5-tier resolution (env HIVE_DESIGN_MODE > root config execution.design_mode > shipped baseline > skill override > default)
- --include-constraints toggle from d-1 dictates persona set (toggle ON: 3 personas; toggle OFF: ui-designer only)
- Episode-marker shape mirrors execute-mode-multica multica-run.yaml schema
- closeIssue at terminal per persona (per execute-mode-multica precedent)

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/execute-mode-multica/SKILL.md FULL. Capture: Step 0 (precondition gate + 5-tier resolution + BOOTSTRAP_REQUIRED), Step 1 (createIssue per persona inside team-cell), Step 2 (dispatchStoryToAgent — per-persona assignment), Step 3 (pollTaskUntilTerminal — per-persona polling), Step 4 (writeMulticaRunEpisode — per-persona marker), Step 5 (wait-all-terminal + return). Note the team-cell serial dispatch loop.\n  2. Read skills/hive/skills/design-review-mode-multica/SKILL.md (dr-2). Capture: single-Multica-run wrapper with 4 internal agent() calls; ONE issue + ONE marker. d-3 INTENTIONALLY DIFFERS — per-persona dispatch + per-persona markers. Document the asymmetry explicitly so d-3 prose can cite it.\n  3. Read skills/hive/skills/review-mode-multica/SKILL.md (r-2). Capture: thin-wrapper Steps 0-5; solo reviewer; scope_drift contract.\n  4. Read skills/design/SKILL.md (post d-1). Capture: Phase 0 invocation contract, Phase A persona pipeline behavior with --include-constraints toggle, persona set determination (toggle ON → 3 personas; toggle OFF → 1 persona). d-3 receives the resolved persona set from /design Phase A.\n  5. Read skills/hive/skills/design-dispatch/SKILL.md (d-2). Capture inputs/outputs; --sequential pass-through.\n  6. Read .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q10 verbatim text. Cite in d-3 prose.\n  7. Confirm HIVE_DESIGN_MODE registered in hive/lib/mode-resolver.mjs (already shipped in s-2).\n  8. Confirm vitest as runner; resolver test path skills/hive/skills/design-mode-multica/test/resolver.test.mjs.\n  9. Identify Multica issue label convention (likely labels:[] following execute-mode-multica + design-review-mode-multica precedent).\n  10. Map: per-persona dispatch within a team-cell vs across separate team-cells. execute-mode-multica uses single team-cell with serial per-persona dispatch inside. d-3 matches this — one team-cell per /design invocation, N issues inside (N=1 or 3 based on toggle).\n  11. Identify episode-marker-per-persona path: \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml where {unit_id} differentiates personas. Or alternatively {unit_id} is the persona ID. Confirm via execute-mode-multica's exact path scheme.\n  12. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml.\n\n  verdict='pass' if all 12 items mapped; 'fail' otherwise. Do NOT modify source files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:per-persona-multica-dispatch-shape', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/design-mode-multica/SKILL.md (target ~400-450 lines per story spec). STRUCTURE (mirror execute-mode-multica's anatomy — largest reference):\n     - H1 + short summary: atomic skill, NOT inline /design prose. Runs /design through the Multica substrate as per-persona dispatch within a team-cell.\n     - State directory resolution block.\n     - Invocation contract: inputs from design-dispatch (arguments incl. --include-constraints, field_sources, epic_id, persona_set from d-1 Phase A toggle resolution). Outputs ONE episode marker per persona at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml + sidecar .messages.jsonl per persona.\n     - Step 0: Precondition gate. 5-tier connection resolve + BOOTSTRAP_REQUIRED gate; reject with structured precondition_failed.\n     - Step 1: Resolve persona set from Phase A toggle. Toggle OFF → [ui-designer]; toggle ON → [accessibility-specialist, animations-specialist, ui-designer]. Q10 RESOLVED by-default: ONE Multica issue per persona — NO single-bundled issue.\n     - Step 2: For each persona serially (within the team-cell), createIssue with persona-specific brief; assignIssue to persona's runtime backend per agent_backends; poll-to-terminal; writeMulticaRunEpisode per persona; closeIssue on terminal. Maintain serial order: accessibility → animations → ui-designer (when toggle ON) so animations gets accessibility notes as optional input + ui-designer gets both as prepended constraint blocks.\n     - Step 3: Wait for all per-persona issues to reach terminal (passed/failed/cancelled).\n     - Step 4: Return aggregated summary {persona_runs: [{persona, status, issue_id, marker_path, evidence_ref}], run_id}.\n     - Failure modes block (precondition_failed; Multica timeout per persona; persona agent crash).\n     - Reuses (atomic deps): hive/adapters/multica/index.ts, hive/lib/task-tracking-dispatch, hive/references/episode-schema.md, hive/agents/accessibility-specialist.md, hive/agents/animations-specialist.md, hive/agents/ui-designer.md, skills/hive/skills/execute-mode-multica/SKILL.md (mirror anchor).\n     - Phase 0c 5-tier resolver block (env HIVE_DESIGN_MODE > root config execution.design_mode > shipped baseline > skill override > default).\n     - Constraint summary table (atomic skill; per-persona dispatch ≠ single-run; ONE issue per persona by default per Q10; episode marker per persona; --include-constraints toggle dictates persona count; INTENTIONAL ASYMMETRY with dr-2 documented).\n     - Insight-capture suffix template on each documented agent prompt example (per execute-mode-multica precedent).\n     - Target length: 400-450 lines per story spec.\n  2. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:design-mode-multica-per-persona', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/design-mode-multica/test/resolver.test.mjs using vitest. Mirror dr-2's resolver test pattern but adapted to per-persona shape. Cover:\n     (a) 5-tier resolution (env HIVE_DESIGN_MODE > root config execution.design_mode > shipped baseline > skill override > default). Each tier returns expected mode_decision.\n     (b) source tracking matches the winning tier.\n     (c) Per-persona dispatch shape — assert atom prescribes serial per-persona dispatch (NOT single-run-with-N-agents like dr-2). Grep SKILL.md for the per-persona loop pattern.\n     (d) Per-persona episode markers — assert atom prescribes ONE marker per persona at multica-run.yaml (NOT one marker total).\n     (e) Toggle ON → 3 personas → 3 issues + 3 markers (count assertion via prose grep).\n     (f) Toggle OFF → 1 persona (ui-designer) → 1 issue + 1 marker.\n     (g) Q10 cited verbatim in SKILL.md prose (substring grep on §6 Q10 resolution text or "one issue per persona" key phrase).\n     (h) Intentional asymmetry with dr-2 documented (grep SKILL.md for "dr-2" or "design-review-mode-multica" + "intentional" / "asymmetry" / "differs").\n     (i) ctx.env raw-token footgun (raw 'HIVE_DESIGN_MODE=value').\n  2. CREATE .pHive/test-scenarios/d-3-design-mode-multica-smoke.yaml per test-scenario-schema. Cover /design --include-constraints via design-mode-multica producing 3 episode markers + 3 Multica issues; AND /design (no flag) producing 1 marker + 1 issue. Avoid embedded id:/status: tokens in folded scalars.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND new resolver test path to vitest file list. Preserve existing paths.\n  4. RUN npm test from hive/lib. Confirm full suite green. Capture pass count.\n  5. s-3 no-codex lint is OUT OF SCOPE for design-mode-multica (multica atom, not *-mode-cc-workflows). Document.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:d-3-resolver-and-scenario', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Per-persona dispatch shape: design-mode-multica/SKILL.md prescribes serial per-persona createIssue + assignIssue + poll + marker + closeIssue inside a team-cell. NOT a single-Multica-run wrapper. Mirrors execute-mode-multica per-story precedent.\n  2. ONE Multica issue per persona (Q10 RESOLVED by-default, not gated). Toggle ON = 3 issues, toggle OFF = 1 issue. Cited verbatim in prose.\n  3. Episode markers per persona at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml. Per-persona, not per-call.\n  4. --include-constraints toggle from d-1 dictates persona set; serial order accessibility → animations → ui-designer when toggle ON.\n  5. Phase 0c 5-tier resolver matches canonical pattern. HIVE_DESIGN_MODE varName. Field-source tracking present.\n  6. Intentional asymmetry with dr-2 documented in SKILL.md prose (one explicit mention of "intentional" + "asymmetry" with the design-review atom).\n  7. Resuses section names execute-mode-multica as mirror anchor + accessibility-specialist + animations-specialist + ui-designer.\n  8. Constraint summary table complete.\n  9. Insight-capture suffix template on each documented agent prompt.\n  10. Resolver test covers all 9 listed assertions; scenario YAML valid; npm test green at hive/lib.\n  11. NO regression in prior shipped atoms (file scope strictly limited to: skills/hive/skills/design-mode-multica/, .pHive/test-scenarios/d-3-..., hive/lib/package.json scripts.test, memory files only).\n  12. Line count target met (400-450 lines per story spec).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:d-3-per-persona-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
