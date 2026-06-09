export const meta = {
  name: 'execute-dr-3-design-review-mode-cc-workflows',
  description: 'cc-workflows single-story dispatch for dr-3 (design-review-mode-cc-workflows atom — 4-step model inside cc-workflows substrate)',
  phases: [
    { title: 'research', detail: 'researcher maps dr-2 atom shape + plan-mode-cc-workflows + execute-mode-cc-workflows as cc-workflows substrate references' },
    { title: 'implement', detail: 'developer creates design-review-mode-cc-workflows/SKILL.md with 4 agent() calls + cc-workflows-preconditions import' },
    { title: 'test', detail: 'tester authors resolver vitest + scenario YAML + adds test to hive/lib/package.json' },
    { title: 'review', detail: 'reviewer architect-checks 4-step preservation + helper import + no-codex lint compliance + flag pass-through' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + files_to_modify + design_decisions)
- hive/workflows/design-review.workflow.yaml lines 8-81 (architectural anchor — 4 steps)
- skills/hive/skills/design-review-mode-multica/SKILL.md (JUST SHIPPED in dr-2 — your direct shape mirror; same 4-step model, different substrate)
- skills/hive/skills/plan-mode-cc-workflows/SKILL.md (canonical cc-workflows atom shape)
- skills/hive/skills/test-mode-cc-workflows/SKILL.md (recent t-3 reference for cc-workflows atom Step 0-5 patterns)
- skills/hive/skills/execute-mode-cc-workflows/SKILL.md (lifecycle reference)
- hive/lib/cc-workflows-preconditions.mjs (Step 0 import target — assertWorktreeIsolation)
- hive/lib/mode-resolver.mjs (5-tier resolver — HIVE_DESIGN_REVIEW_MODE varName)
- skills/hive/skills/design-review-dispatch/SKILL.md (dr-1 router — dispatches to this atom for cc-workflows branch)

dr-2 SHIPPED (just now): design-review-mode-multica atom carries the SAME 4-step model. dr-3 mirrors it INSIDE cc-workflows substrate.

NO CODEX ROUTING (HARD CONSTRAINT — s-3 no-codex lint enforces ALL 4 checks):
- Zero agentType: literal in code blocks
- Zero codex:codex-rescue references in code blocks
- Zero agent_backends keys in code blocks
- assertWorktreeIsolation import from hive/lib/cc-workflows-preconditions.mjs REQUIRED

CONTRACT INVARIANTS:
- 4 agent() calls preserved: accessibility-specialist, animations-specialist, ui-designer (critique), ui-designer (synthesis)
- Each agent() call uses default workflow subagent (no agentType)
- Each agent() call carries opts.model resolved via cc-workflows-model-tier.mjs (per s-5 contract)
- Each agent() prompt ends with the insight-capture suffix template (per execute-mode-cc-workflows contract)
- Phase 0c 5-tier resolution (env > root config > shipped baseline > skill override > default)
- --skip flag: optional steps suppressed; required steps not skippable
- --artifact-target flag: forwarded verbatim to ui-designer agents

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
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/design-review-mode-multica/SKILL.md (dr-2 atom just shipped). Capture: 4-step section structure, agent() call payload pattern, --skip + --artifact-target handling, episode-marker shape. dr-3 mirrors all of this INSIDE cc-workflows substrate.\n  2. Read skills/hive/skills/test-mode-cc-workflows/SKILL.md (t-3 atom). Capture: Step 0 import line + assertWorktreeIsolation() call shape; per-(scenario|step) loop structure; Step 3 episode marker target. dr-3 uses per-step (4 calls inside single run), not per-scenario.\n  3. Read skills/hive/skills/plan-mode-cc-workflows/SKILL.md. Capture: opts.model handling, insight-capture suffix template, ctx.env raw-token contract.\n  4. Read hive/lib/cc-workflows-preconditions.mjs lines 1-80. Capture assertWorktreeIsolation signature and the structured error it throws.\n  5. Read hive/lib/cc-workflows-model-tier.mjs. Capture resolveModelTier signature + return shape. dr-3 uses this for each of the 4 agent() calls.\n  6. Read skills/hive/skills/design-review-dispatch/SKILL.md. Capture the contract dispatch hands to the atom (workflow_path, unblocked, appends_map, epic_handle, hive_config, --skip, --artifact-target).\n  7. Confirm test runner is vitest (per t-3 finding). dr-3 test target: skills/hive/skills/design-review-mode-cc-workflows/test/resolver.test.mjs.\n  8. Confirm s-3 no-codex lint scope: 4 checks against *-mode-cc-workflows/SKILL.md files only. dr-3 is in scope. All 4 checks must PASS.\n  9. verdict='pass' if all 8 items mapped; 'fail' otherwise. Do NOT modify files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:cc-workflows-atom-shape-map', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/design-review-mode-cc-workflows/SKILL.md. Mirror dr-2's 4-step model INSIDE cc-workflows substrate. Required structure:\n     - Step 0: Import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs'; call it. Resolve runtime via Phase 0c 5-tier (env HIVE_DESIGN_REVIEW_MODE > root config > shipped baseline > skill override > default).\n     - Step 1: ONE Workflow tool dispatch carrying 4 agent() calls in order accessibility-specialist → animations-specialist → ui-designer critique → ui-designer synthesis. Each agent() uses default workflow subagent (no agentType). Each agent() carries opts.model via resolveModelTier from cc-workflows-model-tier.mjs. Each agent() prompt ends with insight-capture suffix template (per execute-mode-cc-workflows mandatory clause).\n     - Step 2: Poll Workflow to terminal.\n     - Step 3: Write ONE episode marker at ${'\${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml'} capturing all 4 agent outputs.\n     - Step 4: Sidecar deferral (no-op).\n     - Step 5: Aggregate return.\n  2. --skip + --artifact-target wired through to agent() prompts (per dr-2 semantics).\n  3. ZERO Codex routing surfaces. ZERO agent_backends keys in code blocks. Helper import is REQUIRED for s-3 lint check 4.\n  4. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\nReturn the structured file list. verdict='pass' on success. Tester authors resolver in next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:dr-3-cc-workflows-atom', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/design-review-mode-cc-workflows/test/resolver.test.mjs using vitest. Mirror skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs (dr-2 pattern) but adapted to cc-workflows substrate. Cover:\n     (a) 5-tier resolution (env > root config > shipped baseline > skill override > default)\n     (b) source tracking matches winning tier\n     (c) 4-step dispatch shape — assert atom prescribes 4 agent() calls\n     (d) cc-workflows-preconditions import present (the assertWorktreeIsolation line)\n     (e) cc-workflows-model-tier import + opts.model on every agent() call (regex assertion)\n     (f) insight-capture suffix template present on every agent() prompt\n     (g) ctx.env raw-token footgun\n     (h) no-codex code-block checks (no agentType, no codex:codex-rescue, no agent_backends)\n  2. CREATE .pHive/test-scenarios/dr-3-design-review-mode-cc-workflows-smoke.yaml. Avoid embedded id:/status: tokens in folded scalars. Cover /design-review via cc-workflows substrate with --skip and --artifact-target flags.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND new resolver test path to vitest file list. Preserve existing paths.\n  4. RUN npm test from hive/lib. Confirm full suite green.\n  5. RUN s-3 no-codex lint against the new atom. Confirm all 4 checks PASS.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\nReturn the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green AND s-3 lint 4/4 PASS. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:dr-3-resolver-and-scenario', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. 4-step preservation: 4 agent() calls in order accessibility-specialist → animations-specialist → ui-designer critique → ui-designer synthesis. Matches dr-2 / design-review.workflow.yaml:8-81.\n  2. Step 0 imports assertWorktreeIsolation from hive/lib/cc-workflows-preconditions.mjs and invokes it. s-3 lint check 4 PASS.\n  3. ZERO Codex routing surfaces — grep agentType, codex:codex-rescue, agent_backends in code blocks → 0 hits each. s-3 lint checks 1-3 PASS.\n  4. Every agent() call carries opts.model resolved via resolveModelTier from cc-workflows-model-tier.mjs (s-5 contract). No bare agent() calls without opts.model.\n  5. Every agent() prompt ends with the insight-capture suffix template (execute-mode-cc-workflows mandatory clause).\n  6. Phase 0c 5-tier resolver matches canonical pattern. HIVE_DESIGN_REVIEW_MODE varName. Field-source tracking present.\n  7. --skip + --artifact-target flow through to agent prompts.\n  8. Resolver test covers all 5 tiers + 4-step shape + helper import + opts.model + insight-capture + ctx.env footgun + no-codex checks. Vitest green.\n  9. Test scenario YAML loads via loadScenario.\n  10. hive/lib/package.json scripts.test includes new test path. Full npm test green.\n  11. NO scope drift — only files in story spec's files_to_modify (plus episode markers + memories) touched.\n\nWrite review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Do NOT modify implementation files. Return verdict='pass' / 'pass-with-notes' / 'fail' with reasoning.`,
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
