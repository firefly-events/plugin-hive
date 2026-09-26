#!/usr/bin/env node
/**
 * lint-cc-workflows-no-codex.mjs
 *
 * Multi-surface lint for cc-workflows atoms.
 * Scope: skills/hive/skills/*-mode-cc-workflows/SKILL.md ONLY.
 *
 * Four checks — each runs against every scoped file:
 *
 *   Check 1 (agentType-literal-ast):
 *     Scans Markdown fenced code blocks for `agentType:` property assignments
 *     whose value is `codex:codex-rescue` (quoted or unquoted). Uses a
 *     hand-rolled regex over extracted code-block content (no JS AST parser
 *     required; the target files are Markdown, not pure JS).
 *     The angle-bracket schema-doc placeholder
 *     `agentType: <default | codex:codex-rescue>` does NOT match because
 *     `<` is neither a quote character nor the start of the literal string.
 *     Limit: prose paragraphs outside fenced blocks are not scanned.
 *
 *   Check 2 (codex-rescue-grep):
 *     Greps the fenced code blocks in each file for the literal substring
 *     `codex:codex-rescue` as a routing/skill-invocation reference. Prose
 *     prohibition paragraphs are excluded — only code blocks are scanned so
 *     existing prohibition documentation does not false-positive.
 *     Limit: scanning is limited to fenced code blocks (``` ... ```); inline
 *     code spans (single backtick) and bare prose outside backtick fences are
 *     not matched.
 *
 *   Check 3 (agent-backends-grep):
 *     Greps the fenced code blocks in each file for the literal substring
 *     `agent_backends` used as a routing directive. Current atoms only
 *     reference it in prose; any new occurrence inside a code block is flagged
 *     for manual review.
 *     Limit: same code-block scope as Check 2.
 *
 *   Check 4 (cc-workflows-preconditions-import):
 *     Asserts every scoped SKILL.md contains the helper-import module path
 *     fragment `hive/lib/cc_workflows_preconditions.py` anywhere in the
 *     file (typically in a Step 0 code block).
 *     Limit: transitive imports beyond depth 1 are NOT checked. If a future
 *     helper module itself imports cc_workflows_preconditions.py, the chain
 *     is not followed. Code-review discipline covers depth 2+.
 *
 * Exit codes:
 *   0 — all checks pass
 *   1 — one or more checks failed; per-file messages name offending lines
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve project root and scoped glob
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Script lives at hive/scripts/; project root is two levels up.
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const SKILLS_BASE = join(PROJECT_ROOT, 'skills', 'hive', 'skills');

/**
 * Collect all SKILL.md files matching *-mode-cc-workflows/SKILL.md under
 * skills/hive/skills/. Returns absolute paths.
 */
function collectScopedFiles() {
  const results = [];
  let entries;
  try {
    entries = readdirSync(SKILLS_BASE);
  } catch {
    // If the base path doesn't exist, return empty (checks all pass vacuously).
    return results;
  }
  for (const entry of entries) {
    if (!entry.endsWith('-mode-cc-workflows')) continue;
    const skillMd = join(SKILLS_BASE, entry, 'SKILL.md');
    try {
      statSync(skillMd);
      results.push(skillMd);
    } catch {
      // SKILL.md not present in this dir — skip.
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Code-block extraction
//
// Returns an array of { blockContent, startLine } where startLine is the
// 1-based line number of the opening ``` fence.
// ---------------------------------------------------------------------------

function extractCodeBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockLines = [];
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^```/.test(line)) {
      inBlock = true;
      blockStart = i + 1; // 1-based line number of opening fence
      blockLines = [];
    } else if (inBlock && /^```/.test(line)) {
      inBlock = false;
      blocks.push({ blockContent: blockLines.join('\n'), startLine: blockStart });
      blockLines = [];
    } else if (inBlock) {
      blockLines.push(line);
    }
  }
  if (inBlock && blockLines.length > 0) {
    blocks.push(blockLines.join('\n'));
  }
  return blocks;
}

/**
 * Return { lineNo, text } hits for lines inside code blocks matching predicate.
 * lineNo is the absolute 1-based line number in the full file.
 */
function matchingCodeBlockLines(content, predicate) {
  const hits = [];
  const blocks = extractCodeBlocks(content);
  for (const { blockContent, startLine } of blocks) {
    const blockLines = blockContent.split('\n');
    for (let i = 0; i < blockLines.length; i++) {
      if (predicate(blockLines[i])) {
        hits.push({
          lineNo: startLine + 1 + i, // +1 for opening fence line
          text: blockLines[i].trimEnd(),
        });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Check 1: agentType-literal-ast
//
// Pattern: agentType: followed by an optional quote and "codex:codex-rescue".
// The angle-bracket placeholder `agentType: <default | codex:codex-rescue>`
// does NOT match because `<` is neither a quote character nor the start of
// the literal string "codex".
// ---------------------------------------------------------------------------
const AGENT_TYPE_PATTERN = /agentType\s*:\s*["']?codex:codex-rescue["']?/;

function checkAgentTypeAst(content, filePath) {
  const hits = matchingCodeBlockLines(content, (line) =>
    AGENT_TYPE_PATTERN.test(line)
  );
  if (hits.length === 0) return { ok: true };
  const msgs = hits.map(({ lineNo, text }) => `  ${filePath}:${lineNo}: ${text}`);
  return {
    ok: false,
    message: `Check 1 (agentType-literal-ast): forbidden agentType assignment found in code block:\n${msgs.join('\n')}`,
  };
}

// ---------------------------------------------------------------------------
// Check 2: codex-rescue-grep (code blocks only)
//
// Excludes schema-doc placeholder lines where `codex:codex-rescue` appears
// inside angle brackets (e.g., `agentType: <default | codex:codex-rescue>`).
// Those are YAML schema template placeholders, not routing directives.
// ---------------------------------------------------------------------------
const CODEX_RESCUE_PATTERN = /codex:codex-rescue/;
// A line is a schema placeholder if codex:codex-rescue is enclosed in < >.
const CODEX_RESCUE_PLACEHOLDER = /<[^>]*codex:codex-rescue[^>]*>/;

function grepCodexRescue(content, filePath) {
  const hits = matchingCodeBlockLines(
    content,
    (line) =>
      CODEX_RESCUE_PATTERN.test(line) && !CODEX_RESCUE_PLACEHOLDER.test(line)
  );
  if (hits.length === 0) return { ok: true };
  const msgs = hits.map(({ lineNo, text }) => `  ${filePath}:${lineNo}: ${text}`);
  return {
    ok: false,
    message: `Check 2 (codex-rescue-grep): \`codex:codex-rescue\` found in code block (remove or justify):\n${msgs.join('\n')}`,
  };
}

// ---------------------------------------------------------------------------
// Check 3: agent-backends-grep (code blocks only)
// ---------------------------------------------------------------------------
const AGENT_BACKENDS_PATTERN = /agent_backends/;

function grepAgentBackends(content, filePath) {
  const hits = matchingCodeBlockLines(content, (line) =>
    AGENT_BACKENDS_PATTERN.test(line)
  );
  if (hits.length === 0) return { ok: true };
  const msgs = hits.map(({ lineNo, text }) => `  ${filePath}:${lineNo}: ${text}`);
  return {
    ok: false,
    message: `Check 3 (agent-backends-grep): \`agent_backends\` found in code block (verify it is not a routing directive):\n${msgs.join('\n')}`,
  };
}

// ---------------------------------------------------------------------------
// Check 4: cc-workflows-preconditions-import (full file)
// ---------------------------------------------------------------------------
const HELPER_IMPORT_FRAGMENT = 'hive/lib/cc_workflows_preconditions.py';

function assertHelperImport(content, filePath) {
  if (content.includes(HELPER_IMPORT_FRAGMENT)) return { ok: true };
  return {
    ok: false,
    message:
      `Check 4 (cc-workflows-preconditions-import): missing helper import in ${filePath}\n` +
      `  Expected to find: ${HELPER_IMPORT_FRAGMENT}\n` +
      `  Add at Step 0: invoke python3 hive/lib/cc_workflows_preconditions.py with the current cwd.`,
  };
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------

const CHECKS = [
  { name: 'agentType-literal-ast', run: checkAgentTypeAst },
  { name: 'codex-rescue-grep', run: grepCodexRescue },
  { name: 'agent-backends-grep', run: grepAgentBackends },
  { name: 'cc-workflows-preconditions-import', run: assertHelperImport },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function run() {
  const files = collectScopedFiles();

  if (files.length === 0) {
    console.log(
      'lint-cc-workflows-no-codex: no scoped files found under ' +
        'skills/hive/skills/*-mode-cc-workflows/SKILL.md — passing vacuously'
    );
    process.exit(0);
  }

  console.log(`lint-cc-workflows-no-codex: scanning ${files.length} file(s)`);

  const failures = [];

  for (const filePath of files) {
    const content = readFileSync(filePath, 'utf8');
    const relPath = filePath.startsWith(PROJECT_ROOT)
      ? filePath.slice(PROJECT_ROOT.length + 1)
      : filePath;

    for (const check of CHECKS) {
      const result = check.run(content, relPath);
      if (!result.ok) {
        failures.push(result.message);
      }
    }
  }

  if (failures.length === 0) {
    console.log(
      `lint-cc-workflows-no-codex: all ${CHECKS.length} checks PASSED across ${files.length} file(s)`
    );
    process.exit(0);
  }

  console.error('\nlint-cc-workflows-no-codex: FAILURES:\n');
  for (const msg of failures) {
    console.error(msg);
    console.error('');
  }
  process.exit(1);
}

run();
