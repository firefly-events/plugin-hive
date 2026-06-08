export const meta = {
  name: 'execute-t-3-test-mode-cc-workflows',
  description: 'cc-workflows single-story dispatch for t-3 (test-mode-cc-workflows atom + test-dispatch router)',
  phases: [
    { title: 'research', detail: 'researcher maps plan-mode-cc-workflows shape + execute-dispatch router shape + test-mode-multica per-scenario precedent' },
    { title: 'implement', detail: 'developer creates test-mode-cc-workflows atom (~340 lines) + test-dispatch router (~225 lines)' },
    { title: 'test', detail: 'tester authors resolver vitest + runs no-codex lint + verifies helper-import' },
    { title: 'review', detail: 'reviewer architect-checks per-scenario granularity + router mirror to execute-dispatch + lint compliance' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + files_to_modify + code_examples + design_decisions)
- skills/hive/skills/plan-mode-cc-workflows/SKILL.md (canonical cc-workflows atom shape — 336 lines, your atom mirror target)
- skills/hive/skills/execute-dispatch/SKILL.md (canonical dispatch router shape — 1-219 lines, your router structural mirror anchor)
- skills/hive/skills/test-mode-multica/SKILL.md (per-scenario dispatch precedent — lines 36-43 + 89-99 carry the resolver)
- hive/lib/cc-workflows-preconditions.mjs (Step 0 import target)
- hive/lib/mode-resolver.mjs (router helper consumed by test-dispatch)
- skills/hive/skills/execute-mode-cc-workflows/SKILL.md (lint+model+insight-capture contract reference)

t-1b SHIPPED (yesterday-in-this-epic):
- skills/test/SKILL.md Phase 0 already delegates to skills/hive/skills/test-dispatch/SKILL.md. That router is YOUR deliverable in this story — once you create it, /test invocations work end-to-end.

NO CODEX ROUTING (HARD CONSTRAINT — see s-3 no-codex lint):
- Neither SKILL.md file may contain any of: agentType: literal, codex:codex-rescue reference, or agent_backends config key.
- cc-workflows is an inline-Claude substrate. Codex routing belongs to other modes.

CONTRACT INVARIANTS:
- test-mode-cc-workflows = atom. Dispatch granularity is PER-SCENARIO (architect Q3 ruling), NOT per-persona. Mirror test-mode-multica's lifecycle. Step 0/1/2/3/4/5 shape matches plan-mode-cc-workflows.
- test-dispatch = router. Step 0 invokes resolveMode('HIVE_TEST_MODE', ctx). Returns {mode_decision, sources}. Step 0/1/2 structurally mirrors execute-dispatch.

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
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/plan-mode-cc-workflows/SKILL.md fully. Map: line count, section structure (Step 0 - Step 5), Step 0 import + worktree-isolation check shape, Step 1 dispatch granularity (per-persona), Step 3 episode-marker write target (${'\${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml'}), Step 4 sidecar deferral text, Step 5 aggregate return shape. This is the shape you will mirror for test-mode-cc-workflows — but with PER-SCENARIO granularity instead of per-persona.\n  2. Read skills/hive/skills/test-mode-multica/SKILL.md lines 36-43 and 89-99. Capture the per-scenario dispatch resolver pattern + episode-marker unit ({unit_id} = scenario_id). This is the precedent for swapping per-persona → per-scenario in your atom.\n  3. Read skills/hive/skills/execute-dispatch/SKILL.md lines 1-219. Map Step 0 (env tier > root config > shipped baseline > skill override > default), Step 1 (dispatch to selected mode atom), Step 2 (return {mode_decision, sources}). field_sources tracking shape. This is the shape you will mirror for test-dispatch.\n  4. Read hive/lib/cc-workflows-preconditions.mjs. Capture assertWorktreeIsolation signature + throw conditions.\n  5. Read hive/lib/mode-resolver.mjs. Capture resolveMode signature: what is the first arg ('HIVE_TEST_MODE' = env var name; or is it a different key?), what does ctx contain, what is the return shape ({mode_decision, sources}?). t-3 router calls resolveMode('HIVE_TEST_MODE', ctx).\n  6. Verify s-3 no-codex lint location + assertion set. Confirm which patterns are banned (agentType, codex:codex-rescue, agent_backends).\n  7. Identify whether vitest is the runner per the story spec OR whether node:test convention applies (the repo has both — t-1a/t-1b used node:test; story spec says vitest at skills/hive/skills/test-mode-cc-workflows/test/resolver.test.mjs). Check what plan-mode-cc-workflows uses for its tests, if any.\n  8. verdict='pass' if all 7 items mapped; 'fail' otherwise. Do NOT modify files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:atom-router-mirror-map', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/test-mode-cc-workflows/SKILL.md (~330-360 lines). Mirror plan-mode-cc-workflows shape exactly: Step 0 (precondition gate + helper import + worktree-isolation), Step 1 (PER-SCENARIO serial dispatch via default workflow subagent — replace plan-mode's per-persona pattern), Step 2 (poll-to-terminal), Step 3 (episode marker write to ${'\${HIVE_STATE_DIR}/episodes/{epic_handle}/{scenario_id}/cc-workflows-run.yaml'}), Step 4 (sidecar no-op), Step 5 (aggregate return). HARD constraint: zero agentType literals; zero codex:codex-rescue references; zero agent_backends keys.\n  2. CREATE skills/hive/skills/test-dispatch/SKILL.md (~200-250 lines). Mirror execute-dispatch Step 0/1/2 shape exactly. Step 0 invokes resolveMode('HIVE_TEST_MODE', ctx) per the helper's actual signature (research item 5). Step 1 dispatches to the chosen mode atom (test-mode-cc-workflows, test-mode-multica, etc.). Step 2 returns {mode_decision, sources}.\n  3. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\nReturn the structured file list. verdict='pass' on success. Tester authors the resolver test in the next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:atom-and-router', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch test-runner finding:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/test-mode-cc-workflows/test/resolver.test.mjs (use the runner research confirmed — vitest per story spec OR node:test per codebase convention; if convention diverges from spec, document the choice in notes). Cover the 5-tier resolution (env > root config > shipped baseline > skill override > default) — env should win; absence of env falls to root config; etc. Cover that resolver returns expected mode_decision for each tier and reports the correct source.\n  2. Run the s-3 no-codex lint against BOTH new skills. Capture command + result. Expected: 4/4 PASS (no agentType, no codex:codex-rescue, no agent_backends, plus the helper-import assertion).\n  3. Run the resolver test. Expected: green.\n  4. CREATE .pHive/test-scenarios/t-3-test-mode-cc-workflows-smoke.yaml per test-scenario-schema.md. Cover /test --execution-mode cc-workflows on a known scenario. Verify it loads via loadScenario from hive/lib/scenarios/load.mjs (avoid embedded id:/status: tokens in folded scalars — see hive/agents/memories/reviewer/test-scenario-folded-scalar-pitfall.md).\n  5. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\nReturn the structured file list. verdict='pass' iff resolver test green AND no-codex lint 4/4 green AND scenario YAML loads. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:resolver-and-lint', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. test-mode-cc-workflows atom: structurally mirrors plan-mode-cc-workflows Step 0-5 shape. Dispatch granularity is PER-SCENARIO (NOT per-persona). Step 0 imports cc-workflows-preconditions.mjs + calls assertWorktreeIsolation. Step 3 episode-marker target uses {scenario_id} (or equivalent unit_id), NOT {persona}.\n  2. test-dispatch router: structurally mirrors execute-dispatch Step 0/1/2. Step 0 invokes resolveMode with the correct first-arg + ctx. Step 2 returns {mode_decision, sources}. field_sources tracking shape parity.\n  3. ZERO Codex routing in either file: grep agentType, codex:codex-rescue, agent_backends → 0 hits each. Spot-check each file for residual references.\n  4. Helper imports present: cc-workflows-preconditions.mjs in atom; mode-resolver.mjs in router.\n  5. s-3 no-codex lint passes 4/4 against both files. Helper-import lint passes. (Re-run if useful.)\n  6. Resolver test covers all 5 tiers + returns expected mode_decision + source per tier. Tests green.\n  7. Test scenario YAML loads via loadScenario without VALIDATION_ERROR.\n  8. NO scope drift: only the 4 files in story spec's files_to_modify (plus episode markers + memories) were touched. No skill edits outside the two new files.\n\nWrite review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Do NOT modify implementation files. Return verdict='pass' / 'pass-with-notes' / 'fail' with reasoning.`,
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
