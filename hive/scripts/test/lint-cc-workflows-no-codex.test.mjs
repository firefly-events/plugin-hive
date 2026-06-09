/**
 * lint-cc-workflows-no-codex.test.mjs
 *
 * Vitest spec for the cc-workflows no-codex lint script.
 *
 * Coverage:
 *   Check 1 (agentType-literal-ast):
 *     - positive: clean atom with no agentType routing literal → pass
 *     - negative: code block containing `agentType: "codex:codex-rescue"` → fail
 *     - schema-doc placeholder (`agentType: <default | codex:codex-rescue>`) → NOT flagged
 *
 *   Check 2 (codex-rescue-grep):
 *     - positive: clean atom → pass
 *     - positive: file with codex:codex-rescue ONLY in prose (not code block) → pass
 *     - positive: file with schema placeholder <default | codex:codex-rescue> in code block → pass
 *     - negative: code block containing `codex:codex-rescue` as a bare value → fail
 *
 *   Check 3 (agent-backends-grep):
 *     - positive: clean atom → pass
 *     - positive: file with agent_backends ONLY in prose → pass
 *     - negative: code block containing `agent_backends` → fail
 *
 *   Check 4 (cc-workflows-preconditions-import):
 *     - positive: file containing the helper import fragment → pass
 *     - negative: file missing the helper import fragment → fail with clear pointer
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// hive/scripts/test/ → hive/scripts/ → hive/ → project root
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const LINT_SCRIPT = join(PROJECT_ROOT, 'hive', 'scripts', 'lint-cc-workflows-no-codex.mjs');

// ---------------------------------------------------------------------------
// Runner helper
//
// Writes fixture SKILL.md files under a temp dir that mirrors the expected
// skills/hive/skills/<name>-mode-cc-workflows/SKILL.md layout.
// Patches the SKILLS_BASE line in the lint script so it targets the temp dir.
// Returns { stdout, stderr, exitCode }.
// ---------------------------------------------------------------------------

function runLintWithFixtures(atoms) {
  const tmpBase = mkdtempSync(join(tmpdir(), 'lint-cc-workflows-test-'));
  const skillsBase = join(tmpBase, 'skills', 'hive', 'skills');

  try {
    for (const [name, content] of Object.entries(atoms)) {
      const dir = join(skillsBase, `${name}-mode-cc-workflows`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'SKILL.md'), content, 'utf8');
    }

    // Read the original script and patch SKILLS_BASE to point at tmpBase tree.
    const original = readFileSync(LINT_SCRIPT, 'utf8');
    const patched = original.replace(
      /const SKILLS_BASE = join\(PROJECT_ROOT[^;]*\);/,
      `const SKILLS_BASE = ${JSON.stringify(skillsBase)};`
    );
    const patchedScript = join(tmpBase, 'lint-patched.mjs');
    writeFileSync(patchedScript, patched, 'utf8');

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      stdout = execSync(`node ${JSON.stringify(patchedScript)}`, {
        encoding: 'utf8',
        env: { ...process.env },
      });
    } catch (err) {
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
      exitCode = err.status ?? 1;
    }

    return { stdout, stderr, exitCode };
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HELPER_IMPORT =
  "import { assertWorktreeIsolation } from '../../../hive/lib/cc-workflows-preconditions.mjs';";

/** A minimal clean atom that should pass all 4 checks. */
const CLEAN_ATOM = `# Test Skill

${HELPER_IMPORT}

## Step 0

\`\`\`javascript
${HELPER_IMPORT}
assertWorktreeIsolation();
\`\`\`

This skill does NOT use Codex routing.
`;

/** Clean atom with codex/agent_backends mentions ONLY in prose, not code blocks. */
const CLEAN_ATOM_WITH_PROSE_MENTIONS = `# Test Skill

${HELPER_IMPORT}

Do NOT pass \`agentType: "codex:codex-rescue"\` — it is forbidden here.
The \`agent_backends\` config key does not apply in cc-workflows mode.

\`\`\`yaml
step: cc-workflows-run
persona: developer
\`\`\`
`;

/** Atom with agentType codex:codex-rescue ONLY as schema-doc placeholder in a code block. */
const ATOM_WITH_SCHEMA_PLACEHOLDER = `# Test Skill

${HELPER_IMPORT}

\`\`\`yaml
agentType: <default | codex:codex-rescue>
files: [{path, change}]
\`\`\`
`;

/** Atom with forbidden agentType assignment in a code block. */
const ATOM_WITH_AGENT_TYPE_VIOLATION = `# Test Skill

${HELPER_IMPORT}

\`\`\`javascript
const result = await agent({ agentType: "codex:codex-rescue", persona: "developer" });
\`\`\`
`;

/** Atom with codex:codex-rescue as a bare skill reference in a code block. */
const ATOM_WITH_CODEX_RESCUE_IN_CODE = `# Test Skill

${HELPER_IMPORT}

\`\`\`javascript
const result = await invokeSkill("codex:codex-rescue", { task: "fix it" });
\`\`\`
`;

/** Atom with agent_backends used as a routing directive in a code block. */
const ATOM_WITH_AGENT_BACKENDS_IN_CODE = `# Test Skill

${HELPER_IMPORT}

\`\`\`javascript
const backend = config.agent_backends["developer"];
runVia(backend);
\`\`\`
`;

/** Atom missing the cc-workflows-preconditions helper import. */
const ATOM_WITHOUT_IMPORT = `# Test Skill

## Step 0

\`\`\`javascript
// No helper import here
\`\`\`
`;

// ---------------------------------------------------------------------------
// Tests: Check 1 (agentType-literal-ast)
// ---------------------------------------------------------------------------

describe('Check 1 (agentType-literal-ast)', () => {
  it('passes for a clean atom with no agentType routing literal', () => {
    const { exitCode } = runLintWithFixtures({ clean: CLEAN_ATOM });
    expect(exitCode).toBe(0);
  });

  it('fails when a code block contains agentType: "codex:codex-rescue"', () => {
    const { exitCode, stderr } = runLintWithFixtures({
      violated: ATOM_WITH_AGENT_TYPE_VIOLATION,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('agentType-literal-ast');
  });

  it('reports the offending line number in the failure message', () => {
    const { stderr } = runLintWithFixtures({
      violated: ATOM_WITH_AGENT_TYPE_VIOLATION,
    });
    // Should contain a line reference pattern like `:N:`
    expect(stderr).toMatch(/:\d+:/);
  });

  it('does NOT flag schema-doc placeholder agentType: <default | codex:codex-rescue>', () => {
    const { exitCode } = runLintWithFixtures({
      placeholder: ATOM_WITH_SCHEMA_PLACEHOLDER,
    });
    expect(exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Check 2 (codex-rescue-grep)
// ---------------------------------------------------------------------------

describe('Check 2 (codex-rescue-grep)', () => {
  it('passes for a clean atom', () => {
    const { exitCode } = runLintWithFixtures({ clean: CLEAN_ATOM });
    expect(exitCode).toBe(0);
  });

  it('passes when codex:codex-rescue appears only in prose (not code blocks)', () => {
    const { exitCode } = runLintWithFixtures({
      prose: CLEAN_ATOM_WITH_PROSE_MENTIONS,
    });
    expect(exitCode).toBe(0);
  });

  it('passes for schema-doc placeholder in a code block (angle-bracket form)', () => {
    const { exitCode } = runLintWithFixtures({
      placeholder: ATOM_WITH_SCHEMA_PLACEHOLDER,
    });
    expect(exitCode).toBe(0);
  });

  it('fails when codex:codex-rescue appears as a bare value in a code block', () => {
    const { exitCode, stderr } = runLintWithFixtures({
      violated: ATOM_WITH_CODEX_RESCUE_IN_CODE,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('codex-rescue-grep');
  });
});

// ---------------------------------------------------------------------------
// Tests: Check 3 (agent-backends-grep)
// ---------------------------------------------------------------------------

describe('Check 3 (agent-backends-grep)', () => {
  it('passes for a clean atom', () => {
    const { exitCode } = runLintWithFixtures({ clean: CLEAN_ATOM });
    expect(exitCode).toBe(0);
  });

  it('passes when agent_backends appears only in prose', () => {
    const { exitCode } = runLintWithFixtures({
      prose: CLEAN_ATOM_WITH_PROSE_MENTIONS,
    });
    expect(exitCode).toBe(0);
  });

  it('fails when agent_backends appears in a code block', () => {
    const { exitCode, stderr } = runLintWithFixtures({
      violated: ATOM_WITH_AGENT_BACKENDS_IN_CODE,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('agent-backends-grep');
  });
});

// ---------------------------------------------------------------------------
// Tests: Check 4 (cc-workflows-preconditions-import)
// ---------------------------------------------------------------------------

describe('Check 4 (cc-workflows-preconditions-import)', () => {
  it('passes when the file contains the helper import fragment', () => {
    const { exitCode } = runLintWithFixtures({ clean: CLEAN_ATOM });
    expect(exitCode).toBe(0);
  });

  it('fails when the helper import is missing', () => {
    const { exitCode, stderr } = runLintWithFixtures({
      noimport: ATOM_WITHOUT_IMPORT,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('cc-workflows-preconditions-import');
  });

  it('failure message includes the expected import fragment', () => {
    const { stderr } = runLintWithFixtures({
      noimport: ATOM_WITHOUT_IMPORT,
    });
    expect(stderr).toContain('hive/lib/cc-workflows-preconditions.mjs');
  });
});

// ---------------------------------------------------------------------------
// Composite: clean atom passes all 4 checks
// ---------------------------------------------------------------------------

describe('Composite: all 4 checks pass on a clean atom', () => {
  it('exits 0 for a fully compliant atom', () => {
    const { exitCode } = runLintWithFixtures({ good: CLEAN_ATOM });
    expect(exitCode).toBe(0);
  });
});
