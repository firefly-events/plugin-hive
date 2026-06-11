#!/usr/bin/env node
/**
 * run.mjs — CLI entry point for /hive:context-snapshot.
 *
 * Usage:
 *   node skills/context-snapshot/run.mjs [--epic <id>] [--write] [--schema-version]
 *
 * Flags:
 *   --epic <id>       Filter output to the named epic only
 *   --write           Persist snapshot to <state-dir>/context-snapshot.json (in addition to stdout)
 *   --schema-version  Print the schema_version integer and exit 0
 *
 * The state dir resolves via the sdr-1 resolver (HIVE_STATE_DIR >
 * paths.state_dir in hive.config.yaml > default .pHive).
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function usage() {
  return [
    'Usage: node skills/context-snapshot/run.mjs [--epic <id>] [--write] [--schema-version]',
    '',
    'Options:',
    '  --epic <id>       Filter output to a single epic',
    '  --write           Also write snapshot to <state-dir>/context-snapshot.json',
    '  --schema-version  Print current schema_version and exit',
  ].join('\n');
}

function parseArgs(argv) {
  const args = [...argv];
  const opts = { epic: null, write: false, schemaVersion: false };
  const known = new Set(['--epic', '--write', '--schema-version']);

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--epic') {
      const val = args[++i];
      if (!val || val.startsWith('--')) {
        console.error('Error: --epic requires an epic id.');
        console.error(usage());
        process.exit(1);
      }
      opts.epic = val;
    } else if (arg === '--write') {
      opts.write = true;
    } else if (arg === '--schema-version') {
      opts.schemaVersion = true;
    } else {
      console.error(`Error: unknown flag: ${arg}`);
      console.error(usage());
      process.exit(1);
    }
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.schemaVersion) {
    process.stdout.write('1\n');
    process.exit(0);
  }

  const { composeContextSnapshot } = await import('../../hive/lib/context-snapshot.mjs');
  const { resolveStateDir } = await import('../../hive/lib/config.js');

  const snapshot = composeContextSnapshot({
    stateDir: REPO_ROOT,
    epic: opts.epic || undefined,
  });

  const json = JSON.stringify(snapshot, null, 2);
  process.stdout.write(json + '\n');

  if (opts.write) {
    const stateDir = resolveStateDir({ cwd: REPO_ROOT });
    mkdirSync(stateDir, { recursive: true });
    const outPath = join(stateDir, 'context-snapshot.json');
    writeFileSync(outPath, json + '\n', 'utf8');
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
