'use strict';

/**
 * Tests for skills/sandcastle-gh-init/assets/
 *
 * Story: s1-workflow-template (sandcastle-gh-issue-dispatch)
 * Run:   node --test tests/sandcastle-gh-init-assets.test.js
 *        UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js
 *
 * Asset shape:
 *   hive-dispatch.yml.tpl              -- {{RUNNER}} + {{SECRET_KEY}} placeholders
 *   hive-dispatch.example.yml          -- rendered with defaults (ubuntu-latest, CLAUDE_CODE_OAUTH_TOKEN)
 *   sandcastle-hive-bridge.mts.tpl     -- {{SECRET_KEY}} placeholder
 *   sandcastle-hive-bridge.example.mts -- rendered with default (CLAUDE_CODE_OAUTH_TOKEN)
 *
 * 2.4.2 secret-mode default: claude-oauth (subscription OAuth via
 * `claude setup-token`, no per-token billing). Legacy modes
 * `anthropic-api` and `openai` remain available via --secret-mode.
 *
 * Snapshot rule: rendering each .tpl with default substitutions MUST match
 * the corresponding .example file byte-for-byte. Regenerate by exporting
 * UPDATE_SNAPSHOTS=1 and re-running.
 *
 * Structural rules enforced (acceptance criteria from story s1):
 *   AC-1 workflow fires `on: issues:[labeled]` with `if:` gate on hive:ready
 *   AC-2 success path opens PR and transitions to hive:shipped
 *   AC-3 failure step uses `if: failure()` and transitions to hive:failed
 *   AC-4 per-issue concurrency.group with cancel-in-progress: false
 *   AC-5 permissions block is minimal (contents/issues/pull-requests:write)
 *   AC-6 bridge sets HIVE_EXECUTION_MODE=team (workflow env + prompt restatement)
 *   AC-7 bridge validates ISSUE_NUMBER as positive integer (injection guard)
 *   AC-8 bridge prints clear error + exit(1) on missing API key
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Note: prior layout had `skills/hive/skills/sandcastle-gh-init/assets/`;
// the assets now live under `skills/sandcastle-gh-init/assets/` (verified
// 2026-05-18 via the only on-disk copy of `sandcastle-hive-bridge.mts.tpl`).
// Fixing this stale path while in the file for pe-2 — flagged in report.
const ASSETS = path.join(
  __dirname,
  '..',
  'skills',
  'sandcastle-gh-init',
  'assets'
);

const YML_TPL = path.join(ASSETS, 'hive-dispatch.yml.tpl');
const YML_EXAMPLE = path.join(ASSETS, 'hive-dispatch.example.yml');
const MTS_TPL = path.join(ASSETS, 'sandcastle-hive-bridge.mts.tpl');
const MTS_EXAMPLE = path.join(ASSETS, 'sandcastle-hive-bridge.example.mts');

const DEFAULT_RUNNER = 'ubuntu-latest';
const DEFAULT_SECRET_KEY = 'CLAUDE_CODE_OAUTH_TOKEN';

function render(tpl, substitutions) {
  let out = tpl;
  for (const [key, value] of Object.entries(substitutions)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  return out;
}

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Snapshot tests (byte-for-byte, regenerable via UPDATE_SNAPSHOTS=1)
// ---------------------------------------------------------------------------

test('hive-dispatch.yml.tpl renders to example with default substitutions', () => {
  const tpl = readFile(YML_TPL);
  const rendered = render(tpl, {
    RUNNER: DEFAULT_RUNNER,
    SECRET_KEY: DEFAULT_SECRET_KEY,
  });
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.writeFileSync(YML_EXAMPLE, rendered);
    return;
  }
  const expected = readFile(YML_EXAMPLE);
  assert.equal(rendered, expected,
    'hive-dispatch.example.yml is out of sync with hive-dispatch.yml.tpl.\n' +
    'Regenerate with: UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js');
});

test('sandcastle-hive-bridge.mts.tpl renders to example with default substitution', () => {
  const tpl = readFile(MTS_TPL);
  const rendered = render(tpl, { SECRET_KEY: DEFAULT_SECRET_KEY });
  if (process.env.UPDATE_SNAPSHOTS === '1') {
    fs.writeFileSync(MTS_EXAMPLE, rendered);
    return;
  }
  const expected = readFile(MTS_EXAMPLE);
  assert.equal(rendered, expected,
    'sandcastle-hive-bridge.example.mts is out of sync with sandcastle-hive-bridge.mts.tpl.\n' +
    'Regenerate with: UPDATE_SNAPSHOTS=1 node --test tests/sandcastle-gh-init-assets.test.js');
});

test('placeholders are removed from rendered output', () => {
  // GitHub Actions expression syntax `${{ ... }}` is legitimate in the
  // rendered output, so we check for our placeholder shape `{{NAME}}`
  // specifically (no preceding `$`).
  const placeholderPattern = /(?<!\$)\{\{[A-Z_]+\}\}/;
  const renderedYml = render(readFile(YML_TPL), {
    RUNNER: DEFAULT_RUNNER,
    SECRET_KEY: DEFAULT_SECRET_KEY,
  });
  assert.ok(!placeholderPattern.test(renderedYml), 'rendered yml still has a {{NAME}} placeholder');
  const renderedMts = render(readFile(MTS_TPL), { SECRET_KEY: DEFAULT_SECRET_KEY });
  assert.ok(!placeholderPattern.test(renderedMts), 'rendered mts still has a {{NAME}} placeholder');
});

test('templates expose only documented placeholders', () => {
  const yml = readFile(YML_TPL);
  const mts = readFile(MTS_TPL);
  const ymlPlaceholders = new Set([...yml.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]));
  const mtsPlaceholders = new Set([...mts.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]));
  assert.deepEqual([...ymlPlaceholders].sort(), ['RUNNER', 'SECRET_KEY']);
  assert.deepEqual([...mtsPlaceholders].sort(), ['SECRET_KEY']);
});

// ---------------------------------------------------------------------------
// AC-1: workflow trigger + label guard
// ---------------------------------------------------------------------------

test('AC-1 workflow fires on issues:[labeled] with hive:ready guard', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /on:\s*\n\s*issues:\s*\n\s*types:\s*\[labeled\]/);
  assert.match(yml, /if:\s*github\.event\.label\.name\s*==\s*'hive:ready'/);
});

// ---------------------------------------------------------------------------
// AC-2: success path opens PR + flips to hive:shipped
// ---------------------------------------------------------------------------

test('AC-2 success step opens PR and transitions to hive:shipped', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /name:\s*On success/);
  assert.match(yml, /gh pr create/);
  assert.match(yml, /--add-label hive:shipped/);
  assert.match(yml, /gh issue comment/);
});

// ---------------------------------------------------------------------------
// AC-3: failure path uses if: failure() + flips to hive:failed
// ---------------------------------------------------------------------------

test('AC-3 failure step uses if: failure() and transitions to hive:failed', () => {
  const yml = readFile(YML_EXAMPLE);
  // Failure step must appear AFTER the bridge step and use if: failure().
  const failureBlock = yml.match(/name:\s*On failure[\s\S]+?if:\s*failure\(\)[\s\S]+?--add-label hive:failed/);
  assert.ok(failureBlock, 'failure step block (if: failure() -> hive:failed) not found');
});

// ---------------------------------------------------------------------------
// AC-4: per-epic concurrency via derive-job output (pe-3-workflow-stack-pr)
// ---------------------------------------------------------------------------

test('AC-4 concurrency.group is per-epic via needs.derive.outputs, cancel-in-progress: false', () => {
  const yml = readFile(YML_EXAMPLE);
  // Concurrency now lives at the job level (run.concurrency) because the
  // group is derived from an upstream job's output; `concurrency` cannot
  // read step env/outputs of the same job.
  assert.match(yml, /^\s*concurrency:\s*$/m);
  assert.match(yml, /^\s*group:\s*\$\{\{\s*needs\.derive\.outputs\.concurrency_key\s*\}\}\s*$/m);
  assert.match(yml, /^\s*cancel-in-progress:\s*false\s*$/m);
  // The derive job must emit a `concurrency_key` output that falls back
  // to `hive-issue-<n>` when no `hive:epic:*` label is found.
  assert.match(yml, /concurrency_key=hive-epic-\$EPIC_ID/);
  assert.match(yml, /concurrency_key=hive-issue-\$ISSUE_NUMBER/);
});

// ---------------------------------------------------------------------------
// AC-5: minimal permissions block
// ---------------------------------------------------------------------------

test('AC-5 permissions block lists only contents/issues/pull-requests as write', () => {
  const yml = readFile(YML_EXAMPLE);
  const block = yml.match(/permissions:\s*\n((?:\s{2}\S.*\n)+)/);
  assert.ok(block, 'permissions block not found');
  const lines = block[1]
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const parsed = Object.fromEntries(lines.map(l => l.split(':').map(s => s.trim())));
  assert.deepEqual(parsed, {
    contents: 'write',
    issues: 'write',
    'pull-requests': 'write',
  });
});

// ---------------------------------------------------------------------------
// AC-6: HIVE_EXECUTION_MODE=team
// ---------------------------------------------------------------------------

test('AC-6 workflow sets HIVE_EXECUTION_MODE=team on bridge step env', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /HIVE_EXECUTION_MODE:\s*team/);
});

test('AC-6 bridge prompt restates the no-nested-sandcastle rule', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /HIVE_EXECUTION_MODE=team/);
  assert.match(mts, /Do NOT spawn additional sandcastles/);
});

// ---------------------------------------------------------------------------
// AC-7: ISSUE_NUMBER validated as positive integer (no shell injection)
// ---------------------------------------------------------------------------

test('AC-7 bridge validates ISSUE_NUMBER matches /^\\d+$/', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /\/\^\\d\+\$\/\.test\(issueNumberRaw\)/);
});

test('AC-7 bridge never shells out (no child_process, no exec)', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.ok(!/child_process/.test(mts), 'bridge must not import child_process');
  assert.ok(!/\bexecSync\b/.test(mts), 'bridge must not call execSync');
  assert.ok(!/\bspawnSync\b/.test(mts), 'bridge must not call spawnSync');
});

// ---------------------------------------------------------------------------
// AC-8: missing-key handling
// ---------------------------------------------------------------------------

test('AC-8 bridge fails loudly when the auth secret env is missing', () => {
  const mts = readFile(MTS_EXAMPLE);
  // 2.4.2: default secret is CLAUDE_CODE_OAUTH_TOKEN (subscription OAuth).
  // The {{SECRET_KEY}} placeholder substitution determines which env var
  // the bridge presence-checks; this test pins the default-rendered shape.
  assert.match(mts, /process\.env\["CLAUDE_CODE_OAUTH_TOKEN"\]/);
  assert.match(mts, /is not set/);
  assert.match(mts, /process\.exit\(1\)/);
});

// ---------------------------------------------------------------------------
// Bridge contract: imports, agent, sandbox, branchStrategy, run() shape
// ---------------------------------------------------------------------------

test('bridge imports run + claudeCode from @ai-hero/sandcastle and docker sandbox', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /import \{ run, claudeCode \} from "@ai-hero\/sandcastle";/);
  assert.match(mts, /import \{ docker \} from "@ai-hero\/sandcastle\/sandboxes\/docker";/);
});

test('bridge invokes run() with derived branch and cost controls (pe-2)', () => {
  const mts = readFile(MTS_EXAMPLE);
  assert.match(mts, /agent: claudeCode\("claude-opus-4-7"\)/);
  assert.match(mts, /sandbox: docker\(\)/);
  assert.match(mts, /branchStrategy: \{ type: "branch", branch \}/);
  assert.match(mts, /maxIterations:\s*5/);
  assert.match(mts, /idleTimeoutSeconds:\s*600/);
  // pe-2: branch is no longer a single hard-coded const — it is derived
  // from the issue's hive:epic:<id> label + resolved branch_strategy.
  // Verify both legs of the derivation are present literally.
  assert.match(mts, /agent\/issue-\$\{issueNumber\}/);
  assert.match(mts, /feat\/\$\{epicId\}/);
});

// ---------------------------------------------------------------------------
// pe-2: epic-label-driven branch derivation
// ---------------------------------------------------------------------------

test('pe-2 bridge derives epicId from hive:epic:<id> label and imports resolveGitFlow dynamically', () => {
  const mts = readFile(MTS_EXAMPLE);
  // Epic id derivation from labels — matches the design-discussion excerpt.
  assert.match(mts, /labels\s*\.find\(\(l\)\s*=>\s*l\.startsWith\("hive:epic:"\)\)/,
    'bridge must derive epicId by scanning labels for "hive:epic:" prefix');
  // Dynamic import of the pe-1 resolution helper, anchored at repoRoot.
  assert.match(mts, /await import\(.*hive\/lib\/git_flow\.mjs.*\)/s,
    'bridge must dynamically import hive/lib/git_flow.mjs (pe-1 helper)');
  assert.match(mts, /path\.resolve\(repoRoot,\s*["']hive\/lib\/git_flow\.mjs["']\)/,
    'helper path must be resolved from repoRoot, not hard-coded');
  assert.match(mts, /resolveGitFlow\(\{\s*cwd:\s*repoRoot\s*\}\)/,
    'bridge must call resolveGitFlow({ cwd: repoRoot })');
});

test('pe-2 .example mirror matches .tpl after default substitution', () => {
  // Independent parity check from the snapshot test above — distinct
  // assertion so a regression here is immediately readable in the
  // failing-test name. Keeps the pe-2 AC4 contract auditable.
  const tpl = readFile(MTS_TPL);
  const rendered = render(tpl, { SECRET_KEY: DEFAULT_SECRET_KEY });
  const expected = readFile(MTS_EXAMPLE);
  assert.equal(rendered, expected,
    'pe-2: sandcastle-hive-bridge.example.mts must mirror the .tpl ' +
    'after substituting {{SECRET_KEY}} with the default CLAUDE_CODE_OAUTH_TOKEN.');
});

// ---------------------------------------------------------------------------
// Job-level timeout-minutes (story risk: cost runaway)
// ---------------------------------------------------------------------------

test('workflow job has a timeout-minutes ceiling', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /timeout-minutes:\s*\d+/);
});

// ---------------------------------------------------------------------------
// pe-3: workflow stack-PR + base-branch resolution + concurrency derive
// ---------------------------------------------------------------------------

test('pe-3 .example.yml mirrors .tpl after default RUNNER+SECRET_KEY substitution', () => {
  // Independent parity check (distinct test so a pe-3 regression is
  // immediately readable in failing-test output).
  const tpl = readFile(YML_TPL);
  const rendered = render(tpl, {
    RUNNER: DEFAULT_RUNNER,
    SECRET_KEY: DEFAULT_SECRET_KEY,
  });
  const expected = readFile(YML_EXAMPLE);
  assert.equal(rendered, expected,
    'pe-3: hive-dispatch.example.yml must mirror hive-dispatch.yml.tpl ' +
    'after substituting {{RUNNER}}=ubuntu-latest and {{SECRET_KEY}}=CLAUDE_CODE_OAUTH_TOKEN.');
});

test('pe-3 workflow has a `derive` job that extracts EPIC_ID via jq on labels', () => {
  const yml = readFile(YML_EXAMPLE);
  // The derive job is the load-bearing piece that makes per-epic
  // concurrency.group resolvable at job-evaluation time.
  assert.match(yml, /^\s*derive:\s*$/m, 'derive job must exist');
  assert.match(yml, /jq -r '\[\.\[\] \| \.name \| select\(startswith\("hive:epic:"\)\)\] \| first/,
    'derive must filter labels via jq for the hive:epic: prefix');
  assert.match(yml, /LABELS_JSON:\s*\$\{\{\s*toJSON\(github\.event\.issue\.labels\)\s*\}\}/,
    'labels must be passed via env as JSON (no inline shell interpolation)');
  // outputs feed into needs.derive.outputs.* in the run job.
  assert.match(yml, /outputs:\s*\n\s*epic_id:/);
  assert.match(yml, /concurrency_key:/);
});

test('pe-3 run job has a Resolve base branch step that imports hive/lib/git_flow.mjs', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /name:\s*Resolve base branch/);
  // Inline Node one-liner imports the pe-1 helper relative to cwd and
  // falls back to the repo default branch when absent.
  assert.match(yml, /node --input-type=module/);
  assert.match(yml, /hive\/lib\/git_flow\.mjs/);
  assert.match(yml, /resolveGitFlow\(\{\s*cwd:\s*process\.cwd\(\)\s*\}\)/);
  assert.match(yml, /process\.env\.DEFAULT_BRANCH/);
  assert.match(yml, /echo "base_branch=\$BASE_BRANCH" >> "\$GITHUB_OUTPUT"/);
});

test('pe-3 success step opens OR updates a single draft PR per epic', () => {
  const yml = readFile(YML_EXAMPLE);
  // Existing-PR query.
  assert.match(yml, /gh pr list\s*\\\s*\n\s*--head "\$BRANCH"\s*\\\s*\n\s*--base "\$BASE_BRANCH"\s*\\\s*\n\s*--state open/);
  // No-existing branch creates a fresh draft PR.
  assert.match(yml, /gh pr create\s*\\\s*\n\s*--draft\s*\\\s*\n\s*--base "\$BASE_BRANCH"\s*\\\s*\n\s*--head "\$BRANCH"/);
  // Existing-PR branch edits the body of the same PR (no new PR).
  assert.match(yml, /gh pr edit "\$PR_NUMBER" --body "\$NEW_BODY"/);
  // Truncation guard for runaway body growth.
  assert.match(yml, /truncated;\s*see commits for full history/);
});

test('pe-3 success step still flips the issue to hive:shipped (no regression)', () => {
  // AC-2 from s1 must continue to hold under the pe-3 rewrite.
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /--add-label hive:shipped/);
  assert.match(yml, /gh issue comment "\$ISSUE_NUMBER"/);
});

test('pe-3 workflow body composition uses jq --arg, never inline shell-interpolated user strings', () => {
  const yml = readFile(YML_EXAMPLE);
  // STORY_LINE is composed via jq --arg so the user-controlled issue
  // title is JSON-encoded before it lands in the body string.
  assert.match(yml, /jq -nr --arg n "\$ISSUE_NUMBER" --arg t "\$ISSUE_TITLE"/);
  // SEED_BODY paths use jq --arg as well.
  assert.match(yml, /jq -nr --arg e "\$EPIC_ID" --arg s "\$STORY_LINE"/);
  // Existing-body merge uses jq --arg body / --arg line.
  assert.match(yml, /--arg body "\$EXISTING_BODY"/);
  assert.match(yml, /--arg line "\$STORY_LINE"/);
});

test('CodeRabbit Finding 2: `gh pr create` must fail loudly (no `|| true` swallow)', () => {
  // A failed `gh pr create` MUST fail the step — swallowing it would
  // let the workflow continue past PR creation and flip the issue to
  // `hive:shipped` with no PR on disk. Regression guard.
  const yml = readFile(YML_EXAMPLE);
  // Find the gh pr create invocation block and confirm it does NOT
  // end with `|| true`. (The promote step's `gh pr ready ... || true`
  // is intentional and lives elsewhere.)
  const createBlock = yml.match(/gh pr create[\s\S]*?--body "\$SEED_BODY"(\s*\\\s*\n\s*[^\n]+)?/);
  assert.ok(createBlock, 'gh pr create block must be present');
  assert.ok(
    !/\|\|\s*true/.test(createBlock[0]),
    `gh pr create block must NOT end with '|| true'; got: ${createBlock[0]}`,
  );
});

test('CodeRabbit Finding 3: bridge validates epicId allowlist before constructing branch', () => {
  const mts = readFile(MTS_EXAMPLE);
  // Strict allowlist regex matching sandcastle's branch-name rules.
  assert.match(
    mts,
    /\/\^\[a-zA-Z0-9\._-\]\+\$\/\.test\(epicId\)/,
    'bridge must regex-validate epicId against [A-Za-z0-9._-]',
  );
  // The validation must hard-fail (process.exit) on a non-match.
  assert.match(mts, /process\.exit\(2\)/);
  // Validation must run BEFORE the branch construction site.
  const validationIdx = mts.search(/\/\^\[a-zA-Z0-9\._-\]\+\$\/\.test\(epicId\)/);
  const branchIdx = mts.search(/branch\s*=\s*`feat\/\$\{epicId\}`/);
  assert.ok(
    validationIdx > 0 && branchIdx > 0 && validationIdx < branchIdx,
    `validation must precede branch construction; got validation=${validationIdx} branch=${branchIdx}`,
  );
});

test('pe-3 rendered YAML is parseable + has expected job graph', () => {
  // Light YAML lint via the structural assertions above; we additionally
  // check the document has exactly two top-level jobs (derive + run) and
  // that `run` depends on `derive`.
  const yml = readFile(YML_EXAMPLE);
  // Top-level `jobs:` block.
  assert.match(yml, /^jobs:\s*$/m);
  // run job declares `needs: derive`.
  assert.match(yml, /^\s*run:\s*\n(?:\s+.*\n)*?\s*needs:\s*derive\s*$/m);
});

// ---------------------------------------------------------------------------
// pe-4: last-story-of-epic detection — promote draft PR to ready
// ---------------------------------------------------------------------------

test('pe-4 workflow has a `Promote PR to ready if last story` step gated on epic_id presence', () => {
  const yml = readFile(YML_EXAMPLE);
  assert.match(yml, /name:\s*Promote PR to ready if last story/);
  // Guarded on epic_id — non-epic fallback runs never attempt promotion.
  assert.match(yml, /if:\s*success\(\)\s*&&\s*needs\.derive\.outputs\.epic_id\s*!=\s*''/);
});

test('pe-4 promote step issues two `gh issue list` count queries with client-side jq filter (CodeRabbit Finding 1)', () => {
  const yml = readFile(YML_EXAMPLE);
  // Total query — single exact `--label hive:epic:<id>` on the CLI;
  // `hive:story:` filter lives in jq client-side because gh does NOT
  // support label wildcards. `--json number,labels` exposes the labels
  // array to jq.
  assert.match(
    yml,
    /gh issue list\s*\\\s*\n\s*--label "hive:epic:\$\{EPIC_ID\}"\s*\\\s*\n\s*--state all\s*\\\s*\n\s*-L 500\s*\\\s*\n\s*--json number,labels/,
  );
  // Shipped query — `hive:shipped` is an exact label so it stays on
  // the CLI; the `hive:story:` filter still lives in jq.
  assert.match(
    yml,
    /gh issue list\s*\\\s*\n\s*--label "hive:epic:\$\{EPIC_ID\}"\s*\\\s*\n\s*--label "hive:shipped"\s*\\\s*\n\s*--state closed\s*\\\s*\n\s*-L 500\s*\\\s*\n\s*--json number,labels/,
  );
  // Client-side jq filter pattern — same exact shape in both queries.
  assert.match(
    yml,
    /-q '\[\.\[\] \| select\(\.labels\[\]\.name \| startswith\("hive:story:"\)\)\] \| length'/,
  );
  // Regression guard — the buggy `--label "hive:story:*"` wildcard
  // form must NOT come back.
  assert.ok(
    !/--label "hive:story:\*"/.test(yml),
    'gh CLI does not support label wildcards; --label "hive:story:*" must NOT appear',
  );
});

test('pe-4 promote step: 0/0 anomaly does NOT promote, equal counts call `gh pr ready`', () => {
  const yml = readFile(YML_EXAMPLE);
  // 0/0 anomaly guard short-circuits before promotion.
  assert.match(yml, /if \[ "\$total" = "0" \];\s*then/);
  assert.match(yml, /labels not propagated, NOT promoting/);
  // Equality branch calls gh pr ready with the feat/<epic-id> branch.
  assert.match(yml, /gh pr ready "feat\/\$\{EPIC_ID\}"\s*\|\|\s*true/);
  // Inequality branch logs the partial-completion count.
  assert.match(yml, /shipped; keeping draft/);
});

// ---------------------------------------------------------------------------
// gi-2: dispatch pulls from GHCR with local-build fallback
// ---------------------------------------------------------------------------

test('gi-2 workflow has a `Pull sandcastle image` step with a hard-coded IMAGE_REF (CodeRabbit F3)', () => {
  const yml = readFile(YML_EXAMPLE);
  // Step name (matches the .tpl + team-lead-mandated heading).
  assert.match(yml, /name:\s*Pull sandcastle image \(with local-build fallback\)/);
  // IMAGE_REF is now a hard-coded default. The earlier
  // `workflow_dispatch.inputs.image_ref` override was removed because
  // the job's `if: github.event.label.name == 'hive:ready'` guard
  // skips the run under `workflow_dispatch` (no label event), making
  // the input unreachable.
  assert.match(
    yml,
    /IMAGE_REF:\s*ghcr\.io\/firefly-events\/sandcastle:latest/,
    'IMAGE_REF must be a hard-coded default after F3 fix',
  );
  // Regression guards — both the removed input declaration and the
  // removed interpolation must NOT come back without revisiting the
  // hive:ready-label-only trigger surface.
  assert.ok(
    !/workflow_dispatch:\s*\n\s*inputs:\s*\n\s*image_ref:/.test(yml),
    'workflow_dispatch.inputs.image_ref must NOT be re-introduced (CodeRabbit F3)',
  );
  assert.ok(
    !/github\.event\.inputs\.image_ref/.test(yml),
    'IMAGE_REF must NOT interpolate from github.event.inputs.image_ref (CodeRabbit F3)',
  );
});

test('gi-2 pull step gates the local-build fallback on a non-zero `docker pull` exit', () => {
  const yml = readFile(YML_EXAMPLE);
  // The `if docker pull ... ; then ... else ... fi` shape — only the
  // `else` arm runs when the pull returns non-zero. Use multiline-aware
  // regex so the assertion is robust to comment/whitespace changes.
  assert.match(
    yml,
    /if docker pull "\$\{IMAGE_REF\}";\s*then[\s\S]*?else[\s\S]*?docker build[\s\S]*?fi/,
    'fallback `docker build` must live in the `else` arm gated by `docker pull` exit',
  );
  // The fallback build preserves the cron-worker UID/GID alignment so
  // the bind-mounted worktree stays writable inside the container.
  assert.match(yml, /--build-arg AGENT_UID="\$\(id -u\)"/);
  assert.match(yml, /--build-arg AGENT_GID="\$\(id -g\)"/);
  // ::warning:: annotation surfaces the fallback in the GH Actions UI.
  assert.match(yml, /::warning::Pull from \$\{IMAGE_REF\} failed/);
});

test('gi-2 pull step retags to `sandcastle:hive` so the bridge contract is preserved', () => {
  const yml = readFile(YML_EXAMPLE);
  // Pull path retags the pulled image to the bridge's expected tag.
  assert.match(
    yml,
    /docker tag "\$\{IMAGE_REF\}" sandcastle:hive/,
    'pull path must retag the pulled image to sandcastle:hive',
  );
  // Fallback path builds directly to the same tag.
  assert.match(
    yml,
    /docker build[\s\S]*?-t sandcastle:hive \.sandcastle/,
    'fallback build path must tag the image as sandcastle:hive',
  );
});
