#!/usr/bin/env node
// gate-claudecode-sandcastle.mjs — audit gate for Sandcastle issue #191.
//
// While https://github.com/mattpocock/sandcastle/issues/191 remains open,
// the `claudeCode()` Sandcastle lane is blocked (subscription auth unimplemented
// upstream). This gate fails if any file in the codebase both imports Sandcastle
// AND calls `claudeCode()`.
//
// Codex-path Sandcastle wiring (`codex()`) is explicitly allowed and never blocked.
//
// Usage: node hive/scripts/gate-claudecode-sandcastle.mjs [--root <path>] [--dry-run]
// Exit 0 — no violations found.
// Exit 1 — one or more claudeCode()+Sandcastle co-occurrences detected.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULTS = {
  root: ".",
  dryRun: false,
};

// Directories to skip entirely
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".pHive",
  "dist",
  "build",
  "coverage",
]);

// Extensions to scan
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts"]);

// Detects a Sandcastle import/require in file content
const RE_SANDCASTLE_IMPORT =
  /(?:import\s[^'"]*['"].*sandcastle.*['"]|require\s*\(\s*['"].*sandcastle.*['"]\s*\))/i;

// Detects a claudeCode() call (the blocked lane)
const RE_CLAUDECODE_CALL = /claudeCode\s*\(/;

// Detects a codex() call (the allowed lane — must NOT block)
// (Used only to confirm allowed fixtures are not accidentally matched.)
const RE_CODEX_CALL = /codex\s*\(/;

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--root") out.root = argv[++i];
    else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

/**
 * Walk a directory recursively, yielding absolute file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(walk(full));
    } else if (entry.isFile() && SCAN_EXTS.has(path.extname(entry.name))) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Audit a single file for the blocked co-occurrence pattern.
 * Returns a violation object if found, null otherwise.
 *
 * A file is violating if:
 *   - It imports/requires sandcastle (RE_SANDCASTLE_IMPORT matches), AND
 *   - It calls claudeCode() (RE_CLAUDECODE_CALL matches)
 *
 * A file is NOT violating (allowed) if it calls codex() instead of claudeCode().
 *
 * @param {string} filePath
 * @returns {{ file: string, reason: string } | null}
 */
function auditFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const hasSandcastle = RE_SANDCASTLE_IMPORT.test(content);
  if (!hasSandcastle) return null;

  const hasClaudeCode = RE_CLAUDECODE_CALL.test(content);
  if (!hasClaudeCode) return null;

  return {
    file: filePath,
    reason:
      "imports Sandcastle AND calls claudeCode() — blocked while issue #191 is open " +
      "(https://github.com/mattpocock/sandcastle/issues/191). " +
      "Use the Codex-path (codex()) instead.",
  };
}

function main() {
  const opts = parseArgs(process.argv);
  const root = path.resolve(opts.root);

  const files = walk(root);
  const violations = [];

  for (const file of files) {
    const v = auditFile(file);
    if (v) violations.push(v);
  }

  if (violations.length === 0) {
    console.log("[gate-claudecode-sandcastle] PASS — no claudeCode()+Sandcastle wiring found.");
    process.exit(0);
  }

  console.error(
    `[gate-claudecode-sandcastle] FAIL — ${violations.length} violation(s) found:`
  );
  for (const v of violations) {
    console.error(`  ${v.file}`);
    console.error(`    ${v.reason}`);
  }

  if (opts.dryRun) {
    console.error("[gate-claudecode-sandcastle] --dry-run: exit suppressed.");
    process.exit(0);
  }

  process.exit(1);
}

main();
