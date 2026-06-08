// verify-dispatch-parity.test.mjs
//
// Vitest spec for hive/references/dispatch-parity.md and the
// verify-dispatch-parity.mjs CI checker.
//
// Coverage:
//   describe('dispatch-parity matrix structure'):
//     - hive/references/dispatch-parity.md exists
//     - header cites "produced by Slice 6 of substrate-coverage-and-test-cleanup" verbatim
//     - "## Last verified:" subsection present with ISO date
//     - 6 orchestrator rows exactly (plan/execute/test/design/design-review/review)
//     - 3 substrate columns exactly (default/multica/cc-workflows)
//     - Future substrate footer present with sandcastle + gh-actions-legacy columns
//
//   describe('dispatch-parity cell content'):
//     - all 6 default cells = "inline"
//     - all 12 multica + cc-workflows cells = relative paths
//     - every cited mode-atom path satisfies fs.existsSync
//
//   describe('verify-dispatch-parity CI checker'):
//     - hive/scripts/verify-dispatch-parity.mjs exists
//     - shebang first line
//     - invoking the script via child_process.execSync exits 0 on the current repo state
//
//   describe('cross-references'):
//     - README.md contains a link to dispatch-parity.md
//     - skills/hive/skills/planning-routing/SKILL.md cross-references dispatch-parity.md

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// hive/scripts/test/ → hive/scripts/ → hive/ → project root
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const MATRIX_PATH = resolve(PROJECT_ROOT, 'hive', 'references', 'dispatch-parity.md');
const CHECKER_PATH = resolve(PROJECT_ROOT, 'hive', 'scripts', 'verify-dispatch-parity.mjs');
const README_PATH = resolve(PROJECT_ROOT, 'README.md');
const PLANNING_ROUTING_PATH = resolve(
  PROJECT_ROOT,
  'skills',
  'hive',
  'skills',
  'planning-routing',
  'SKILL.md'
);

// Expected 6 orchestrator rows
const ORCHESTRATOR_ROWS = ['plan', 'execute', 'test', 'design', 'design-review', 'review'];

// Expected substrate columns
const SUBSTRATE_COLS = ['default', 'multica', 'cc-workflows'];

// Expected future substrate columns
const FUTURE_COLS = ['sandcastle', 'gh-actions-legacy'];

// Read matrix content once for the describe blocks that need it
let matrixContent = '';
try {
  matrixContent = readFileSync(MATRIX_PATH, 'utf8');
} catch {
  // Will fail in the existsSync test; other tests will gracefully fail
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse the main (non-future) matrix table rows.
// Returns an array of { orchestrator, default: string, multica: string, ccWorkflows: string }.
function parseMainMatrixRows() {
  // Split into lines and find table rows in the ## Matrix section
  const lines = matrixContent.split('\n');
  const rows = [];
  let inMatrix = false;
  let headerParsed = false;

  for (const line of lines) {
    if (line.startsWith('## Matrix')) {
      inMatrix = true;
      continue;
    }
    if (inMatrix && line.startsWith('## ')) {
      // Entering the next section — stop
      break;
    }
    if (!inMatrix) continue;

    // Table rows start with |
    if (!line.startsWith('|')) continue;
    // Skip separator rows like |---|---|
    if (/^\|[\s\-|]+\|$/.test(line)) continue;
    // Skip header row
    if (!headerParsed) {
      headerParsed = true;
      continue;
    }

    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length >= 4) {
      rows.push({
        orchestrator: cells[0],
        default: cells[1],
        multica: cells[2],
        ccWorkflows: cells[3],
      });
    }
  }
  return rows;
}

// Extract all skills/hive/skills/*-mode-*/SKILL.md paths from the matrix content.
function extractSkillPaths() {
  const pathRegex = /skills\/hive\/skills\/[a-z0-9-]+-mode-[a-z0-9-]+\/SKILL\.md/g;
  return [...new Set([...matrixContent.matchAll(pathRegex)].map((m) => m[0]))];
}

// ---------------------------------------------------------------------------
// Tests: dispatch-parity matrix structure
// ---------------------------------------------------------------------------

describe('dispatch-parity matrix structure', () => {
  it('hive/references/dispatch-parity.md exists', () => {
    expect(existsSync(MATRIX_PATH)).toBe(true);
  });

  it('header cites "produced by Slice 6 of substrate-coverage-and-test-cleanup" verbatim', () => {
    // The document may capitalize the first letter; match case-insensitively
    expect(matrixContent.toLowerCase()).toContain(
      'produced by slice 6 of substrate-coverage-and-test-cleanup'
    );
  });

  it('"## Last verified:" subsection present with ISO date', () => {
    expect(matrixContent).toMatch(/## Last verified: \d{4}-\d{2}-\d{2}/);
  });

  it('has exactly 6 orchestrator rows (plan/execute/test/design/design-review/review)', () => {
    const rows = parseMainMatrixRows();
    const orchestrators = rows.map((r) => r.orchestrator);
    expect(orchestrators).toHaveLength(6);
    for (const name of ORCHESTRATOR_ROWS) {
      expect(orchestrators).toContain(name);
    }
  });

  it('main matrix table header has exactly 3 substrate columns (default/multica/cc-workflows)', () => {
    // Find the header row in the ## Matrix section
    const matrixSection = matrixContent.match(/## Matrix[\s\S]*?(?=## |$)/)?.[0] ?? '';
    const headerLine = matrixSection.split('\n').find((l) => l.startsWith('|') && l.includes('default'));
    expect(headerLine).toBeDefined();
    for (const col of SUBSTRATE_COLS) {
      expect(headerLine).toContain(col);
    }
  });

  it('Future substrate footer is present with sandcastle + gh-actions-legacy columns', () => {
    const futureSection = matrixContent.match(/## Future substrate[\s\S]*?(?=## |$)/)?.[0] ?? '';
    expect(futureSection.length).toBeGreaterThan(0);
    for (const col of FUTURE_COLS) {
      expect(futureSection).toContain(col);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: dispatch-parity cell content
// ---------------------------------------------------------------------------

describe('dispatch-parity cell content', () => {
  it('all 6 default cells equal "inline"', () => {
    const rows = parseMainMatrixRows();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.default).toBe('inline');
    }
  });

  it('all 6 multica cells contain a relative skills/hive/skills/*-mode-multica/SKILL.md path', () => {
    const rows = parseMainMatrixRows();
    for (const row of rows) {
      expect(row.multica).toMatch(/skills\/hive\/skills\/[a-z0-9-]+-mode-multica\/SKILL\.md/);
    }
  });

  it('all 6 cc-workflows cells contain a relative skills/hive/skills/*-mode-cc-workflows/SKILL.md path', () => {
    const rows = parseMainMatrixRows();
    for (const row of rows) {
      expect(row.ccWorkflows).toMatch(
        /skills\/hive\/skills\/[a-z0-9-]+-mode-cc-workflows\/SKILL\.md/
      );
    }
  });

  it('every cited mode-atom path exists on disk', () => {
    const paths = extractSkillPaths();
    expect(paths.length).toBeGreaterThan(0);
    const missing = paths.filter((p) => !existsSync(resolve(PROJECT_ROOT, p)));
    expect(missing).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: verify-dispatch-parity CI checker
// ---------------------------------------------------------------------------

describe('verify-dispatch-parity CI checker', () => {
  it('hive/scripts/verify-dispatch-parity.mjs exists', () => {
    expect(existsSync(CHECKER_PATH)).toBe(true);
  });

  it('first line is a shebang (#!/usr/bin/env node)', () => {
    const firstLine = readFileSync(CHECKER_PATH, 'utf8').split('\n')[0];
    expect(firstLine).toBe('#!/usr/bin/env node');
  });

  it('invoking the script exits 0 on the current repo state', () => {
    let exitCode = 0;
    try {
      execSync(`node ${JSON.stringify(CHECKER_PATH)} --no-bump`, {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
        encoding: 'utf8',
      });
    } catch (err) {
      exitCode = err.status ?? 1;
    }
    expect(exitCode).toBe(0);
  });

  it('script output contains "dispatch-parity.md: <N> paths verified"', () => {
    let stdout = '';
    try {
      stdout = execSync(`node ${JSON.stringify(CHECKER_PATH)} --no-bump`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (err) {
      stdout = err.stdout ?? '';
    }
    expect(stdout).toMatch(/dispatch-parity\.md: \d+ paths verified/);
  });
});

// ---------------------------------------------------------------------------
// Tests: cross-references
// ---------------------------------------------------------------------------

describe('cross-references', () => {
  it('README.md contains a link to dispatch-parity.md', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    expect(readme).toContain('dispatch-parity.md');
  });

  it('skills/hive/skills/planning-routing/SKILL.md cross-references dispatch-parity.md', () => {
    const planningRouting = readFileSync(PLANNING_ROUTING_PATH, 'utf8');
    expect(planningRouting).toContain('dispatch-parity.md');
  });
});
