#!/usr/bin/env node
/**
 * Injects the Dostal approval ruleset (./RULESET.md) into a target project's
 * AGENTS.md and CLAUDE.md, ahead of whatever the harness's own defaults are
 * (DOS-221). Idempotent: re-running replaces the previously injected block
 * in place instead of appending a duplicate.
 *
 * Usage:
 *   node hive/lib/approval/inject-ruleset.mjs [target-dir]   # defaults to cwd
 *   import { injectRuleset } from './inject-ruleset.mjs'      # programmatic
 *
 * Writes to <target-dir>/AGENTS.md and <target-dir>/CLAUDE.md, creating each
 * file (with just the ruleset block) if it doesn't exist yet.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULESET_PATH = path.join(__dirname, 'RULESET.md');

const START_MARKER = '<!-- dostal:approval-ruleset:start (DOS-221 — do not hand-edit; re-run inject-ruleset.mjs) -->';
const END_MARKER = '<!-- dostal:approval-ruleset:end -->';

const TARGET_FILES = ['AGENTS.md', 'CLAUDE.md'];

/**
 * @param {string} existing - Current file contents, or '' if the file doesn't exist yet.
 * @param {string} block - The ruleset markdown to inject (without markers).
 * @returns {string} Updated file contents with the block inserted/replaced.
 */
export function upsertBlock(existing, block) {
  const wrapped = `${START_MARKER}\n\n${block.trim()}\n\n${END_MARKER}`;
  const pattern = new RegExp(
    `${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`,
  );
  if (pattern.test(existing)) {
    return existing.replace(pattern, wrapped);
  }
  const trimmed = existing.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${wrapped}\n` : `${wrapped}\n`;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} [targetDir] - Directory containing AGENTS.md / CLAUDE.md. Defaults to cwd.
 * @returns {Promise<{ file: string, changed: boolean }[]>}
 */
export async function injectRuleset(targetDir = process.cwd()) {
  const block = await readFile(RULESET_PATH, 'utf8');
  const results = [];
  for (const name of TARGET_FILES) {
    const filePath = path.join(targetDir, name);
    let existing = '';
    try {
      existing = await readFile(filePath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const updated = upsertBlock(existing, block);
    const changed = updated !== existing;
    if (changed) await writeFile(filePath, updated, 'utf8');
    results.push({ file: filePath, changed });
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targetDir = process.argv[2] ?? process.cwd();
  const results = await injectRuleset(targetDir);
  for (const { file, changed } of results) {
    console.log(`${changed ? 'updated' : 'unchanged'}: ${file}`);
  }
}
