export const meta = {
  name: 'execute-r-3-review-mode-cc-workflows',
  description: 'cc-workflows single-story dispatch for r-3 (review-mode-cc-workflows atom — thin wrapper for solo reviewer dispatch + Step 0 helper import + no-codex compliance)',
  phases: [
    { title: 'research', detail: 'researcher maps plan-mode-cc-workflows atom shape + r-2 multica mirror + Step 0 helper-import pattern from s-4' },
    { title: 'implement', detail: 'developer creates review-mode-cc-workflows/SKILL.md as thin wrapper — Step 0 assertWorktreeIsolation, single reviewer agent, no Codex routing' },
    { title: 'test', detail: 'tester authors resolver vitest (5-tier + solo dispatch + helper-import + no-codex code-block checks) + smoke scenario + s-3 lint run' },
    { title: 'review', detail: 'reviewer architect-checks thin-wrapper shape + helper import + no-codex compliance + scope_drift preservation' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + design_decisions + Decision Point 2 panel-mode-deferred rationale)
- skills/hive/skills/plan-mode-cc-workflows/SKILL.md (CANONICAL cc-workflows atom shape; Step 0 helper-import pattern; opts.model resolveModelTier pattern; no-codex contract; insight-capture suffix template)
- skills/hive/skills/test-mode-cc-workflows/SKILL.md (per-scenario mirror — closer in single-agent dispatch shape)
- skills/hive/skills/design-review-mode-cc-workflows/SKILL.md (dr-3, just shipped — 4-step mirror but useful for full atom prose pattern)
- skills/hive/skills/review-mode-multica/SKILL.md (r-2, just shipped — SISTER atom; r-3 mirrors r-2's solo-reviewer thin-wrapper shape but on cc-workflows substrate instead of Multica)
- skills/hive/skills/review-dispatch/SKILL.md (r-1 router that dispatches into r-3 — capture: env var HIVE_REVIEW_MODE, workflow_name 'code-review', argument forwarding contract, scope_drift contract obligation)
- skills/review/SKILL.md Phase 0 + Phase 1 (the inline solo-reviewer behavior that r-3 must preserve when dispatched through cc-workflows)
- hive/lib/cc-workflows-preconditions.mjs (s-4 helper — assertWorktreeIsolation is the Step 0 invariant)
- hive/lib/cc-workflows-model-tier.mjs (s-5 helper — resolveModelTier for opts.model on every agent() call)
- hive/lib/mode-resolver.mjs (canonical 5-tier resolver — confirm HIVE_REVIEW_MODE is registered)
- hive/scripts/lint-cc-workflows-no-codex.mjs (s-3 lint — 4 checks against *-mode-cc-workflows atoms; r-3 IS in scope)

r-1 SHIPPED (Slice 5): review-dispatch router exists; r-3 is what the cc-workflows branch of dispatch routes to.
r-2 SHIPPED: review-mode-multica is the Multica sister atom; r-3 is the cc-workflows mirror.

KEY DESIGN DECISIONS:
- Thin wrapper, NO panel-mode (Decision Point 2 DEFERS panel; solo reviewer only).
- Step 0 imports assertWorktreeIsolation from hive/lib/cc-workflows-preconditions.mjs (s-4 helper).
- Zero Codex routing — s-3 lint enforces (4 checks: agentType-literal, codex-rescue-grep, agent-backends-grep, helper-import-grep).
- opts.model resolved via resolveModelTier from hive/lib/cc-workflows-model-tier.mjs on every agent() call inside the atom's documented script template.
- Insight-capture suffix template present on every documented agent() prompt (per execute-mode-cc-workflows mandatory clause).

CONTRACT INVARIANTS:
- Single reviewer agent() call inside the dispatched Workflow run (solo)
- Step 0: assertWorktreeIsolation() invocation (s-4 helper import + call)
- Episode marker target: \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml
- scope_drift emit at review:complete owned by atom (per r-1 contract; mirror r-2's design — the dispatched reviewer agent emits inside its prompt-driven run)
- Phase 0c 5-tier resolution (env > root config > shipped baseline > skill override > default) for HIVE_REVIEW_MODE
- s-3 lint 4/4 PASS on the new atom file
- No-git contract enforced via reviewer prompt (orchestrator commits after return)

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/plan-mode-cc-workflows/SKILL.md FULL. Capture the canonical atom anatomy: invocation contract, Step 0 precondition gate (helper import + assertWorktreeIsolation call), Step 1 per-unit dispatch (Workflow assembly + dispatch + poll + marker write), Step 2-N (as applicable), no-Codex constraint table, insight-capture suffix template, opts.model resolveModelTier pattern.\n  2. Read skills/hive/skills/review-mode-multica/SKILL.md (r-2, just shipped). Capture: thin-wrapper shape (Steps 0-5 from execute-mode-multica), solo reviewer dispatch, scope_drift_observed: null deliberate confirmation, --sequential pass-through.\n  3. Read skills/hive/skills/design-review-mode-cc-workflows/SKILL.md (dr-3). Capture full atom prose patterns: opts.model wiring, insight-capture suffix on every documented agent() prompt, no-codex code-block hygiene.\n  4. Read skills/hive/skills/test-mode-cc-workflows/SKILL.md (t-3) — single-agent cc-workflows mirror; closer in dispatch shape to r-3.\n  5. Read skills/hive/skills/review-dispatch/SKILL.md (r-1). Capture: inputs forwarded, scope_drift contract obligation note (atom owns the emit at review:complete).\n  6. Read skills/review/SKILL.md Phase 1 — capture the SOLO reviewer pattern r-3 must preserve when dispatched through cc-workflows.\n  7. Confirm HIVE_REVIEW_MODE registered in hive/lib/mode-resolver.mjs (already verified by r-2 research; reconfirm reference).\n  8. Read hive/scripts/lint-cc-workflows-no-codex.mjs — capture the 4 checks (agentType-literal-ast, codex-rescue-grep, agent-backends-grep, helper-import-grep). r-3 is IN SCOPE (atom name pattern *-mode-cc-workflows).\n  9. Read hive/lib/cc-workflows-preconditions.mjs — confirm assertWorktreeIsolation export + import statement shape.\n  10. Read hive/lib/cc-workflows-model-tier.mjs — confirm resolveModelTier(persona, { config }) signature; capture personas r-3 will reference (researcher, reviewer; r-3 atom's documented script template typically prescribes a single reviewer phase with optional research/implement/test phases for the *workflows that USE the atom*; but r-3 itself is a SOLO reviewer atom — the documented template inside r-3 SHOULD prescribe ONE reviewer agent() call).\n  11. Identify the canonical dispatch shape for r-3: ONE Workflow tool invocation per /review trigger, ONE agent() call inside (reviewer persona), ONE cc-workflows-run.yaml marker per dispatch.\n  12. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml capturing findings in notes.\n\n  verdict='pass' if all 12 items mapped clearly; 'fail' otherwise. Do NOT modify any source files (research marker + insight memory only).`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:cc-workflows-atom-shape-and-solo-reviewer-contract', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/review-mode-cc-workflows/SKILL.md. Thin wrapper for solo reviewer dispatch on cc-workflows substrate. STRUCTURE (mirror plan-mode-cc-workflows / test-mode-cc-workflows / design-review-mode-cc-workflows; adapt to SOLO shape from r-2):\n     - H1 + short summary block: atomic skill, NOT inline /review prose. Runs /review through the cc-workflows substrate as a single (solo) reviewer Workflow tool dispatch.\n     - State directory resolution block: HIVE_STATE_DIR = hive_config.paths.state_dir || '.pHive'.\n     - Invocation contract: inputs from review-dispatch (arguments, field_sources, optional epic_id, optional unblocked_stories[] for /review-as-execute-leg). Outputs episode marker at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/cc-workflows-run.yaml + sidecar .messages.jsonl.\n     - Step 0: Precondition gate. MUST import and invoke assertWorktreeIsolation from hive/lib/cc-workflows-preconditions.mjs. Reject with structured precondition_failed on cwd mismatch; do NOT silently fall through.\n     - Step 1: Per-unit dispatch (serial within depth). Construct Workflow tool script: ONE phase ('review') with ONE agent() call to the reviewer persona. opts.model REQUIRED — import resolveModelTier from hive/lib/cc-workflows-model-tier.mjs; default reviewer tier from hive_config.model_tiers.reviewer or fallback opus. Defensive args parse contract: const a = typeof args === 'string' ? JSON.parse(args) : args; reference inputs via a.<field>.\n     - Step 2: Poll until terminal — map Workflow completed/failed/cancelled → passed/failed/cancelled.\n     - Step 3: Episode marker per terminal — write cc-workflows-run.yaml with reviewer verdict, evidence_ref (PR comment thread or transcript dir), scope_drift_observed: true (atom OWNS the emit per r-1 contract; dispatched reviewer agent calls emit_scope_drift at review:complete inside its prompt-driven run).\n     - Step 4: Sidecar deferral pattern (from execute-mode-cc-workflows).\n     - Reconciliation pattern (from execute-mode-cc-workflows): orchestrator commits after skill returns the file-list payloads.\n     - Failure modes block.\n     - Configuration block (HIVE_REVIEW_MODE env, execution.review_mode config).\n     - Reuses (atomic deps): list hive/lib/cc-workflows-preconditions.mjs, hive/lib/cc-workflows-model-tier.mjs, hive/lib/task-tracking-dispatch, hive/references/episode-schema.md, hive/agents/reviewer.md.\n     - Constraint summary table (atomic skill; Workflow TOOL vs /workflows slash distinction load-bearing; skill does NOT run git commit; NO Codex routing; no-git contract enforced via reviewer prompt; SOLO reviewer only — panel-mode DEFERRED; scope_drift emit at review:complete owned by the dispatched reviewer agent; fixed outer seam: arguments, field_sources, epic_id).\n     - Insight-capture suffix template in every documented agent() prompt example (per execute-mode-cc-workflows mandatory clause).\n     - Target length: 250-400 lines per cc-workflows atom convention.\n  2. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  CRITICAL NO-CODEX HYGIENE for fenced code blocks (s-3 lint will be run):\n    - No agentType: codex:codex-rescue assignment anywhere in code blocks.\n    - No codex:codex-rescue literal substring in code blocks (prose paragraphs OK if absolutely required, but avoid).\n    - No agent_backends grep hit in code blocks.\n    - DO include the helper import: \`import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';\` so the helper-import check passes.\n\n  Return the structured file list. verdict='pass' on success. Tester authors resolver + scenario + lint run in next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:review-mode-cc-workflows-thin-wrapper', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings (env var name + 5-tier shape + lint check details):\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/review-mode-cc-workflows/test/resolver.test.mjs using vitest. Mirror skills/hive/skills/design-review-mode-cc-workflows/test/resolver.test.mjs (dr-3 pattern) but adapted to the solo-reviewer shape from r-2. Cover:\n     (a) 5-tier resolution: env HIVE_REVIEW_MODE > root config execution.review_mode > shipped baseline > skill override > default. Each tier returns expected mode_decision.\n     (b) source tracking matches winning tier.\n     (c) Solo dispatch shape — assert atom prescribes ONE reviewer agent() call (read SKILL.md, grep for reviewer persona + assert no panel-mode/multi-reviewer pattern).\n     (d) cc-workflows-model-tier import + opts.model on every documented agent() call (regex assertion).\n     (e) Step 0 helper import — assert SKILL.md contains the assertWorktreeIsolation import + invocation.\n     (f) Insight-capture suffix template present on every documented agent() prompt (read SKILL.md, regex assertion).\n     (g) ctx.env raw-token footgun (raw 'HIVE_REVIEW_MODE=value' resolves correctly).\n     (h) No-codex code-block checks — atom has 0 hits on agentType:codex:codex-rescue, codex:codex-rescue literal, agent_backends in code blocks.\n     (i) Episode marker target — assert SKILL.md prescribes cc-workflows-run.yaml at expected path.\n     (j) scope_drift_observed: true in marker (atom owns the emit) — assert via grep on SKILL.md.\n  2. CREATE .pHive/test-scenarios/r-3-review-mode-cc-workflows-smoke.yaml per test-scenario-schema. Avoid embedded id:/status: tokens in folded scalars (t-1b pitfall). Cover /review via cc-workflows substrate with --sequential flag and representative PR/branch arg.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND new resolver test path to vitest file list. Preserve all existing paths exactly.\n  4. RUN npm test from hive/lib. Confirm full suite green. Capture pass count.\n  5. RUN s-3 no-codex lint: node hive/scripts/lint-cc-workflows-no-codex.mjs. Confirm 4 checks PASS for review-mode-cc-workflows/SKILL.md. If any check fails, note exact failure for developer rework.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green AND s-3 lint 4/4 PASS. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:r-3-resolver-and-scenario-and-lint', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Thin-wrapper shape: review-mode-cc-workflows/SKILL.md prescribes the cc-workflows atom anatomy (Step 0 precondition, Step 1 per-unit dispatch with Workflow assembly, Step 2 poll, Step 3 marker write, Step 4 sidecar, reconciliation) — SOLO reviewer dispatch (ONE agent() call). NO panel-mode dispatch.\n  2. Step 0 helper import — assertWorktreeIsolation imported from hive/lib/cc-workflows-preconditions.mjs and invoked at Step 0. s-3 lint check 4 (helper-import-grep) PASS.\n  3. Zero Codex routing surfaces in code blocks — grep agentType:codex:codex-rescue, codex:codex-rescue literal, agent_backends in fenced blocks → 0 hits each. s-3 lint checks 1-3 PASS.\n  4. cc-workflows-model-tier import + opts.model on every documented agent() prompt template. resolveModelTier(persona, { config }) call shape preserved.\n  5. Insight-capture suffix template present on every documented agent() prompt example (execute-mode-cc-workflows mandatory clause).\n  6. Phase 0c 5-tier resolver matches canonical pattern (env > root config > shipped baseline > skill override > default). HIVE_REVIEW_MODE varName. Field-source tracking present.\n  7. scope_drift emit at review:complete owned by atom — atom prose explicitly states the dispatched reviewer calls emit_scope_drift inside its prompt-driven run; marker records scope_drift_observed: true. Round-trip emit count equal to legacy inline /review path (1 emit per /review invocation).\n  8. --sequential flag handling: passed through to the reviewer agent prompt.\n  9. Decision Point 2 honored: SOLO reviewer dispatch only. Panel-mode DEFERRED, not silently added.\n  10. Resolver test covers all 10 listed assertions. npm test green at hive/lib. s-3 lint 4/4 PASS.\n  11. Constraint summary table present + complete.\n  12. NO regression in prior shipped atoms (file scope: review-mode-cc-workflows/SKILL.md + test/resolver.test.mjs + smoke scenario + hive/lib/package.json scripts.test only; no drift outside spec).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list the exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:r-3-cc-workflows-thin-wrapper-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
