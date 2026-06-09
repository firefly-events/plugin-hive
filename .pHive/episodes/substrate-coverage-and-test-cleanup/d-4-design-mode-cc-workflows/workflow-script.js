export const meta = {
  name: 'execute-d-4-design-mode-cc-workflows',
  description: 'cc-workflows single-story dispatch for d-4 (design-mode-cc-workflows atom — mirror plan-mode-cc-workflows + helper import + no-codex compliance)',
  phases: [
    { title: 'research', detail: 'researcher maps plan-mode-cc-workflows atom shape + per-persona resolution from d-1 Phase A toggle' },
    { title: 'implement', detail: 'developer creates design-mode-cc-workflows/SKILL.md (~330-360 lines) mirroring plan-mode-cc-workflows; Step 0 helper import; no Codex routing' },
    { title: 'test', detail: 'tester authors resolver vitest (5-tier + per-persona dispatch + helper-import + no-codex code-block checks) + smoke scenario + s-3 lint run' },
    { title: 'review', detail: 'reviewer architect-checks plan-mode-cc-workflows mirror + lint compliance + helper-import + intentional symmetry with dr-3' },
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
- The story spec at ${STORY_PATH}
- skills/hive/skills/plan-mode-cc-workflows/SKILL.md (CANONICAL cc-workflows atom shape; Step 0 helper-import; opts.model resolveModelTier; per-persona pattern; no-codex contract; insight-capture suffix)
- skills/hive/skills/design-mode-multica/SKILL.md (d-3 — sister atom, just shipped; per-persona dispatch with toggle-driven persona set)
- skills/hive/skills/design-review-mode-cc-workflows/SKILL.md (dr-3 — mirror reference for cc-workflows atom shape; preserves 4-step workflow.yaml model)
- skills/hive/skills/review-mode-cc-workflows/SKILL.md (r-3 — solo reviewer thin wrapper; reference for SOLO dispatch shape — d-4 is per-persona but anatomy similar)
- skills/design/SKILL.md (d-1 just shipped — Phase 0 wiring + Phase A persona pipeline with --include-constraints toggle; the cc-workflows branch hands off to design-mode-cc-workflows)
- skills/hive/skills/design-dispatch/SKILL.md (d-2 router)
- hive/lib/cc-workflows-preconditions.mjs (s-4 — assertWorktreeIsolation Step 0 invariant)
- hive/lib/cc-workflows-model-tier.mjs (s-5 — resolveModelTier for opts.model on every agent() call)
- hive/lib/mode-resolver.mjs (HIVE_DESIGN_MODE registered)
- hive/scripts/lint-cc-workflows-no-codex.mjs (s-3 lint — 4 checks against *-mode-cc-workflows atoms; d-4 IS in scope)

d-1 SHIPPED: /design has Phase 0 + Phase A persona pipeline with --include-constraints toggle.
d-2 SHIPPED: design-dispatch router.
d-3 SHIPPED: design-mode-multica atom (per-persona dispatch on Multica substrate).

KEY DESIGN DECISIONS:
- Atom structurally mirrors plan-mode-cc-workflows (per-persona dispatch via Workflow tool).
- Step 0 imports assertWorktreeIsolation from hive/lib/cc-workflows-preconditions.mjs.
- Zero Codex routing — s-3 lint enforces 4 checks (agentType-literal, codex-rescue-grep, agent_backends-grep, helper-import-grep).
- opts.model REQUIRED on every documented agent() call — resolveModelTier(persona, { config }) from hive/lib/cc-workflows-model-tier.mjs.
- Toggle ON from d-1 Phase A → persona set [accessibility-specialist, animations-specialist, ui-designer] dispatched serially via Workflow tool's pipeline()/phase() pattern.
- Toggle OFF → persona set [ui-designer] only.
- INTENTIONAL SYMMETRY with dr-3 (both cc-workflows atoms use the same canonical shape); INTENTIONAL ASYMMETRY with d-3 (different substrate, different dispatch surface but same persona resolution from d-1).

CONTRACT INVARIANTS:
- Single Workflow tool run per /design dispatch with one agent() call per persona (serial via pipeline()/phase())
- Step 0: assertWorktreeIsolation() invocation (s-4 helper import + call)
- Episode marker target: \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml
- s-3 lint 4/4 PASS on the new atom file
- Phase 0c 5-tier resolution (env HIVE_DESIGN_MODE > root config execution.design_mode > shipped baseline > skill override > default)
- No-git contract enforced via per-persona prompts (orchestrator commits after return)
- opts.model on every documented agent() call

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/plan-mode-cc-workflows/SKILL.md FULL. Capture: H1+summary, state dir resolution, invocation contract, Step 0 precondition (helper import + assertWorktreeIsolation), Step 1 per-persona dispatch via Workflow tool (assembled script with phase() per persona + agent() per persona with opts.model from resolveModelTier), Step 2 poll-to-terminal, Step 3 episode marker, Step 4 sidecar deferral, Reconciliation pattern, Configuration block, Reuses, Constraint summary table, Insight-capture suffix template on every documented agent() prompt.\n  2. Read skills/hive/skills/design-mode-multica/SKILL.md (d-3, just shipped). Capture: persona set resolution from d-1 Phase A toggle (ON=3, OFF=1), prior-outputs flow-forward map, per-persona briefs structure. d-4 uses the SAME persona resolution logic but dispatches via Workflow tool instead of Multica.\n  3. Read skills/hive/skills/design-review-mode-cc-workflows/SKILL.md (dr-3). Capture full atom prose patterns; this is the mirror for cc-workflows atom anatomy (though dr-3 prescribes 4 agent() calls for workflow.yaml mirror; d-4 prescribes N=1 or 3 based on toggle).\n  4. Read skills/hive/skills/review-mode-cc-workflows/SKILL.md (r-3). Capture: SOLO single-agent dispatch as a reference for what d-4 reduces to when toggle OFF.\n  5. Read skills/design/SKILL.md (post d-1). Confirm Phase 0 hands off to design-mode-cc-workflows when mode_decision=cc-workflows; --include-constraints toggle flows through.\n  6. Read skills/hive/skills/design-dispatch/SKILL.md (d-2). Confirm inputs/outputs contract.\n  7. Read hive/lib/cc-workflows-preconditions.mjs. Confirm assertWorktreeIsolation export + import path '../../../hive/lib/cc-workflows-preconditions.mjs'.\n  8. Read hive/lib/cc-workflows-model-tier.mjs. Confirm resolveModelTier(persona, { config }) signature. For d-4, the personas to resolve are: accessibility-specialist, animations-specialist, ui-designer.\n  9. Read hive/scripts/lint-cc-workflows-no-codex.mjs. Reconfirm the 4 checks (s-3 lint) — d-4 must pass all 4.\n  10. Identify dispatch shape: ONE Workflow tool run per /design dispatch, internal pipeline()/phase() chain executing N personas serially (N=1 or 3 based on toggle). Each agent() call carries opts.model + insight-capture suffix.\n  11. Confirm HIVE_DESIGN_MODE registered in hive/lib/mode-resolver.mjs.\n  12. Confirm vitest as runner; resolver test path skills/hive/skills/design-mode-cc-workflows/test/resolver.test.mjs.\n  13. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml.\n\n  verdict='pass' if all 13 items mapped; 'fail' otherwise. Do NOT modify source files (research marker + insight memory only).`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:cc-workflows-atom-shape-and-design-toggle', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/design-mode-cc-workflows/SKILL.md (target ~330-360 lines per story spec). STRUCTURE (mirror plan-mode-cc-workflows precisely; adapt persona set to /design Phase A toggle):\n     - H1 + short summary: atomic skill, NOT inline /design prose. Runs /design through the cc-workflows substrate as per-persona Workflow tool dispatch.\n     - State directory resolution block (HIVE_STATE_DIR).\n     - Invocation contract: inputs from design-dispatch (arguments incl. --include-constraints, field_sources, epic_id, persona_set resolved from d-1 Phase A toggle). Outputs ONE episode marker per persona at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml + sidecar .messages.jsonl.\n     - Step 0: Precondition gate. IMPORT assertWorktreeIsolation from '../../../hive/lib/cc-workflows-preconditions.mjs' and INVOKE it. Reject with structured precondition_failed on failure. Do NOT silently fall through.\n     - Step 1: Per-unit dispatch via Workflow tool. Construct script in memory: meta block, defensive args parse (const a = typeof args === 'string' ? JSON.parse(args) : args;), per-persona phase()+agent() chain. Toggle ON → 3 phases (accessibility, animations, ui-designer) serial via pipeline()/sequential agent() calls; prior outputs flow forward as prepended constraint blocks. Toggle OFF → 1 phase (ui-designer) only. EVERY agent() call carries opts.model resolved via resolveModelTier(persona, { config: hive_config }) — import from '../../../hive/lib/cc-workflows-model-tier.mjs'. EVERY documented agent() prompt carries the insight-capture suffix template (persona-substituted).\n     - Step 2: Poll until terminal (per Workflow tool). Map completed/failed/cancelled → passed/failed/cancelled per execute-mode-cc-workflows precedent.\n     - Step 3: Episode marker per persona at cc-workflows-run.yaml. Sidecar .messages.jsonl alongside.\n     - Step 4: Sidecar deferral pattern.\n     - Reconciliation pattern: orchestrator commits after skill returns file lists.\n     - Configuration block (HIVE_DESIGN_MODE env, execution.design_mode config).\n     - Reuses (atomic deps): hive/lib/cc-workflows-preconditions.mjs, hive/lib/cc-workflows-model-tier.mjs, hive/lib/task-tracking-dispatch, hive/references/episode-schema.md, hive/agents/accessibility-specialist.md, hive/agents/animations-specialist.md, hive/agents/ui-designer.md, skills/hive/skills/plan-mode-cc-workflows/SKILL.md (mirror anchor).\n     - Constraint summary table (atomic skill; Workflow TOOL vs /workflows slash; skill does NOT run git commit; NO Codex routing; no-git contract enforced via per-persona prompt; per-persona dispatch — toggle dictates count; fixed outer seam).\n     - Failure modes block (precondition_failed; Workflow timeout; persona agent crash; toggle inconsistency).\n     - Target length: 330-360 lines per story spec.\n  2. CRITICAL NO-CODEX HYGIENE for fenced code blocks (s-3 lint will run):\n     - NO agentType: codex:codex-rescue assignment anywhere in code blocks.\n     - NO codex:codex-rescue literal substring in code blocks.\n     - NO agent_backends grep hit in code blocks.\n     - DO include the helper import in a code block: \`import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';\` so Check 4 passes.\n  3. Write implement episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:design-mode-cc-workflows-per-persona', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/design-mode-cc-workflows/test/resolver.test.mjs using vitest. Mirror skills/hive/skills/design-review-mode-cc-workflows/test/resolver.test.mjs (dr-3 pattern) and skills/hive/skills/design-mode-multica/test/resolver.test.mjs (d-3 pattern). Cover:\n     (a) 5-tier resolution (env HIVE_DESIGN_MODE > root config execution.design_mode > shipped baseline > skill override > default).\n     (b) source tracking matches winning tier.\n     (c) Per-persona dispatch shape — assert atom prescribes pipeline()/phase() chain with one agent() per persona (NOT single-bundle). Grep SKILL.md for serial-per-persona loop.\n     (d) Toggle ON → 3 phases (accessibility, animations, ui-designer) — count assertion + order assertion via prose grep.\n     (e) Toggle OFF → 1 phase (ui-designer) — count assertion.\n     (f) cc-workflows-model-tier import + opts.model on EVERY documented agent() call (regex).\n     (g) Step 0 helper import — assertWorktreeIsolation imported + invoked (substring assertion).\n     (h) Insight-capture suffix template on every documented agent() prompt (regex).\n     (i) ctx.env raw-token footgun.\n     (j) No-codex code-block checks — atom has 0 hits on agentType:codex:codex-rescue, codex:codex-rescue literal, agent_backends in fenced blocks.\n     (k) Episode marker target cc-workflows-run.yaml at per-persona unit_id.\n     (l) Intentional symmetry with dr-3 + intentional asymmetry with d-3 documented in prose (one explicit mention of each).\n  2. CREATE .pHive/test-scenarios/d-4-design-mode-cc-workflows-smoke.yaml per test-scenario-schema. Cover /design --include-constraints via cc-workflows substrate producing 3 episode markers; AND /design (no flag) producing 1 marker. Avoid embedded id:/status: tokens in folded scalars.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND new resolver test path to vitest file list.\n  4. RUN npm test from hive/lib. Confirm full suite green. Capture count.\n  5. RUN s-3 no-codex lint: node hive/scripts/lint-cc-workflows-no-codex.mjs. Confirm 4 checks PASS for design-mode-cc-workflows/SKILL.md. If any check fails, note exact failure.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green AND s-3 lint 4/4 PASS. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:d-4-resolver-and-scenario-and-lint', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Plan-mode-cc-workflows mirror: design-mode-cc-workflows/SKILL.md mirrors plan-mode-cc-workflows step shape (Step 0 precondition + Step 1 per-unit dispatch + Step 2 poll + Step 3 marker + Step 4 sidecar + Reconciliation + Configuration + Constraint summary).\n  2. Step 0 helper import: assertWorktreeIsolation imported from '../../../hive/lib/cc-workflows-preconditions.mjs' and invoked. s-3 Check 4 PASS.\n  3. ZERO Codex routing in code blocks: lint 4/4 PASS (Checks 1-3 on agentType, codex:codex-rescue, agent_backends — all 0 hits in fenced blocks). Prose mentions in prohibition statements OK (lint scopes code blocks only per r-3 finding).\n  4. opts.model on EVERY documented agent() call via resolveModelTier(persona, { config }).\n  5. Insight-capture suffix template present on every documented agent() prompt example.\n  6. Per-persona dispatch from d-1 Phase A toggle: ON=3 phases serial accessibility → animations → ui-designer; OFF=1 phase ui-designer. Prior outputs flow forward (constraints prepended).\n  7. Phase 0c 5-tier resolver matches canonical pattern. HIVE_DESIGN_MODE varName.\n  8. Intentional symmetry with dr-3 documented (both cc-workflows atoms use same canonical shape).\n  9. Intentional asymmetry with d-3 documented (different substrate but same persona resolution from d-1).\n  10. Resolver test covers all 12 listed assertions. npm test green at hive/lib. s-3 lint 4/4 PASS.\n  11. Line count target met (330-360; small +/- acceptable per d-3 precedent at 491).\n  12. NO regression in prior shipped atoms (file scope: design-mode-cc-workflows/ + test/ + smoke scenario + hive/lib/package.json scripts.test only).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:d-4-cc-workflows-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
