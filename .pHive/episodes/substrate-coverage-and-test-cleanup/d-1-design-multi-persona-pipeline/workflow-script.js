export const meta = {
  name: 'execute-d-1-design-multi-persona-pipeline',
  description: 'cc-workflows single-story dispatch for d-1 (/design Phase A insert + Pattern B + --include-constraints toggle + 3-persona handoff wiring)',
  phases: [
    { title: 'research', detail: 'researcher maps current /design SKILL.md shape + design-review.workflow.yaml:8-81 + specialist-triggers' },
    { title: 'implement', detail: 'developer inserts Phase A in skills/design/SKILL.md with Phase 0 wiring + Pattern B + --include-constraints toggle (default OFF)' },
    { title: 'test', detail: 'tester authors skills/design/test/phase-a-toggle.test.mjs + smoke scenario + npm test green' },
    { title: 'review', detail: 'reviewer architect-checks 3 AC subsections independently + design-review.workflow.yaml:8-81 citation in AC text' },
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
- The story spec at ${STORY_PATH} (3 AC SUBSECTIONS: Phase A structural insert / Pattern B toggle semantics / 3-persona handoff payload — these MUST verify independently)
- skills/design/SKILL.md FULL (current single ui-designer dispatch shape — Phase A is a STRUCTURAL INSERT above existing step 3 at lines 55-64)
- hive/workflows/design-review.workflow.yaml lines 8-81 (THE orchestration template anchor — 4-step assembly+serial-dispatch: accessibility:8 → animations:28 → ui-designer-critique:55 → ui-designer-synthesis:80. Phase A MUST cite this template in the AC text and prose.)
- hive/references/specialist-triggers.md (routing catalog — Pattern B toggle ON routes through specialist-triggers to dispatch accessibility-specialist + animations-specialist)
- skills/hive/skills/design-dispatch/SKILL.md (d-2 router — Phase 0 wiring target. Inputs/outputs already shipped.)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q6 + Q9 + Q10 (resolved design decisions — Pattern B default OFF, payload PNG+f0+bundled-constraint-doc, one issue per persona)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/structured-outline.md (3 AC subsections lock + design-review.workflow.yaml:8-81 anchor)
- hive/agents/ui-designer.md (the persona dispatched once even when toggle ON)
- hive/agents/accessibility-specialist.md + hive/agents/animations-specialist.md (the personas added in front of ui-designer when toggle ON)

d-2 SHIPPED (Slice 3): design-dispatch router exists; d-1 inserts Phase 0 + Phase A above the existing single-dispatch step.

KEY DESIGN DECISIONS (locked by design-discussion + hv-collab-review architect lock):
- AC splits into 3 NAMED SUBSECTIONS, each verifies independently with NO cross-coupling.
- Phase A AC MUST cite hive/workflows/design-review.workflow.yaml:8-81 INSIDE the AC text (not only in design_decisions block).
- Pattern B + --include-constraints flag: DEFAULT OFF preserves legacy single-dispatch behavior byte-for-byte; toggle is the composable-substrate escape hatch.
- ui-designer dispatched ONCE (never twice) even when toggle ON — constraints baked into the single prompt.
- Single story (Decision Point 5 — do NOT split into Phase-A-insert + persona-wiring; same change).

CONTRACT INVARIANTS:
- Phase 0 invokes design-dispatch BEFORE persona phase (resolves substrate via 5-tier resolver).
- Phase A net-new block above existing step 3 — structural insert preserving downstream steps 3-7 unchanged.
- Default OFF: NO accessibility-specialist call, NO animations-specialist call, ui-designer dispatched ONCE.
- Toggle ON: SERIAL dispatch (a) accessibility-specialist → (b) animations-specialist → (c) ui-designer ONCE with constraints baked into prompt.
- Handoff payload bundling owned by d-5 (next story) — d-1 produces the constraint notes ARTIFACT; d-5 defines payload SHAPE. Reference d-5 in Phase A prose without implementing payload contract.
- Test independence: phase-a-toggle.test.mjs has 3 independent describe blocks, one per AC subsection.

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read skills/design/SKILL.md FULL. Identify line ranges for: Skill Preamble, Gate Check, Process steps 1-7, Standalone vs delegated, Atomic invariants. Capture the EXACT current shape so the Phase A insert preserves all downstream content byte-for-byte.\n  2. Read hive/workflows/design-review.workflow.yaml:8-81. Capture all 4 step definitions: id, agent, step_file, depends_on, inputs, outputs. These are the assembly+serial-dispatch shape Phase A mirrors.\n  3. Read hive/references/specialist-triggers.md. Capture how Pattern B toggle ON routes: which trigger entries cover accessibility-specialist + animations-specialist for design-time consumption (vs review-time). Capture trigger IDs, responds_with, workflow fields.\n  4. Read skills/hive/skills/design-dispatch/SKILL.md (d-2). Capture: invocation contract (inputs/outputs), env HIVE_DESIGN_MODE, field_sources, --sequential pass-through. This is what Phase 0 of /design must call.\n  5. Read .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q6 + Q9 + Q10. Capture exact resolved-text for each so prose can cite verbatim.\n  6. Read hive/agents/ui-designer.md + accessibility-specialist.md + animations-specialist.md. Capture: what each persona expects as input + produces as output, so Phase A prose can specify the constraint-notes-to-prompt baking pattern correctly.\n  7. Identify how to express "constraints baked into the prompt" structurally — likely: a prose paragraph in Phase A prescribes the dispatcher to prepend accessibility-constraint-notes + animations-constraint-notes blocks to the ui-designer prompt (a string concatenation, not a separate dispatch).\n  8. Confirm test file path: skills/design/test/phase-a-toggle.test.mjs. Confirm vitest is the runner (per established hive/lib pattern; design test path may need new test file registration in hive/lib/package.json — check).\n  9. Identify the scenario file path: .pHive/test-scenarios/d-1-design-phase-a-toggle.yaml.\n  10. Map: which exact text in skills/design/SKILL.md should the Phase A insert REPLACE vs INSERT-ABOVE? Likely INSERT above current step 3 (line 55-64) as a new "Phase A — Persona pipeline assembly" block. Confirm.\n  11. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml.\n\n  verdict='pass' if all 11 items mapped clearly; 'fail' otherwise. Do NOT modify any source files (research marker + insight memory only).`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:phase-a-insert-and-toggle-shape', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. MODIFY skills/design/SKILL.md. STRUCTURAL CHANGES:\n     (a) Insert a NEW "Phase 0 — Resolve dispatch mode" section before existing step 1 (or alongside Skill Preamble, mirroring design-review's Phase 0 pattern shipped by dr-1). Phase 0 invokes design-dispatch with the same input contract dr-1 established; resolves substrate via 5-tier resolver; branches: multica → hand off to design-mode-multica (forward decl, ships in d-3) and stop; cc-workflows → hand off to design-mode-cc-workflows (forward decl, ships in d-4) and stop; any other value → continue inline below.\n     (b) Insert a NEW "Phase A — Persona pipeline assembly" block ABOVE existing step 3 (the current ui-designer dispatch at lines 55-64). The new block:\n         - States: Phase A mirrors hive/workflows/design-review.workflow.yaml:8-81 (the 4-step assembly+serial-dispatch shape — accessibility:8 → animations:28 → ui-designer-critique:55 → ui-designer-synthesis:80) as orchestration template. The structural insert prevents re-invention.\n         - Documents the --include-constraints flag default OFF. Default OFF preserves legacy single ui-designer dispatch (existing step 3) byte-for-byte.\n         - Documents toggle ON behavior: serial dispatch (a) accessibility-specialist → (b) animations-specialist → (c) ui-designer (ONCE, with constraint notes prepended to the prompt as structured blocks).\n         - Documents the 3-persona handoff payload: accessibility constraint notes + animations constraint notes are bundled with ui-designer outputs (PNG + .f0) per the wireframe-handoff payload contract owned by d-5 (forward declaration; d-1 produces the constraint-notes artifacts; d-5 defines the bundled payload shape).\n     (c) Preserve all downstream steps (3-7) byte-for-byte — Phase A is INSERT-ABOVE, not modify. Step 3 (current ui-designer dispatch) becomes the toggle-OFF / Phase A-OFF path, plus the post-Phase-A single-dispatch site when Phase A is ON.\n     (d) Update "What /design is NOT" to clarify Phase A toggle is the only multi-persona surface; default behavior is unchanged. Update "Atomic-skill invariants" to add Phase 0 (dispatch resolution) + Phase A (persona pipeline, toggle gated) as the two new invariants.\n     (e) Update the Skill Preamble or Process introduction to cite hive/workflows/design-review.workflow.yaml:8-81 as the Phase A orchestration template — anchoring prevents architectural drift between Slices B and C (per design-discussion §3).\n     (f) Keep file readable — total length ~250-350 lines. Phase A block is ~40-60 lines.\n  2. The 3 ACs MUST be verifiable INDEPENDENTLY by reading skills/design/SKILL.md:\n     - AC Subsection 1 (Phase A structural insert + Phase 0 wiring): Phase A block exists ABOVE step 3; cites design-review.workflow.yaml:8-81 in the AC text/prose; Phase 0 invokes design-dispatch.\n     - AC Subsection 2 (Pattern B toggle semantics): --include-constraints flag documented; default OFF = single ui-designer; toggle ON = serial accessibility → animations → ui-designer ONCE.\n     - AC Subsection 3 (3-persona handoff payload): toggle-ON constraint notes are bundled with ui-designer outputs per d-5 wireframe handoff contract; toggle-OFF omits constraint doc.\n  3. Write implement episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success. Tester authors phase-a-toggle.test.mjs + scenario in next step.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:design-phase-a-insert-and-toggle', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/design/test/phase-a-toggle.test.mjs using vitest. THREE independent describe blocks, one per AC subsection (test independence is a contract — one subsection failure must not block others):\n\n     describe('AC Subsection 1 — Phase A structural insert + Phase 0 wiring', ...)\n       - test: skills/design/SKILL.md contains a "Phase A" block ABOVE current step 3 (line-order assertion; read file, find both anchors, assert Phase A appears earlier).\n       - test: Phase A AC text cites 'hive/workflows/design-review.workflow.yaml:8-81' VERBATIM (substring match).\n       - test: Phase 0 block exists and invokes design-dispatch (substring match on 'design-dispatch').\n       - test: Phase 0 branches on mode_decision (substring match on 'multica' + 'cc-workflows' + 'design-mode-multica' + 'design-mode-cc-workflows').\n\n     describe('AC Subsection 2 — Pattern B toggle semantics', ...)\n       - test: --include-constraints flag documented (substring match on '--include-constraints').\n       - test: default OFF described — single ui-designer dispatch preserved (substring match on 'default' + 'OFF' + 'ui-designer' in proximity).\n       - test: toggle ON described — serial accessibility → animations → ui-designer ONCE (substring matches on all three persona names + 'serial' or 'serially').\n       - test: ui-designer dispatched ONCE even when toggle ON (substring assertion on 'dispatched ONCE' or 'once' qualifier).\n\n     describe('AC Subsection 3 — 3-persona handoff payload bundling', ...)\n       - test: toggle ON bundles constraint notes with ui-designer outputs (substring match on 'constraint notes' + 'bundled' or 'bundle').\n       - test: toggle OFF omits constraint doc (substring assertion).\n       - test: PNG + .f0 always ship (substring match on 'PNG' + '.f0' + 'always').\n       - test: Phase A prose forward-declares d-5 as payload contract owner (substring match on 'd-5' or 'd-5-wireframe-artifact-handoff').\n\n     Use fs.readFileSync to load skills/design/SKILL.md once at test file top; assertions are substring/regex matches on the loaded content. Targets ~12-15 test cases total across the 3 describe blocks.\n\n  2. CREATE .pHive/test-scenarios/d-1-design-phase-a-toggle.yaml per test-scenario-schema. Cover /design (default no-flag) + /design --include-constraints. Avoid embedded id:/status: tokens in folded scalars (t-1b pitfall). Note that this is a SMOKE scenario (not a programmatic resolver test) — describes manual steps an operator would take to exercise both code paths.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND ../../skills/design/test/phase-a-toggle.test.mjs (or correct relative path from hive/lib) to the vitest file list. Preserve all existing paths exactly. If skills/design/test/ doesn't have a node-module context for direct vitest discovery, document the registration approach in test.yaml.\n  4. RUN npm test from hive/lib. Confirm full suite green AND the 3 new describe blocks all pass. Capture pass count.\n  5. s-3 no-codex lint is OUT OF SCOPE (lint targets *-mode-cc-workflows atoms; d-1 modifies /design SKILL.md). Document.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff all 3 AC describe blocks pass independently AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:d-1-phase-a-toggle-3-subsections', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. The 3 AC subsections verify INDEPENDENTLY. Confirm each independently:\n\n  AC Subsection 1 — Phase A structural insert + Phase 0 wiring:\n    1.1. Phase A block exists ABOVE current step 3 (file line-order check).\n    1.2. Phase A AC text/prose cites hive/workflows/design-review.workflow.yaml:8-81 VERBATIM (substring grep).\n    1.3. Phase 0 invokes design-dispatch and branches on mode_decision (multica → design-mode-multica forward decl, cc-workflows → design-mode-cc-workflows forward decl, other → continue inline). Mirrors dr-1 Phase 0 pattern shipped for /design-review.\n    1.4. Downstream steps (3-7) preserved byte-for-byte — diff inspection.\n\n  AC Subsection 2 — Pattern B toggle semantics:\n    2.1. --include-constraints flag documented in Phase A prose.\n    2.2. Default OFF preserves legacy single ui-designer dispatch (NO accessibility, NO animations).\n    2.3. Toggle ON serially dispatches accessibility-specialist → animations-specialist → ui-designer ONCE (constraints baked into the prompt as prepended structured blocks, not a separate dispatch).\n    2.4. ui-designer dispatched ONCE even when toggle ON — explicit prose assertion (not "twice", not "again").\n\n  AC Subsection 3 — 3-persona handoff payload bundling:\n    3.1. Phase A prose describes accessibility-constraint-notes + animations-constraint-notes as ARTIFACTS bundled with ui-designer outputs (PNG + .f0).\n    3.2. Toggle ON: constraint doc field present in handoff bundle.\n    3.3. Toggle OFF: constraint doc absent/empty; PNG + .f0 ship as legacy.\n    3.4. Payload contract SHAPE forward-declared to d-5; d-1 owns the constraint-notes artifact production only.\n\n  Cross-cutting (BLOCKING on review-time issues):\n    X.1. Test independence — phase-a-toggle.test.mjs has 3 INDEPENDENT describe blocks. One block failing does NOT block the other two from passing (verified via test framework's test isolation).\n    X.2. Decision Point 5 honored — single story; structural insert + persona wiring are the same change.\n    X.3. design-discussion §6 Q6 + Q9 + Q10 cited or honored verbatim in design_decisions or prose.\n    X.4. No regression in any prior shipped atom (file scope: skills/design/SKILL.md, skills/design/test/phase-a-toggle.test.mjs, .pHive/test-scenarios/d-1-..., hive/lib/package.json scripts.test only).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list the exact items + AC subsection + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:d-1-3-ac-subsections-independent', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
