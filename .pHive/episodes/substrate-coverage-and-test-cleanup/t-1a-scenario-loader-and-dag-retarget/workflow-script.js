export const meta = {
  name: 'execute-t-1a-scenario-loader-and-dag-retarget',
  description: 'cc-workflows single-story dispatch for t-1a (extend loadScenario for execution_results + retarget test-swarm DAG)',
  phases: [
    { title: 'research', detail: 'researcher maps loadScenario shape vs step-03-worker output + DAG topology' },
    { title: 'implement', detail: 'developer builds loader path + retargets test-swarm.workflow.yaml DAG' },
    { title: 'test', detail: 'tester authors vitest covering new loader path + DAG edge assertion' },
    { title: 'review', detail: 'reviewer architect-checks loader choice + DAG retarget + no regression' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + files_to_modify + provenance)
- hive/lib/scenarios/load.mjs (current loadScenario implementation)
- hive/workflows/test-swarm.workflow.yaml (current DAG — note step-03-worker / step-04-inspector edges)
- hive/workflows/steps/test-swarm/step-03-worker.md (the step that emits execution_results — gives you the output schema)

Context (the WHY of this split):
t-1 cc-workflows run wf_7e1dbc8d-328 halted with h3_schema_gap.
loadScenario (hive/lib/scenarios/load.mjs) handles authored scenario YAMLs (intent/walk specs), but step-03-worker outputs execution_results YAML (outcomes — different shape).
Step-04b insertion (t-1b — NOT this story) requires both a loader for the worker-output shape AND a DAG retarget (worker/inspector currently run PARALLEL off author-tests, not sequential).
THIS STORY (t-1a) is the loader + DAG retarget alone. NO step-04b creation. NO --simulated-manual rip. NO skill-mode changes.

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
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read hive/lib/scenarios/load.mjs. Capture loadScenario signature, return shape, fields it expects in input YAML, and any schema validation.\n  2. Read hive/workflows/steps/test-swarm/step-03-worker.md. Identify the output schema written by the worker — file path pattern + top-level fields + nesting. This is the execution_results shape.\n  3. Read hive/workflows/test-swarm.workflow.yaml. Map the DAG edges around step-03-worker and step-04-inspector. Note: are they parallel off step-02-author-tests, or already sequential?\n  4. Decide: extend loadScenario (single function, branches on input shape) vs add sibling loadResults (separate export, same module). Capture the recommendation with reasoning in notes.\n  5. Identify the smallest possible DAG retarget edit to make step-04-inspector depend on step-03-worker (so a future step-04b can slot between them in t-1b).\n  6. Confirm test infrastructure: existing tests live at hive/lib/scenarios/__tests__/ or hive/lib/scenarios/test/. Capture the exact convention.\n  7. verdict='pass' if all 6 items mapped; 'fail' otherwise. Do NOT modify files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:loader-and-dag-map', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. Per the research recommendation, implement EITHER:\n     (a) extend hive/lib/scenarios/load.mjs::loadScenario to accept the execution_results shape (branching on a discriminator), OR\n     (b) add a sibling export loadResults in hive/lib/scenarios/load.mjs that handles execution_results specifically.\n     Use the worker-output schema identified in research as the contract. The loader must return a structured object — match the existing loadScenario return-shape style.\n  2. Retarget hive/workflows/test-swarm.workflow.yaml: ensure step-04-inspector lists step-03-worker as a depends_on (or the equivalent edge form used in this repo). DO NOT add step-04b — that is t-1b's responsibility.\n  3. Verify no regression to the existing authored-scenario flow: loadScenario behavior on authored-scenario input must remain unchanged (smoke a dry run mentally and document).\n  4. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml per hive/references/episode-schema.md.\n\nReturn the structured file list (loader file modified + workflow YAML modified + episode marker). Set verdict='pass' on success. The tester step authors the test file — do NOT write tests here.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:loader-and-dag', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch test-convention notes:\n${research?.notes || ''}\n\nTASK:\n  1. Inspect the modified hive/lib/scenarios/load.mjs to understand its new API.\n  2. Author tests at the path matching repo convention (hive/lib/scenarios/__tests__/load.test.mjs or hive/lib/scenarios/test/load.test.mjs — match what research found). Cover:\n     (a) loader returns the expected structured shape against a worker-output fixture\n     (b) authored-scenario flow still passes (no regression)\n     (c) malformed input rejected with a clear error\n  3. Author a small assertion test against hive/workflows/test-swarm.workflow.yaml confirming step-04-inspector lists step-03-worker as depends_on (parse the YAML, walk the steps array).\n  4. RUN the tests. Confirm green. Note the command + result in notes.\n  5. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\nReturn the structured file list. verdict='pass' iff all tests run green; 'fail' with failing assertion otherwise. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:loader-and-dag', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Loader choice (extend vs sibling) is justified by the research recommendation and the actual schema delta. No over-engineering.\n  2. The loader produces an output shape consistent with what step-04b (t-1b) will need to consume — i.e., the loader's return type lines up with how an inspector / replay step would index the worker's results.\n  3. DAG retarget: step-04-inspector now depends on step-03-worker. Edge form matches existing patterns in test-swarm.workflow.yaml. No accidental break of other edges.\n  4. No regression: authored-scenario flow through loadScenario still passes its existing tests.\n  5. Tests are green and cover the three acceptance criteria from the story spec.\n  6. NOTHING out of t-1a's scope was changed: no step-04b created, no --simulated-manual rip, no skill modifications, no cross-cutting-concerns edit.\n\nWrite review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Do NOT modify implementation files. Return verdict='pass' / 'pass-with-notes' / 'fail' with reasoning.`,
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
