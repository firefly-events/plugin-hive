export const meta = {
  name: 'execute-r-2-review-mode-multica',
  description: 'cc-workflows single-story dispatch for r-2 (review-mode-multica atom — thin wrapper for solo reviewer dispatch)',
  phases: [
    { title: 'research', detail: 'researcher maps execute-mode-multica lifecycle + r-1 review-dispatch contract + solo reviewer pattern' },
    { title: 'implement', detail: 'developer creates review-mode-multica/SKILL.md as thin wrapper — single createIssue, single reviewer agent, single episode marker' },
    { title: 'test', detail: 'tester authors resolver vitest (5-tier + solo dispatch) + smoke scenario YAML + adds test to hive/lib/package.json' },
    { title: 'review', detail: 'reviewer architect-checks thin-wrapper shape + episode-marker placement + scope_drift preservation observable through r-1' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + design_decisions + Decision Point 1 rationale)
- skills/hive/skills/execute-mode-multica/SKILL.md (LIFECYCLE REFERENCE — full Multica run anatomy: Step 0 precondition + Step 1 createIssue + Step 2 assignIssue + Step 3 poll-to-terminal + Step 4 marker + Step 5 closeIssue)
- skills/hive/skills/test-mode-multica/SKILL.md (closer mirror — single-run dispatch; r-2 should look more like this than plan-mode-multica's per-persona loop)
- skills/hive/skills/review-dispatch/SKILL.md (r-1 router that dispatches into r-2 — capture: env var HIVE_REVIEW_MODE, workflow_name 'code-review', argument forwarding contract, scope_drift contract obligation)
- skills/review/SKILL.md Phase 0 + Phase 1 (the inline solo-reviewer behavior that r-2 must preserve when dispatched through Multica)
- hive/lib/mode-resolver.mjs (canonical 5-tier resolver — confirm HIVE_REVIEW_MODE is registered)

r-1 SHIPPED (Slice 5): review-dispatch router exists; r-2 is what the multica branch of dispatch routes to.

KEY DESIGN DECISION (Decision Point 1 — AFFIRM KEEP SEPARATE):
- r-2 is kept as its own atom (not collapsed into r-1) for parity symmetry with Slices 2-4.
- Each substrate slice has the same three-story shape: router + multica atom + cc-workflows atom.
- Collapsing would create a one-off slice shape that complicates the dispatch-parity matrix (Slice 6).

KEY DESIGN DECISION (Decision Point 2 — Panel mode DEFERRED):
- r-2 dispatches a SINGLE (solo) reviewer. NO panel-mode (multi-reviewer) dispatch.
- Solo reviewer pattern is preserved per skills/review/SKILL.md Phase 1.
- Future panel-mode would be a separate atom — out of scope for this slice.

CONTRACT INVARIANTS:
- Solo (single) reviewer dispatch — ONE reviewer agent inside ONE Multica run
- Episode marker target: \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml
- scope_drift emit (review:complete) preserved by r-1 — atom verification confirms observable preservation
- Phase 0c 5-tier resolution (env > root config > shipped baseline > skill override > default)
- --sequential flag forwarded through (per r-1 contract)
- workflow_name: 'code-review'

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/hive/skills/execute-mode-multica/SKILL.md. Capture full Multica lifecycle (Steps 0-5): Step 0 precondition gate, Step 1 createIssue + label, Step 2 assignIssue, Step 3 poll-to-terminal mapping, Step 4 marker schema, Step 5 closeIssue. NOTE: r-2 reuses this lifecycle as-is but with a single agent (reviewer) inside the assigned-agent run.\n  2. Read skills/hive/skills/test-mode-multica/SKILL.md. This is the CLOSER mirror — single-run per scenario shape. r-2 mirrors single-run per /review invocation.\n  3. Read skills/hive/skills/review-dispatch/SKILL.md (r-1). Capture: inputs received from review SKILL.md Phase 0; output contract (mode_decision/field_sources); --sequential pass-through; scope_drift contract obligation note.\n  4. Read skills/review/SKILL.md Phase 1 — capture the SOLO reviewer pattern that r-2 must preserve (single architect/reviewer persona, structured verdict, scope_drift emit at Step 6).\n  5. Confirm HIVE_REVIEW_MODE is the registered env var name in hive/lib/mode-resolver.mjs. Capture exact registration entry.\n  6. Identify the canonical multica issue label for /review (e.g., hive:review or whatever convention applies; check execute-mode-multica + test-mode-multica for prior art).\n  7. Confirm vitest is the test runner; resolver test path skills/hive/skills/review-mode-multica/test/resolver.test.mjs.\n  8. Map: which exact behaviors of skills/review/SKILL.md Phase 1 must the r-2 atom prescribe? Specifically — single reviewer agent, structured PR/branch arg forwarding, --sequential flag pass-through to reviewer prompt, scope_drift emit preservation (handled outside atom by r-1; atom MUST NOT duplicate or block it).\n  9. Read .pHive/episodes/substrate-coverage-and-test-cleanup/dr-2-design-review-mode-multica/cc-workflows-run.yaml — note artifacts.created list as STRUCTURAL precedent.\n  10. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml capturing your findings in notes.\n\n  verdict='pass' if all 10 items mapped clearly; 'fail' otherwise. Do NOT modify any source files (research marker only).`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:multica-lifecycle-and-solo-reviewer-contract', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE skills/hive/skills/review-mode-multica/SKILL.md. Thin wrapper for solo reviewer dispatch on Multica substrate. STRUCTURE (mirror execute-mode-multica/test-mode-multica):\n     - Front-matter or H1 + short summary block: "Atomic skill — runs /review through the Multica substrate as a single (solo) reviewer dispatch."\n     - State directory resolution block (HIVE_STATE_DIR = hive_config.paths.state_dir || '.pHive').\n     - Invocation contract: inputs from review-dispatch (arguments, field_sources, optional epic_id); outputs episode marker at \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml.\n     - Step 0: Precondition gate. Reject with structured precondition_failed if Multica unavailable; do NOT silently fall through.\n     - Step 1: createIssue (single issue, label hive:review or as identified by research). Title carries PR# or branch arg.\n     - Step 2: assignIssue to reviewer persona.\n     - Step 3: Poll-to-terminal (use execute-mode-multica terminal mapping — passed/failed/cancelled).\n     - Step 4: Write per-unit episode marker per the schema above. Single marker captures reviewer verdict, evidence_ref (PR comment thread or transcript), scope_drift_observed: true|null (atom does NOT emit; it confirms r-1 emit fired via cycle-state or upstream marker).\n     - Step 5: closeIssue on terminal.\n     - Reuses (atomic deps): list hive/adapters/multica/index.ts, hive/lib/task-tracking-dispatch, hive/references/episode-schema.md, hive/agents/reviewer.md.\n     - Phase 0c 5-tier resolver block (env HIVE_REVIEW_MODE > root config execution.review_mode > shipped baseline > skill override > default 'team').\n     - Constraint summary table (atomic skill, NOT inline /review prose; SOLO reviewer only — panel-mode DEFERRED; scope_drift preserved by r-1 — atom must not duplicate; --sequential flag forwarded; fixed outer seam: arguments, field_sources, epic_id).\n     - Failure modes block (precondition_failed structured reject; Multica timeout; reviewer agent crash).\n     - DO NOT add: panel-mode dispatch, multi-reviewer pipelines, Codex routing references in code blocks (multica atoms are not subject to s-3 lint but keep clean by convention).\n  2. Write episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success. Tester authors resolver + scenario in next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:review-mode-multica-thin-wrapper', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings (env var name + label + canonical resolver shape):\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/hive/skills/review-mode-multica/test/resolver.test.mjs using vitest. Mirror skills/hive/skills/design-review-mode-multica/test/resolver.test.mjs (dr-2's pattern) but adapted to the solo-reviewer shape. Cover:\n     (a) 5-tier resolution (env > root config > shipped baseline > skill override > default) — env HIVE_REVIEW_MODE wins, then root config execution.review_mode, then baseline, then skill override, then default.\n     (b) source tracking matches the winning tier exactly.\n     (c) Solo dispatch shape — assert atom prescribes exactly ONE reviewer agent (read SKILL.md, grep for reviewer persona reference; assert no panel-mode/multi-reviewer pattern).\n     (d) Episode marker target singular — assert marker target is multica-run.yaml under {epic_handle}/{unit_id}/ (not per-persona).\n     (e) scope_drift NOT emitted by atom — assert atom prose explicitly notes r-1 owns the emit; grep SKILL.md for "preserved by r-1" or equivalent phrasing.\n     (f) ctx.env raw-token footgun coverage (raw "HIVE_REVIEW_MODE=value" string token must resolve correctly).\n  2. CREATE .pHive/test-scenarios/r-2-review-mode-multica-smoke.yaml per test-scenario-schema. Avoid embedded id:/status: tokens in folded scalars (t-1b pitfall — use block scalars or escape). Cover /review via multica substrate with --sequential flag and a representative PR/branch arg.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND the new resolver test path to the vitest file list. Preserve all existing paths exactly.\n  4. RUN npm test from hive/lib. Confirm full suite green. Capture pass count in notes.\n  5. s-3 no-codex lint is OUT OF SCOPE for r-2 (lint targets *-mode-cc-workflows atoms only). Document this finding in notes; do not run the lint.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff resolver test green AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:r-2-resolver-and-scenario', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Thin-wrapper shape: review-mode-multica/SKILL.md prescribes Steps 0-5 mirroring execute-mode-multica / test-mode-multica. ONE createIssue, ONE reviewer agent, ONE episode marker. NO panel-mode dispatch.\n  2. Episode marker placement: \${HIVE_STATE_DIR}/episodes/{epic_handle}/{unit_id}/multica-run.yaml. Schema matches established multica-run marker shape (status, verdict, evidence_ref, etc.).\n  3. scope_drift preservation observable: atom prose explicitly cedes the scope_drift emit to r-1 (review-dispatch); atom does NOT emit, but the dispatch+atom round-trip produces the same observable scope_drift event count as the legacy inline path. Grep SKILL.md to confirm the deferral note.\n  4. --sequential flag handling: passed through to the reviewer agent prompt (or noted as architecturally pass-through; not absorbed by the atom).\n  5. Phase 0c 5-tier resolver matches canonical pattern (env > root config > shipped baseline > skill override > default). HIVE_REVIEW_MODE varName. Field-source tracking present.\n  6. Decision Point 1 honored: r-2 is its own atom, not collapsed into r-1. Three-story slice shape preserved.\n  7. Decision Point 2 honored: SOLO reviewer dispatch only. Panel-mode DEFERRED, not silently added.\n  8. Resolver test covers all 6 listed assertions. npm test green at hive/lib.\n  9. No NEW Codex routing references introduced (convention; lint does not scope this atom).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list the exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:r-2-thin-wrapper-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
