#!/usr/bin/env node
/**
 * story-status-backfill.mjs — one-shot reconciliation of stale story YAML status fields.
 *
 * Usage:
 *   node hive/scripts/story-status-backfill.mjs          # dry-run (prints diff, no writes)
 *   node hive/scripts/story-status-backfill.mjs --apply  # rewrite stale YAMLs
 *   node hive/scripts/story-status-backfill.mjs --epic <epic-id>  # filter to one epic
 *
 * What it does:
 *   1. Calls deriveAllStatuses() to compute effective status for every story.
 *   2. Compares derived status with the YAML status: field.
 *   3. Dry-run: prints a diff table showing stale entries.
 *   4. --apply: rewrites stale story YAMLs with derived status + shipped: block if completed.
 *
 * Telemetry: emits kg triple story_status_reconciled per rewrite (hive/lib/kg_emit.js).
 */

'use strict';

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveAllStatuses } from '../lib/story-status.mjs';
import { resolveStateDir } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
// sdr-1 resolver: HIVE_STATE_DIR env > paths.state_dir in hive.config.yaml
// > default <REPO_ROOT>/.pHive.
const STATE_DIR = resolveStateDir({ cwd: REPO_ROOT });

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const EPIC_FILTER = (() => {
  const idx = args.indexOf('--epic');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ---------------------------------------------------------------------------
// Shipped block helpers
// ---------------------------------------------------------------------------

function getShippedBlock(epic_id, story_id) {
  try {
    // Try to find merged PR / branch info from git log
    const log = execFileSync('git', [
      'log', '--merges', '--oneline', '--since=6 months ago',
      `--grep=${story_id}`,
    ], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const firstLine = log.trim().split('\n')[0] || '';
    const sha = firstLine.split(' ')[0] || '';
    const merged_at = sha
      ? execFileSync('git', ['log', '-1', '--format=%cI', sha], {
          cwd: REPO_ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
        }).trim()
      : new Date().toISOString();
    return { pr: null, merged_at: merged_at || new Date().toISOString(), branch: `feat/${epic_id}` };
  } catch {
    return { pr: null, merged_at: new Date().toISOString(), branch: `feat/${epic_id}` };
  }
}

// ---------------------------------------------------------------------------
// YAML rewriter — surgical status: field patch
// ---------------------------------------------------------------------------

function rewriteStoryYaml(stateDir, epic_id, story_id, new_status) {
  const path = join(stateDir, 'epics', epic_id, 'stories', `${story_id}.yaml`);
  if (!existsSync(path)) return false;

  let text = readFileSync(path, 'utf8');

  // Replace existing status: field
  if (/^status:\s*.+$/m.test(text)) {
    text = text.replace(/^(status:\s*).+$/m, `$1${new_status}`);
  } else {
    // Insert after the id: line
    text = text.replace(/^(id:\s*.+)$/m, `$1\nstatus: ${new_status}`);
  }

  // Add or update shipped: block when marking completed
  if (new_status === 'completed') {
    const shipped = getShippedBlock(epic_id, story_id);
    const shippedBlock =
      `shipped:\n` +
      `  branch: ${shipped.branch}\n` +
      (shipped.pr ? `  pr: ${shipped.pr}\n` : '') +
      `  merged_at: "${shipped.merged_at}"`;

    if (/^shipped:/m.test(text)) {
      // Replace existing shipped block (up to next top-level key)
      text = text.replace(/^shipped:[\s\S]*?(?=^\w|\Z)/m, shippedBlock + '\n');
    } else {
      text = text.trimEnd() + '\n' + shippedBlock + '\n';
    }
  }

  writeFileSync(path, text, 'utf8');
  return true;
}

// ---------------------------------------------------------------------------
// Telemetry emit (best-effort)
// ---------------------------------------------------------------------------

async function emitKgTriple(epic_id, story_id, old_status, new_status) {
  try {
    const { emitTriple } = await import('../lib/kg-emit.js').catch(() => ({}));
    if (typeof emitTriple === 'function') {
      await emitTriple({
        subject: `story:${epic_id}/${story_id}`,
        predicate: 'story_status_reconciled',
        object: new_status,
        meta: { old_status, reconciled_at: new Date().toISOString() },
      });
    }
  } catch {
    // telemetry is best-effort
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const all = deriveAllStatuses({ repo_root: REPO_ROOT });
const stale = all.filter(r => r.stale && (!EPIC_FILTER || r.epic_id === EPIC_FILTER));

if (stale.length === 0) {
  console.log('All story status fields are current. Nothing to reconcile.');
  process.exit(0);
}

// Print diff table
const col = (s, w) => String(s).padEnd(w);
const W = [30, 22, 12, 12];
console.log(
  col('Story', W[0]) +
  col('Epic', W[1]) +
  col('YAML status', W[2]) +
  col('→ Derived', W[3])
);
console.log('-'.repeat(W[0] + W[1] + W[2] + W[3]));
for (const r of stale) {
  console.log(
    col(r.story_id, W[0]) +
    col(r.epic_id, W[1]) +
    col(r.yaml_status, W[2]) +
    col(r.derived_status, W[3])
  );
}
console.log(`\n${stale.length} stale ${stale.length === 1 ? 'story' : 'stories'} found.`);

if (!APPLY) {
  console.log('\nDry-run complete. Pass --apply to rewrite.');
  process.exit(0);
}

// Apply rewrites
let fixed = 0;
let failed = 0;
for (const r of stale) {
  const ok = rewriteStoryYaml(STATE_DIR, r.epic_id, r.story_id, r.derived_status);
  if (ok) {
    console.log(`  ✓ ${r.epic_id}/${r.story_id}: ${r.yaml_status} → ${r.derived_status}`);
    fixed++;
    await emitKgTriple(r.epic_id, r.story_id, r.yaml_status, r.derived_status);
  } else {
    console.error(`  ✗ ${r.epic_id}/${r.story_id}: file not found`);
    failed++;
  }
}

console.log(`\nReconciliation complete: ${fixed} fixed, ${failed} failed.`);
if (fixed > 0) {
  // Show a repo-relative path when the state dir lives inside the repo;
  // fall back to the absolute path when it has been relocated elsewhere.
  const epicsDir = join(STATE_DIR, 'epics');
  const rel = relative(REPO_ROOT, epicsDir);
  const epicsDirForGit = rel && !rel.startsWith('..') ? rel : epicsDir;
  console.log(`\nCommit the changes:\n  git add ${epicsDirForGit}/ && git commit -m "chore: reconcile stale story status fields [skip ci]"`);
}
process.exit(failed > 0 ? 1 : 0);
