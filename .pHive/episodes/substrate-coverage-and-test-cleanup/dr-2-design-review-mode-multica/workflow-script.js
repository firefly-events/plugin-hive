export const meta = {
  name: 'execute-dr-2-design-review-mode-multica',
  description: 'cc-workflows single-story dispatch for dr-2 (design-review-mode-multica atom — 4-step workflow.yaml model preserved)',
  phases: [
    { title: 'research', detail: 'researcher maps design-review.workflow.yaml 4-step model + plan-mode-multica/test-mode-multica shape contrast' },
    { title: 'implement', detail: 'developer creates design-review-mode-multica/SKILL.md with 4 agent() calls inside SINGLE Multica run' },
    { title: 'test', detail: 'tester authors resolver vitest + scenario YAML + adds test to hive/lib/package.json' },
    { title: 'review', detail: 'reviewer architect-checks 4-step preservation + single-Multica-run marker shape + intentional asymmetry vs d-3' },
  ],
};

const a = typeof args === 'string' ? JSON.parse(args) : args;
const STORY_ID = a.story_id;
const STORY_PATH = a.story_path;
const BRANCH = a.branch;
const WORKTREE = a.worktree;

const RESULT_SCHEMA = {
  type: 'object',
  required: ['files', 'notes'],
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
          change: { type: 'string', enum: ['created', 'modified', 'deleted', 'unchanged'] },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + files_to_modify + design_decisions + Q11 rationale)
- hive/workflows/design-review.workflow.yaml lines 8-81 (THE architectural anchor — 4 steps: accessibility → animations → ui-designer critique → ui-designer synthesis)
- skills/hive/skills/plan-mode-multica/SKILL.md (mirror target for Multica atom shape — per-persona dispatch precedent; dr-2 INTENTIONALLY DIFFERS — single-run with 4 agent calls)
- skills/hive/skills/test-mode-multica/SKILL.md (per-scenario dispatch precedent — also single-run)
- skills/hive/skills/execute-mode-multica/SKILL.md (lifecycle reference — full Multica run anatomy)
- skills/hive/skills/design-review-dispatch/SKILL.md (router that dispatches into this atom — dr-1)

dr-1 SHIPPED (Slice 4): design-review-dispatch router exists; dr-2 atom is what the multica branch of dispatch routes to.

KEY DESIGN DECISION (Q11 ruling):
- dr-2 preserves the 4-step workflow.yaml shape: ONE Multica run, FOUR agent() calls inside it, ONE episode marker capturing all four outputs.
- This is INTENTIONALLY DIFFERENT from d-3 (design-mode-multica), which uses per-persona dispatch with separate markers per persona.
- Reason: design-review.workflow.yaml is the architectural anchor — its 4-step structure is what dr-2 mirrors. d-3 mirrors plan-mode-multica's per-persona pattern instead.

CONTRACT INVARIANTS:
- 4 agent() calls preserved: accessibility, animations, ui-designer-critique, ui-designer-synthesis
- SINGLE Multica run wrapper (one Multica issue, one episode marker)
- --skip flag semantics: continue to skip steps
- --artifact-target flag: continue to work end-to-end
- Phase 0c 5-tier resolution (env > root config > shipped baseline > skill override > default)

INSIGHT CAPTURE (before returning your structured output)

If you encountered any reusable lesson during this turn — a constraint that surprised you, a pattern that worked unexpectedly well, a footgun the next worker on this codebase will hit — append it to:

  hive/agents/memories/<persona>/<kebab-case-title>.md

File shape (frontmatter + 3-5 line body):

---
name: <kebab-case-title>
description: <one-line summary, second-person imperative>
applies_to: <persona>
---

<2-4 lines: the lesson + why it matters. Concrete, not generic. Cite file paths or line numbers where useful.>

Skip the capture entirely if nothing on this turn is reusable across stories. Fire-and-forget — do not block your return on the write. If the directory does not exist, create it.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read hive/workflows/design-review.workflow.yaml lines 8-81. Capture the 4 steps: id, agent role, step_file path, depends_on edges, inputs/outputs. The 4 agent() calls in your atom must mirror these exact step roles.\n  2. Read skills/hive/skills/plan-mode-multica/SKILL.md. Capture: Step 0/1/2/3/4/5 shape; the per-persona dispatch loop in Step 1; episode-marker write target shape. NOTE: dr-2 diverges — single run, not per-persona.\n  3. Read skills/hive/skills/test-mode-multica/SKILL.md. Capture the single-run dispatch shape (closer to what dr-2 needs). Note any precedent for multiple agent() calls inside one Multica issue.\n  4. Read skills/hive/skills/execute-mode-multica/SKILL.md briefly — capture the Multica lifecycle (createIssue → assignIssue → poll-to-terminal → marker write → closeIssue).\n  5. Read skills/hive/skills/design-review-dispatch/SKILL.md. Capture the contract for what dispatch hands to mode atoms (workflow_path, unblocked, appends_map, epic_handle, hive_config? — match the shape).\n  6. Identify the canonical 5-tier resolver pattern for Multica mode atoms: precedence env (HIVE_DESIGN_REVIEW_MODE?) > root config > shipped baseline > skill override > default. Confirm the env var name from hive/lib/mode-resolver.mjs's registered list.\n  7. Identify the Multica issue label convention. Look at execute-mode-multica/SKILL.md or plan-mode-multica/SKILL.md. dr-2 should create ONE issue labeled hive:design-review (or whatever convention applies).\n  8. Confirm test runner is vitest (per t-3 finding) at skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs.\n  9. verdict='pass' if all 8 items mapped; 'fail' otherwise. Do NOT modify files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:4-step-shape-and-multica-anatomy', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/design-review-mode-multica/SKILL.md. Mirror plan-mode-multica/test-mode-multica STRUCTURE (Steps 0-5) but with these REQUIRED variations:\n     - Step 1: ONE Multica issue created (single createIssue call). Inside the assigned-agent run, FOUR agent() calls execute in the order accessibility → animations → ui-designer-critique → ui-designer-synthesis (matching design-review.workflow.yaml:8-81).\n     - Step 3: ONE episode marker captures all 4 agent() outputs (NOT 4 separate markers). Marker path: ${'\${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml'} where {unit_id} is the design-review unit.\n     - --skip flag handling: skipped steps log info trace and proceed.\n     - --artifact-target flag handling: passed through to the agent prompts.\n     - Phase 0c 5-tier resolver block per the canonical pattern from research item 6.\n  2. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\nReturn the structured file list. verdict='pass' on success. Tester authors resolver + scenario in next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:dr-2-multica-atom', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings (env var name + resolver shape):\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs using vitest. Mirror the structure of skills/hive/skills/test-mode-cc-workflows/test/resolver.test.mjs (t-3's pattern). Cover:\n     (a) 5-tier resolution (env > root config > shipped baseline > skill override > default) — each tier returns expected mode_decision\n     (b) source tracking matches the winning tier\n     (c) 4-step dispatch shape — assert atom prescribes 4 agent() calls (read SKILL.md, grep for the 4 step roles)\n     (d) single-run shape — assert episode marker target is singular, not per-persona (read SKILL.md, assert no per-persona marker pattern)\n     (e) ctx.env footgun coverage (raw \"VARNAME=value\" token)\n  2. CREATE .pHive/test-scenarios/dr-2-design-review-mode-multica-smoke.yaml per test-scenario-schema. Avoid embedded id:/status: tokens in folded scalars (t-1b pitfall). Cover /design-review via multica substrate with --skip and --artifact-target flags.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND the new resolver test path to the vitest file list. Preserve all existing paths.\n  4. RUN npm test from hive/lib. Confirm full suite green.\n  5. Run s-3 no-codex lint against the atom. Note: dr-2 is a *-mode-multica atom — confirm lint scope (per reviewer memory no-codex-lint-scope-is-code-blocks-only, lint targets *-mode-cc-workflows; dr-2 is multica and may be out of scope. Document the finding.)\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\nReturn the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:dr-2-resolver-and-scenario', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. 4-step preservation: design-review-mode-multica/SKILL.md prescribes 4 agent() calls matching design-review.workflow.yaml:8-81 roles (accessibility, animations, ui-designer-critique, ui-designer-synthesis). Order is preserved.\n  2. Single-Multica-run shape: ONE createIssue, ONE episode marker capturing all 4 outputs. NOT 4 separate per-persona markers. This is the intentional asymmetry with d-3.\n  3. --skip and --artifact-target flags flow through end-to-end.\n  4. Phase 0c 5-tier resolver matches the canonical pattern (env > root config > shipped baseline > skill override > default). Field-source tracking present.\n  5. Resolver test covers all 5 tiers + 4-step assertion + single-run assertion. All vitest cases green.\n  6. Test scenario YAML loads via loadScenario without error.\n  7. hive/lib/package.json scripts.test includes the new test path. Full npm test green.\n  8. NO scope drift — only files in story spec's files_to_modify (plus episode markers + memories) touched.\n  9. dr-2 vs d-3 asymmetry is documented in the atom (e.g. a note in the dispatch section pointing at Q11 rationale).\n\nWrite review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Do NOT modify implementation files. Return verdict='pass' / 'pass-with-notes' / 'fail' with reasoning.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:architect-check', model: 'opus' }
);

return {
  story_id: STORY_ID,
  research,
  implement,
  test,
  review,
  all_files: [
    ...(research?.files || []),
    ...(implement?.files || []),
    ...(test?.files || []),
    ...(review?.files || []),
  ],
};
