#!/usr/bin/env node
/**
 * verify-dispatch-parity.mjs
 *
 * CI checker for hive/references/dispatch-parity.md.
 * Extracts all mode-atom SKILL.md paths from the matrix,
 * verifies each one exists on disk and is tracked by git, then exits 0.
 *
 * Skips cells that are:
 *   - "inline"           — default-path, no separate file to check
 *   - "N/A …"           — explicitly excluded with reasoning
 *   - "not-shipped …"   — future-substrate placeholder
 *
 * On success: prints "dispatch-parity.md: <N> paths verified" and exits 0.
 *             Also updates the "## Last verified: YYYY-MM-DD" line in the doc
 *             with today's ISO date (pass --no-bump to skip).
 *
 * On failure: prints each failing row + expected path, exits 1.
 *
 * Usage:
 *   node hive/scripts/verify-dispatch-parity.mjs [--no-bump]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const matrixPath = resolve(repoRoot, 'hive', 'references', 'dispatch-parity.md');

const noBump = process.argv.includes('--no-bump');

// Read the dispatch-parity.md file
let content;
try {
  content = readFileSync(matrixPath, 'utf8');
} catch (err) {
  console.error(`ERROR: Cannot read ${matrixPath}: ${err.message}`);
  process.exit(1);
}

// Extract all table cell values that look like skill paths
// Pattern: skills/hive/skills/*-mode-*/SKILL.md
const pathRegex = /skills\/hive\/skills\/[a-z0-9-]+-mode-[a-z0-9-]+\/SKILL\.md/g;
const allMatches = [...content.matchAll(pathRegex)];

if (allMatches.length === 0) {
  console.error('ERROR: No skill paths found in dispatch-parity.md — matrix may be malformed.');
  process.exit(1);
}

// Deduplicate paths (same path may appear in multiple tables)
const uniquePaths = [...new Set(allMatches.map(m => m[0]))];

const failures = [];

for (const relativePath of uniquePaths) {
  const absolutePath = resolve(repoRoot, relativePath);

  // Check disk existence
  if (!existsSync(absolutePath)) {
    failures.push({ path: relativePath, reason: 'not found on disk' });
    continue;
  }

  // Check git tracking
  try {
    execSync(`git ls-files --error-unmatch "${relativePath}"`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    failures.push({ path: relativePath, reason: 'not tracked by git (git ls-files --error-unmatch failed)' });
  }
}

if (failures.length > 0) {
  console.error(`dispatch-parity.md: ${failures.length} path(s) failed verification:`);
  for (const { path, reason } of failures) {
    console.error(`  FAIL  ${path}  —  ${reason}`);
  }
  process.exit(1);
}

console.log(`dispatch-parity.md: ${uniquePaths.length} paths verified`);

// Bump the "## Last verified:" date stamp unless --no-bump was passed
if (!noBump) {
  const today = new Date().toISOString().slice(0, 10);
  const updated = content.replace(
    /^## Last verified: \d{4}-\d{2}-\d{2}/m,
    `## Last verified: ${today}`
  );
  if (updated !== content) {
    writeFileSync(matrixPath, updated, 'utf8');
    console.log(`dispatch-parity.md: Last verified date updated to ${today}`);
  }
}
