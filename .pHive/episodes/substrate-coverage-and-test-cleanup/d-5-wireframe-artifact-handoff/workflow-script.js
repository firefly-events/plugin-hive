export const meta = {
  name: 'execute-d-5-wireframe-artifact-handoff',
  description: 'cc-workflows single-story dispatch for d-5 (wireframe handoff payload — PNG + .f0 + bundled constraint doc, extensible-minimum posture)',
  phases: [
    { title: 'research', detail: 'researcher maps wireframe-protocol.md current shape + Q9 resolution + TPM extensible-minimum posture' },
    { title: 'implement', detail: 'developer updates hive/references/wireframe-protocol.md with payload contract section (3 minimum fields + extensible-minimum posture)' },
    { title: 'test', detail: 'tester authors vitest payload-shape contract test + smoke scenario covering toggle-ON/toggle-OFF bundling' },
    { title: 'review', detail: 'reviewer architect-checks payload field naming + posture statement + downstream consumer cite + toggle-conditional constraint doc' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria + design_decisions + Q9 resolution + TPM ESCALATION outcome)
- hive/references/wireframe-protocol.md (CURRENT — Touchpoint 1 + Touchpoint 2 documented; d-5 adds the payload contract section)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q9 (RESOLVED — payload = PNG + .f0 + bundled constraint doc)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/outline-collab-review-record.md (TPM ESCALATION resolved as "extensible-minimum" posture)
- skills/design/SKILL.md (d-1 just shipped — Phase A toggle determines constraint-notes artifact production. d-5 defines the PAYLOAD SHAPE that bundles them)
- skills/hive/skills/design-mode-multica/SKILL.md (d-3 — consumes the payload shape on Multica substrate)
- skills/hive/skills/design-mode-cc-workflows/SKILL.md (d-4 — consumes the payload shape on cc-workflows substrate)
- skills/design-review/SKILL.md (downstream consumer — the payload feeds /design-review)

d-1 SHIPPED: /design Phase A produces accessibility + animations constraint notes ARTIFACTS when --include-constraints is on.
d-3 SHIPPED: design-mode-multica per-persona dispatch produces per-persona outputs that get bundled.
d-4 SHIPPED: design-mode-cc-workflows per-persona Workflow-tool dispatch produces per-persona outputs that get bundled.

KEY DESIGN DECISIONS (locked):
- Payload shape MINIMUM 3 fields: wireframe.png (always), wireframe.f0 (always), constraints.md (conditional on --include-constraints toggle).
- POSTURE: extensible-minimum (per TPM ESCALATION). Downstream consumers MAY require additional fields; new fields are add-only and reversible.
- Toggle ON → constraint doc field present with bundled accessibility + animations notes; toggle OFF → constraint doc absent/empty but PNG + .f0 always ship.
- Cross-cutting: UPDATE hive/references/wireframe-protocol.md with the payload-contract section naming the 3 minimum fields and extensible-minimum posture.

CONTRACT INVARIANTS:
- wireframe.png present in payload always (per Q9)
- wireframe.f0 present in payload always (per Q9)
- constraints.md present iff Phase A toggle ON (per Q9)
- Posture: extensible-minimum (per TPM ESCALATION) — additional fields allowed
- Field naming: field-named not file-glob-based (mitigates risk: bundle composition leaking ui-designer working state)

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list. The marker insight_capture block tracks personas + count.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Read hive/references/wireframe-protocol.md FULL. Capture: Touchpoint 1 (rendition approval via AskUserQuestion), Touchpoint 2 (brief sign-off). Capture EXACT current shape so the payload-contract section can be inserted without disturbing existing content. Identify the insert location (likely a new section after Touchpoint 2 or in a "Handoff payload" subsection if one exists).\n  2. Read .pHive/epics/substrate-coverage-and-test-cleanup/docs/design-discussion.md §6 Q9. Cite verbatim text.\n  3. Read .pHive/epics/substrate-coverage-and-test-cleanup/docs/outline-collab-review-record.md TPM ESCALATION on wireframe handoff. Cite verbatim. The "extensible-minimum" posture statement must appear in the new payload-contract section.\n  4. Read skills/design/SKILL.md (post d-1). Confirm: Phase A constraint-notes artifact production (toggle ON) → these artifacts become the constraints.md field in d-5 payload.\n  5. Read skills/hive/skills/design-mode-multica/SKILL.md (d-3). Note where per-persona outputs feed into the bundled payload. d-3 SKILL.md may need a forward-ref to d-5 payload contract; d-5 ships ONLY the contract definition + tests, not d-3 modifications (scope discipline).\n  6. Read skills/hive/skills/design-mode-cc-workflows/SKILL.md (d-4). Same as d-3 — note feed-in point; do NOT modify d-4.\n  7. Read skills/design-review/SKILL.md briefly. Identify the downstream consumer reading the payload (this informs the field-named-not-file-glob design decision rationale).\n  8. Confirm vitest is the runner; payload-shape contract test path: skills/design/test/wireframe-handoff-payload.test.mjs (or similar) — confirm hive/lib/package.json test list registration approach mirrors d-1's pattern.\n  9. Identify the smoke scenario file path: .pHive/test-scenarios/d-5-wireframe-handoff-payload.yaml (or similar per spec).\n  10. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml.\n\n  verdict='pass' if all 10 items mapped; 'fail' otherwise. Do NOT modify source files.`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:payload-contract-shape-and-insertion', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. MODIFY hive/references/wireframe-protocol.md. INSERT a new section "## Handoff Payload Contract" (heading exact) at the insertion location identified by research. The section MUST contain:\n     - Opening prose: "The wireframe handoff payload is the bundled artifact set that /design produces and downstream consumers (e.g., /design-review, manual review, future Hermes) consume. The payload shape is **extensible-minimum**: at minimum these three fields, downstream consumers MAY require additional fields, and new fields are add-only."\n     - A bullet list of the 3 minimum fields, each on its own line:\n       - \`wireframe.png\` — PNG render of the wireframe (always present)\n       - \`wireframe.f0\` — Frame0 source (always present)\n       - \`constraints.md\` — bundled accessibility + animations constraint notes (present when /design was invoked with \`--include-constraints\`, absent otherwise)\n     - Posture statement: "**Posture:** extensible-minimum. Downstream consumers MAY require additional fields. New fields are add-only and reversible — earlier consumers seeing fewer fields will not break. This posture was set by TPM escalation in outline-collab-review-record (cite: 'the minimum payload, d-5 is free to add fields if a downstream consumer surfaces a need during the manual exercise step')."\n     - Toggle-conditional clarification: "When /design --include-constraints is ON, the constraints.md field is populated with the bundled accessibility-specialist + animations-specialist constraint notes produced by /design Phase A (d-1). When the flag is OFF, the constraints.md field is absent or empty; PNG + .f0 always ship."\n     - Field-named vs file-glob note: "The payload is **field-named** (not file-glob-based) so bundle composition cannot accidentally leak ui-designer working state. Only the three named fields above are part of the canonical minimum; additional fields require explicit naming."\n     - Cite Q9 verbatim and forward-ref d-1 (Phase A artifact producer) + d-3/d-4 (per-substrate atoms that bundle).\n  2. Preserve all existing wireframe-protocol.md content byte-for-byte — d-5 is INSERT, not modify.\n  3. Do NOT modify d-1/d-3/d-4 atoms — d-5 ships ONLY the payload-contract definition (in wireframe-protocol.md) + tests. Scope discipline.\n  4. Write implement episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:wireframe-payload-contract-insert', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. CREATE skills/design/test/wireframe-handoff-payload.test.mjs using vitest. Static-analysis contract test against hive/references/wireframe-protocol.md (read file once at top, assert substrings/regex on content). Cover the following AC subsections independently in separate describe blocks:\n\n     describe('Payload contract — 3 minimum fields', ...)\n       - test: section heading "## Handoff Payload Contract" present.\n       - test: \`wireframe.png\` field listed.\n       - test: \`wireframe.f0\` field listed.\n       - test: \`constraints.md\` field listed.\n       - test: PNG + .f0 noted as "always present".\n       - test: constraints.md noted as toggle-conditional ("present when" or "--include-constraints" in proximity).\n\n     describe('Posture — extensible-minimum', ...)\n       - test: substring 'extensible-minimum' present.\n       - test: posture statement explicitly says additional fields allowed (substring 'add-only' or 'additional fields').\n       - test: TPM escalation cite present (substring 'outline-collab-review-record' or 'TPM').\n\n     describe('Toggle-conditional constraint doc bundling', ...)\n       - test: toggle-ON path documented (substring on toggle + 'present' + 'constraints').\n       - test: toggle-OFF path documented (substring on absent or empty + PNG+f0 still ship).\n\n     describe('Field-named vs file-glob discipline', ...)\n       - test: substring 'field-named' present.\n       - test: rationale (substring 'leak' or 'working state') present.\n\n     describe('Cross-references — d-1 producer + d-3/d-4 consumers', ...)\n       - test: d-1 forward-referenced (substring 'd-1' or 'Phase A').\n       - test: cc-workflows + multica substrates noted as consumers (substring 'cc-workflows' + 'multica' in payload-contract section).\n\n  2. CREATE .pHive/test-scenarios/d-5-wireframe-handoff-payload.yaml per test-scenario-schema. Spec-walk covering: (a) /design --include-constraints → payload contains all 3 fields; (b) /design (default) → payload contains 2 fields (PNG + .f0); (c) extensible-minimum acceptance — adding a hypothetical 4th field does not violate contract.\n  3. MODIFY hive/lib/package.json scripts.test: APPEND the new wireframe-handoff-payload.test.mjs path to vitest file list. Preserve existing paths.\n  4. RUN npm test from hive/lib. Confirm full suite green AND the new describe blocks all pass.\n  5. s-3 no-codex lint is OUT OF SCOPE for d-5 (modifies wireframe-protocol.md doc, not *-mode-cc-workflows atom). Document.\n  6. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff all 5 describe blocks pass independently AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:d-5-payload-contract-shape', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. Section "## Handoff Payload Contract" exists in hive/references/wireframe-protocol.md.\n  2. 3 minimum fields exactly: wireframe.png, wireframe.f0, constraints.md. PNG + .f0 noted as ALWAYS present; constraints.md noted as toggle-CONDITIONAL.\n  3. Posture explicitly "extensible-minimum" with rationale ("add-only", "additional fields", or equivalent).\n  4. TPM escalation cite present (outline-collab-review-record reference or "TPM").\n  5. Q9 resolution cited verbatim or paraphrased with attribution.\n  6. Toggle-ON path: constraints.md populated with accessibility + animations bundled notes; toggle-OFF path: constraint doc absent/empty; PNG + .f0 always ship in both.\n  7. Field-named vs file-glob discipline stated with rationale (prevents working-state leak).\n  8. Forward-refs: d-1 (Phase A artifact producer), d-3 + d-4 (per-substrate consumers).\n  9. Existing wireframe-protocol.md content preserved byte-for-byte — d-5 is INSERT, not modify (diff inspection).\n  10. d-1/d-3/d-4 atoms NOT modified (scope discipline) — d-5 ships ONLY the payload-contract definition + tests.\n  11. Test independence: 5 describe blocks each independently verifies a contract sub-aspect.\n  12. NO regression in prior shipped atoms (file scope strictly limited to: hive/references/wireframe-protocol.md, skills/design/test/wireframe-handoff-payload.test.mjs, .pHive/test-scenarios/d-5-..., hive/lib/package.json scripts.test, memory files).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:d-5-payload-contract-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
