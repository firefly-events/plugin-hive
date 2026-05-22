#!/usr/bin/env node
/**
 * Audit multica-run.yaml episode markers for required issue linkage fields.
 *
 * Walks .pHive/episodes/<epic>/<story>/multica-run.yaml (and the legacy
 * .pHive/epics/<epic>/<story>/multica-run.yaml path) under a repo root,
 * validates that each file contains non-empty `issue_id` and
 * `issue_identifier` fields, and exits 1 with a report if any are missing.
 *
 * Usage:
 *   node hive/scripts/audit-episode-markers.mjs [repo-root]
 *
 * repo-root defaults to the current working directory.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const repoRoot = process.argv[2] ?? process.cwd();

// Search both canonical path and legacy variant.
const searchRoots = [
  join(repoRoot, '.pHive', 'episodes'),
  join(repoRoot, '.pHive', 'epics'),
];

/**
 * Yield all multica-run.yaml files found under a directory (depth-first).
 * Only files named exactly `multica-run.yaml` are collected.
 */
function* findMarkers(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      yield* findMarkers(full);
    } else if (entry === 'multica-run.yaml') {
      yield full;
    }
  }
}

/**
 * Parse a YAML file with a minimal hand-rolled parser sufficient for the
 * flat key: value format used in episode markers (no deps required).
 */
function parseYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*?)\s*$/);
    if (match) {
      result[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
  return result;
}

const offenders = [];
let totalScanned = 0;

for (const root of searchRoots) {
  for (const markerPath of findMarkers(root)) {
    totalScanned++;
    const rel = relative(repoRoot, markerPath);
    let data;
    try {
      data = parseYaml(readFileSync(markerPath, 'utf8'));
    } catch (err) {
      offenders.push({ path: rel, reason: `unreadable: ${err.message}` });
      continue;
    }

    const missing = [];
    if (!data.issue_id || data.issue_id.trim() === '') missing.push('issue_id');
    if (!data.issue_identifier || data.issue_identifier.trim() === '') missing.push('issue_identifier');

    if (missing.length > 0) {
      offenders.push({ path: rel, reason: `missing or empty: ${missing.join(', ')}` });
    }
  }
}

if (totalScanned === 0) {
  console.log('audit-episode-markers: no multica-run.yaml files found — nothing to validate.');
  process.exit(0);
}

if (offenders.length === 0) {
  console.log(`audit-episode-markers: OK — ${totalScanned} marker(s) scanned, all well-formed.`);
  process.exit(0);
}

console.error(`audit-episode-markers: FAIL — ${offenders.length} offender(s) out of ${totalScanned} scanned:\n`);
for (const { path, reason } of offenders) {
  console.error(`  ${path}\n    ${reason}`);
}
process.exit(1);
