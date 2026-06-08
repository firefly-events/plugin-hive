export const meta = {
  name: 'execute-t-1b-step-04b-and-rip-simulated-manual',
  description: 'cc-workflows single-story dispatch for t-1b (create step-04b-scenario-replay + hard-rip --simulated-manual flag + retire cross-cutting-concerns block)',
  phases: [
    { title: 'research', detail: 'researcher maps current --simulated-manual surface + skill structure + DAG insertion point' },
    { title: 'implement', detail: 'developer creates step-04b step file, rips flag + resolver from skills/test/SKILL.md, retires CCC block, wires workflow step' },
    { title: 'test', detail: 'tester authors step-04b unit tests + asserts flag rip via unknown-flag check' },
    { title: 'review', detail: 'reviewer architect-checks step placement + CCC retirement + skill pipeline table + no regression' },
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

NO-GIT CONTRACT: Do NOT run git add/commit/push. Return your structured file list (created + modified + deleted). The orchestrator owns commits.

READ FIRST:
- Your persona at hive/agents/<your-role>.md
- The story spec at ${STORY_PATH} (acceptance_criteria + files_to_modify)
- skills/test/SKILL.md (current --simulated-manual handling + HIVE_TEST_MODE resolver + pipeline table)
- hive/workflows/test-swarm.workflow.yaml (current DAG — validate-coverage now depends on execute-platform-a per t-1a)
- hive/workflows/steps/test-swarm/step-04-inspector.md (existing inspector step file — pattern reference)
- hive/lib/scenarios/load.mjs (loadResults sibling added in t-1a — the loader you consume)
- .pHive/cross-cutting-concerns.yaml (the simulated-manual block to retire)
- hive/agents/memories/researcher/scenarios-test-path-and-runner-mismatch.md (test convention: node:test + __tests__/)
- hive/agents/memories/reviewer/dag-edge-keyed-by-step-id-not-step-file.md (workflow keys edges by step id, not step_file)

CRITICAL NAMING RECONCILIATION (from t-1a findings):
- Story spec uses path "hive/workflows/steps/test-swarm/step-04b-scenario-replay.md" — that's the step_file name, correct as written.
- The workflow STEP ID (the key used in test-swarm.workflow.yaml depends_on graph) should follow the existing convention. Existing workflow step IDs: author-tests, execute-platform-a, execute-platform-b, validate-coverage, file-bugs, triage-failures, compile-report, gather-context, verify-baseline. Pick a step id that follows this pattern — recommend "scenario-replay" or "replay-scenarios" (descriptive, hyphenated, lowercase). Do NOT name the workflow step id "step-04b" — that's the file name only.
- The step file path follows step-XX-NAME.md form per existing test-swarm step files.

t-1a SHIPPED:
- hive/lib/scenarios/load.mjs now exports loadResults (sibling to loadScenario). loadResults parses execution_results envelope from execute-platform-a output at .pHive/test-artifacts/{epic-id}/{story-id}/results.yaml.
- DAG: validate-coverage now depends_on [execute-platform-a]. step-04b slots BETWEEN execute-platform-a and validate-coverage — so execute-platform-a feeds step-04b feeds validate-coverage.

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

Skip the capture entirely if nothing on this turn is reusable across stories. Do NOT write a memory just to satisfy this clause; empty captures pollute the memory dir. Fire-and-forget — do not block your return on the write. If the directory does not exist, create it.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/test/SKILL.md. Map: (a) --simulated-manual flag handling (story spec cites lines 14-93), (b) HIVE_TEST_MODE inline resolver (lines 37-51), (c) pipeline table (lines 109-119), (d) any other surface where the flag is referenced.\n  2. Read .pHive/cross-cutting-concerns.yaml. Locate the simulated-manual concern block (story spec cites lines 99-126). Note exact start/end line numbers and what the replacement historical note should look like.\n  3. Read hive/workflows/steps/test-swarm/step-04-inspector.md. Capture the step-file structure (frontmatter, sections, contract format) — step-04b will mirror this shape.\n  4. Decide step file path AND workflow step id:\n     - step file: hive/workflows/steps/test-swarm/step-04b-scenario-replay.md (per story spec)\n     - workflow step id: pick from the existing convention (lowercase hyphenated, descriptive — e.g. \"scenario-replay\" or \"replay-results\"). Justify your choice.\n  5. Map the DAG insertion: step-04b's workflow step depends_on [execute-platform-a]. validate-coverage's current depends_on [execute-platform-a] must change to depends_on [<new-step-id>]. Identify any other consumers of execute-platform-a that need rewiring.\n  6. Confirm loadResults API from hive/lib/scenarios/load.mjs: signature, return shape, error modes. step-04b will consume it.\n  7. Identify the substrate-selection delegation target: when ripping the inline HIVE_TEST_MODE resolver, the story spec says \"delegate substrate selection to test-dispatch\". Verify the path skills/hive/skills/test-dispatch/SKILL.md or wherever test-dispatch lives. Confirm the Phase 0 invocation pattern used by other skills (e.g. skills/execute/SKILL.md Phase 0 dispatch invocation).\n  8. verdict='pass' if all 7 items mapped; 'fail' otherwise. Do NOT modify files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:flag-rip-and-step-04b-map', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK (follow the research recommendations for naming + insertion point):\n  1. CREATE hive/workflows/steps/test-swarm/step-04b-scenario-replay.md. Mirror the structure of step-04-inspector.md. The step:\n     (a) consumes the execute-platform-a output (results.yaml) via loadResults from hive/lib/scenarios/load.mjs\n     (b) replays the scenario outcomes for downstream consumers\n     (c) emits inputs that validate-coverage will consume (define the contract in the step file)\n  2. MODIFY hive/workflows/test-swarm.workflow.yaml:\n     (a) ADD a new workflow step (use the step id picked by research, e.g. scenario-replay) with step_file: hive/workflows/steps/test-swarm/step-04b-scenario-replay.md, depends_on: [execute-platform-a]\n     (b) CHANGE validate-coverage depends_on from [execute-platform-a] to [<new-step-id>]\n     (c) Wire inputs per the new step contract\n  3. MODIFY skills/test/SKILL.md:\n     (a) RIP --simulated-manual flag handling (research-cited lines)\n     (b) RIP inline HIVE_TEST_MODE resolver (research-cited lines)\n     (c) ADD Phase 0 invocation of test-dispatch (per the pattern research found)\n     (d) UPDATE pipeline table to reflect swarm-only flow with step-04b\n  4. MODIFY .pHive/cross-cutting-concerns.yaml:\n     (a) RETIRE simulated-manual concern block (research-cited lines)\n     (b) REPLACE with a single \"scenario-replay-folded\" historical note pointing at step-04b\n  5. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml per hive/references/episode-schema.md.\n\nReturn the structured file list. verdict='pass' on success. The tester step authors the test file — do NOT write tests here.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:step-04b-and-flag-rip', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nTASK:\n  1. Inspect the new step-04b-scenario-replay.md to understand its contract.\n  2. Author hive/workflows/steps/test-swarm/__tests__/step-04b-scenario-replay.test.mjs (double-underscore __tests__, node:test runner — per existing repo convention NOT vitest, NOT test/). Cover:\n     (a) step-04b loadResults invocation with valid worker output\n     (b) step-04b handling of missing results.yaml\n     (c) step-04b output shape consumed by validate-coverage\n  3. Author a workflow-YAML assertion test verifying:\n     (a) the new step exists in test-swarm.workflow.yaml with depends_on: [execute-platform-a]\n     (b) validate-coverage now depends_on the new step id (not execute-platform-a directly)\n  4. Manual --simulated-manual rip verification: simulate skills/test/SKILL.md parsing the flag (read the post-rip SKILL.md and grep for \"--simulated-manual\" — should be absent). Document in notes.\n  5. RUN the unit tests. Confirm green. Note command + result in notes.\n  6. Author .pHive/test-scenarios/t-1b-step-04b-and-rip-simulated-manual.yaml per test-scenario-schema.md covering /test swarm-only invocation + scenario-replay execution.\n  7. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\nReturn the structured file list. verdict='pass' iff all tests run green AND --simulated-manual is absent from skills/test/SKILL.md; 'fail' otherwise. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:step-04b-and-flag-rip', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. step-04b-scenario-replay.md follows the existing step file pattern (frontmatter + section structure matching step-04-inspector.md).\n  2. Workflow step insertion is correct:\n     (a) new step id depends_on [execute-platform-a]\n     (b) validate-coverage depends_on the new step id (NOT execute-platform-a — that edge is severed)\n     (c) no orphaned edges; no double-fan-in mistakes\n  3. loadResults from t-1a is properly consumed by step-04b. The execute-platform-a → step-04b → validate-coverage chain has correct input wiring.\n  4. skills/test/SKILL.md edits:\n     (a) --simulated-manual flag is fully removed (no residual references)\n     (b) HIVE_TEST_MODE inline resolver is gone — delegation to test-dispatch is wired via Phase 0\n     (c) pipeline table reflects swarm-only flow including step-04b\n  5. cross-cutting-concerns.yaml: simulated-manual block retired and replaced with a brief historical note. No information loss for future readers.\n  6. test-scenario YAML at .pHive/test-scenarios/t-1b-*.yaml exists and follows test-scenario-schema.md.\n  7. Tests are green. The flag-absence check is mechanical (grep on the post-rip file). DAG assertions match the implementation.\n  8. NO regression to: execute-platform-a output contract, validate-coverage input contract, compile-report fan-in.\n  9. NO scope drift: only the files in story spec's files_to_modify list (or close cousins) were touched.\n\nWrite review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Do NOT modify implementation files. Return verdict='pass' / 'pass-with-notes' / 'fail' with reasoning.`,
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
