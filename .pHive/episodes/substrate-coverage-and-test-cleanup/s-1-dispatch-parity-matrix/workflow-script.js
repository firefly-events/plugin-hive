export const meta = {
  name: 'execute-s-1-dispatch-parity-matrix',
  description: 'cc-workflows single-story dispatch for s-1 (governance close — dispatch-parity.md 6×3 matrix + verify-dispatch-parity.mjs CI checker)',
  phases: [
    { title: 'research', detail: 'researcher enumerates all dispatch routers + mode atoms from Slices 1-5 shipped artifacts' },
    { title: 'implement', detail: 'developer authors hive/references/dispatch-parity.md (6×3 matrix + future-substrate footer + Last verified block) + hive/scripts/verify-dispatch-parity.mjs CI checker' },
    { title: 'test', detail: 'tester authors vitest contract test + runs verify-dispatch-parity.mjs green + smoke scenario + cross-links from README + planning-routing skill' },
    { title: 'review', detail: 'reviewer architect-checks matrix shape + path-resolve correctness + future-extensibility footer + cross-links + CI checker scope' },
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
- The story spec at ${STORY_PATH} (acceptance_criteria; this is the FINAL GOVERNANCE CLOSE for the epic)
- All 6 dispatch routers (shipped Slices 1-5):
  - skills/hive/skills/execute-dispatch/SKILL.md (canonical structural mirror)
  - skills/hive/skills/test-dispatch/SKILL.md
  - skills/hive/skills/design-dispatch/SKILL.md
  - skills/hive/skills/design-review-dispatch/SKILL.md
  - skills/hive/skills/review-dispatch/SKILL.md
  - skills/hive/skills/planning-routing/SKILL.md (or planning-dispatch / planning-mode-routing — confirm exact name)
- All multica + cc-workflows mode atoms shipped Slices 1-5:
  - skills/hive/skills/plan-mode-multica/SKILL.md + skills/hive/skills/plan-mode-cc-workflows/SKILL.md
  - skills/hive/skills/execute-mode-multica/SKILL.md + skills/hive/skills/execute-mode-cc-workflows/SKILL.md
  - skills/hive/skills/test-mode-multica/SKILL.md + skills/hive/skills/test-mode-cc-workflows/SKILL.md
  - skills/hive/skills/design-mode-multica/SKILL.md + skills/hive/skills/design-mode-cc-workflows/SKILL.md (d-3 + d-4 just shipped)
  - skills/hive/skills/design-review-mode-multica/SKILL.md + skills/hive/skills/design-review-mode-cc-workflows/SKILL.md
  - skills/hive/skills/review-mode-multica/SKILL.md + skills/hive/skills/review-mode-cc-workflows/SKILL.md
- skills/<orchestrator>/SKILL.md for each top-level skill: skills/plan/SKILL.md, skills/execute/SKILL.md (or via plugin-hive plugin path), skills/test/SKILL.md, skills/design/SKILL.md, skills/design-review/SKILL.md, skills/review/SKILL.md (these are the "inline" default-path entries)
- .pHive/epics/substrate-coverage-and-test-cleanup/docs/horizontal-plan.md L7 (docs+governance reads from L2/L3/L4)

KEY DESIGN DECISIONS (locked):
- Matrix is 6 rows × 3 columns + a "Future substrate" FOOTER row.
- Rows: plan, execute, test, design, design-review, review.
- Columns: default, multica, cc-workflows.
- Cell content rules: (a) relative path to active mode-atom skill, OR (b) "inline" for default-path dispatch through orchestrator skill, OR (c) "N/A — reasoning" if no shipped substrate.
- Future footer row lists placeholder columns (sandcastle, gh-actions-legacy) with "not-shipped" markers.
- Header MUST cite itself as "produced by Slice 6 of substrate-coverage-and-test-cleanup; canonical reference for what's wired across substrates."
- "## Last verified: YYYY-MM-DD" block updated by CI checker on green.
- DO NOT embed line ranges (paths only — line ranges drift).
- DO NOT author new substrate atoms in Slice 6 — pure summary.

CONTRACT INVARIANTS:
- hive/references/dispatch-parity.md exists with 6×3 matrix + future footer
- hive/scripts/verify-dispatch-parity.mjs exists; CI-runnable; exits 0 when every cited path resolves AND is in git ls-files
- Cross-links from README + skills/hive/skills/planning-routing/SKILL.md (per architect ESCALATION mirror-anchor pattern)
- Last-verified ISO date stamp present (2026-06-08 baseline)
- All 6 default cells = "inline" (or specific orchestrator skill path) — verified against shipped /plan, /execute, /test, /design, /design-review, /review
- All 12 substrate cells (multica + cc-workflows × 6 rows) populated from shipped Slices 1-5 atoms

INSIGHT CAPTURE (before returning your structured output):
Each persona MUST write 1 short memory under hive/agents/memories/<your-persona>/ capturing one non-obvious finding from this story. Add that file to your returned files[] list.
`;

phase('research');
const research = await agent(
  `You are the researcher persona — read hive/agents/researcher.md.\n\n${baseContext}\n\nTASK:\n  1. Enumerate ALL dispatch routers on disk under skills/hive/skills/*-dispatch/ AND skills/hive/skills/planning-routing/ (or wherever /plan dispatch lives). Confirm 6 routers exist (one per orchestrator skill). List paths exactly.\n  2. Enumerate ALL *-mode-multica/ and *-mode-cc-workflows/ atoms under skills/hive/skills/. Confirm 12 atoms total (2 substrates × 6 orchestrators). List paths exactly with verification each SKILL.md exists.\n  3. Enumerate ALL top-level orchestrator skills used for "default" inline cells. Confirm 6 skills: plan, execute, test, design, design-review, review. List skills/<name>/SKILL.md paths exactly. NOTE: /execute may live under plugin-hive plugin path — confirm exact path on disk.\n  4. For each of the 6 default cells, decide whether cell content should be "inline" marker (orchestrator IS the default dispatch surface, no separate atom) OR a specific orchestrator skill path. Per story spec rules (a/b/c), "inline" is the marker for default-path dispatch through the orchestrator skill itself.\n  5. Identify the README.md location (root README.md) and confirm the cross-link target (likely "References" or "Documentation" section).\n  6. Identify skills/hive/skills/planning-routing/SKILL.md (or equivalent) and find the appropriate cross-link location (likely near the dispatch-routing prose).\n  7. Capture all 18 cell entries (6 rows × 3 columns) plus 2 future-footer columns (sandcastle, gh-actions-legacy) as a structured table ready for the developer.\n  8. Identify whether vitest is the test runner; confirm hive/lib/package.json registration pattern. Test path: hive/scripts/test/verify-dispatch-parity.test.mjs (or skills/hive/skills/dispatch-parity/test/, depending on convention).\n  9. Identify whether git ls-files is the right tracked-check mechanism for the CI checker. Confirm exact bash invocation. Confirm node script can shell-out via child_process.\n  10. Write research episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/research.yaml.\n\n  verdict='pass' if all 10 items captured with concrete paths; 'fail' otherwise. Do NOT modify source files (research marker + memory only).`,
  { schema: RESULT_SCHEMA, phase: 'research', label: 'research:enumerate-dispatch-routers-and-mode-atoms', model: 'sonnet' }
);

phase('implement');
const implement = await agent(
  `You are the developer persona — read hive/agents/developer.md.\n\n${baseContext}\n\nResearch summary (verdict=${research?.verdict || 'unknown'}):\n${research?.notes || 'see prior output'}\n\nTASK:\n  1. CREATE hive/references/dispatch-parity.md. STRUCTURE:\n     - H1: "# Dispatch Parity Matrix"\n     - Header prose: "Produced by Slice 6 of substrate-coverage-and-test-cleanup; canonical reference for what's wired across substrates. Each cell carries either a relative path to the active mode-atom skill, the marker \`inline\` for default-path dispatch through the orchestrator skill itself, or \`N/A — reasoning\` when the cell has no shipped substrate."\n     - "## Last verified: 2026-06-08" subsection (baseline ISO date; CI checker will bump on green).\n     - "## Matrix" subsection containing the 6×3 Markdown table:\n\n       | Orchestrator | default | multica | cc-workflows |\n       |---|---|---|---|\n       | plan | inline | skills/hive/skills/plan-mode-multica/SKILL.md | skills/hive/skills/plan-mode-cc-workflows/SKILL.md |\n       | execute | inline | skills/hive/skills/execute-mode-multica/SKILL.md | skills/hive/skills/execute-mode-cc-workflows/SKILL.md |\n       | test | inline | skills/hive/skills/test-mode-multica/SKILL.md | skills/hive/skills/test-mode-cc-workflows/SKILL.md |\n       | design | inline | skills/hive/skills/design-mode-multica/SKILL.md | skills/hive/skills/design-mode-cc-workflows/SKILL.md |\n       | design-review | inline | skills/hive/skills/design-review-mode-multica/SKILL.md | skills/hive/skills/design-review-mode-cc-workflows/SKILL.md |\n       | review | inline | skills/hive/skills/review-mode-multica/SKILL.md | skills/hive/skills/review-mode-cc-workflows/SKILL.md |\n\n     - "## Future substrate" subsection containing a SECOND 6×N Markdown table with footer rows for placeholder substrates (sandcastle, gh-actions-legacy). Each cell = "not-shipped — <one-line reason>" placeholder. Example:\n\n       | Orchestrator | sandcastle | gh-actions-legacy |\n       |---|---|---|\n       | plan | not-shipped — see execution.runtime: sandcastle (Epic D) | not-shipped — superseded by Multica |\n       | execute | not-shipped — see skills/hive/skills/execute-mode-sandcastle/SKILL.md (Epic D candidate) | not-shipped — superseded by Multica |\n       | test | not-shipped | not-shipped — superseded |\n       | design | not-shipped | not-shipped — superseded |\n       | design-review | not-shipped | not-shipped — superseded |\n       | review | not-shipped | not-shipped — superseded |\n\n     - "## Verification" subsection: prose stating "Run \`node hive/scripts/verify-dispatch-parity.mjs\` from repo root. Exit 0 = all cited paths resolve on disk AND \`git ls-files\` confirms tracking. Exit 1 = at least one path missing/untracked; checker prints the failing rows. CI runs this on every PR; PRs that move/remove a cited path fail until the matrix is updated."\n     - "## Cross-references" subsection: explicit reference to README.md and skills/hive/skills/planning-routing/SKILL.md (or whichever dispatch-routing skill research located).\n\n  2. CREATE hive/scripts/verify-dispatch-parity.mjs. Node ESM script. Reads hive/references/dispatch-parity.md, extracts ALL skills/hive/skills/*-mode-*/SKILL.md paths from the matrix (regex over markdown table cells), and for each path:\n     - Asserts \`fs.existsSync(absolutePath)\` returns true.\n     - Asserts \`execSync(\`git ls-files --error-unmatch \${path}\`, { stdio: 'ignore' })\` does not throw.\n     - If a path is "inline" or "N/A …" or "not-shipped …", skip the file-system check.\n     - On any failure, prints the row + cell + expected path and exits 1.\n     - On success, prints "dispatch-parity.md: <N> paths verified" and exits 0.\n     - On success, also UPDATE the "## Last verified: YYYY-MM-DD" line in dispatch-parity.md with today's ISO date (optional --no-bump flag to skip the bump; default behavior bumps).\n     - Add shebang \`#!/usr/bin/env node\` and chmod +x via the executable bit in git.\n\n  3. MODIFY README.md (root). Add a one-line cross-reference to dispatch-parity.md under whatever References / Documentation section exists (or create one if absent — minimal addition). Sample line: "See [Dispatch Parity Matrix](hive/references/dispatch-parity.md) for the canonical 6×3 substrate matrix per /plan, /execute, /test, /design, /design-review, /review."\n\n  4. MODIFY skills/hive/skills/planning-routing/SKILL.md (or whichever dispatch-routing skill exists per research). Add a one-line cross-reference per architect ESCALATION mirror-anchor pattern: "See \`hive/references/dispatch-parity.md\` for the canonical 6×3 substrate matrix this routing skill is one row of."\n\n  5. Write implement episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/implement.yaml.\n\n  Return the structured file list. verdict='pass' on success.`,
  { schema: RESULT_SCHEMA, phase: 'implement', label: 'implement:dispatch-parity-md-and-ci-checker', model: 'sonnet' }
);

phase('test');
const test = await agent(
  `You are the tester persona — read hive/agents/tester.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\n\nResearch findings:\n${research?.notes || ''}\n\nTASK:\n  1. RUN node hive/scripts/verify-dispatch-parity.mjs from repo root. Capture stdout/stderr + exit code. MUST exit 0 with "dispatch-parity.md: <N> paths verified" on stdout. If exit non-zero, capture the failing rows for developer rework.\n  2. CREATE hive/scripts/test/verify-dispatch-parity.test.mjs using vitest. Cover:\n     describe('dispatch-parity matrix structure', ...):\n       - test: hive/references/dispatch-parity.md exists.\n       - test: header cites "produced by Slice 6 of substrate-coverage-and-test-cleanup" verbatim.\n       - test: "## Last verified:" subsection present with ISO date.\n       - test: 6 orchestrator rows exactly (plan/execute/test/design/design-review/review).\n       - test: 3 substrate columns exactly (default/multica/cc-workflows).\n       - test: Future substrate footer present with sandcastle + gh-actions-legacy columns.\n     describe('dispatch-parity cell content', ...):\n       - test: all 6 default cells = "inline".\n       - test: all 12 multica + cc-workflows cells = relative skills/hive/skills/*-mode-*/SKILL.md paths.\n       - test: every cited mode-atom path satisfies fs.existsSync.\n     describe('verify-dispatch-parity CI checker', ...):\n       - test: hive/scripts/verify-dispatch-parity.mjs exists.\n       - test: shebang first line.\n       - test: invoking the script via child_process.execSync exits 0 on the current repo state.\n     describe('cross-references', ...):\n       - test: README.md contains a link to dispatch-parity.md.\n       - test: skills/hive/skills/planning-routing/SKILL.md (or located equivalent) cross-references dispatch-parity.md.\n  3. CREATE .pHive/test-scenarios/s-1-dispatch-parity-smoke.yaml per test-scenario-schema. Spec-walk: (a) operator runs verify-dispatch-parity.mjs locally and sees green; (b) operator opens dispatch-parity.md and reads all 18 + 12 cells; (c) operator follows README cross-link.\n  4. MODIFY hive/lib/package.json scripts.test: APPEND the new vitest path. Preserve existing paths.\n  5. RUN npm test from hive/lib. Confirm full suite green AND new describe blocks all pass. Capture count.\n  6. s-3 no-codex lint is OUT OF SCOPE for s-1 (doc + script, not *-mode-cc-workflows atom). Document.\n  7. Write test episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/test.yaml.\n\n  Return the structured file list. verdict='pass' iff verify-dispatch-parity.mjs exits 0 AND all describe blocks pass AND scenario YAML loads AND full npm test green. Do NOT modify implementation files.`,
  { schema: RESULT_SCHEMA, phase: 'test', label: 'test:s-1-verify-parity-and-matrix-structure', model: 'sonnet' }
);

phase('review');
const review = await agent(
  `You are the reviewer persona — read hive/agents/reviewer.md.\n\n${baseContext}\n\nImplementation files:\n${JSON.stringify(implement?.files || [])}\nTest verdict: ${test?.verdict || 'unknown'} — ${test?.notes || ''}\n\nTASK: Architect review. Confirm:\n  1. hive/references/dispatch-parity.md exists with H1 + header citing Slice 6 self-attribution verbatim.\n  2. "## Last verified: YYYY-MM-DD" block present with current ISO date (2026-06-08).\n  3. 6×3 matrix exact: rows {plan, execute, test, design, design-review, review} × columns {default, multica, cc-workflows}. NO additional or missing rows/columns in the primary matrix.\n  4. All 6 default cells = "inline" (or equivalent orchestrator-skill marker per research decision).\n  5. All 12 substrate cells = relative paths under skills/hive/skills/*-mode-*/SKILL.md. Every path resolves on disk per verify-dispatch-parity.mjs green exit.\n  6. Future-substrate footer present with sandcastle + gh-actions-legacy columns. Each cell carries "not-shipped — <reason>" placeholder. NO false claims of shipped status.\n  7. hive/scripts/verify-dispatch-parity.mjs exists, has shebang, ESM, exits 0 on current repo, exits 1 with diagnostics on missing path.\n  8. verify-dispatch-parity.mjs uses git ls-files (NOT only fs.existsSync) to confirm tracked status.\n  9. Cross-link from README.md present — one-line addition.\n  10. Cross-link from skills/hive/skills/planning-routing/SKILL.md (or located dispatch-routing skill) present per architect ESCALATION mirror-anchor pattern.\n  11. DO NOT clauses honored: NO new substrate atoms authored in s-1; NO line ranges embedded in matrix (paths only).\n  12. NO regression in prior shipped atoms (file scope strictly limited to: hive/references/dispatch-parity.md NEW, hive/scripts/verify-dispatch-parity.mjs NEW, hive/scripts/test/verify-dispatch-parity.test.mjs NEW, .pHive/test-scenarios/s-1-..., hive/lib/package.json scripts.test extension, README.md one-line, planning-routing SKILL.md one-line, episode markers, memory files only).\n\n  change_verdict: passed | needs-rework | needs-discussion. If needs-rework, list exact items + file:line.\n  Write review episode marker at .pHive/episodes/substrate-coverage-and-test-cleanup/${STORY_ID}/review.yaml. Return file list.`,
  { schema: RESULT_SCHEMA, phase: 'review', label: 'review:s-1-parity-matrix-architect-check', model: 'opus' }
);

return {
  research,
  implement,
  test,
  review,
};
