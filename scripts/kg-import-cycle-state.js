#!/usr/bin/env node
/**
 * ONE-TIME UTILITY: Import cycle-state decisions into kg.sqlite
 *
 * Seeds ~/.claude/hive/kg.sqlite with decision triples derived from
 * existing cycle-state YAML files in .pHive/cycle-state/*.yaml.
 *
 * Safe to run multiple times — idempotent via INSERT OR IGNORE.
 * After initial import, kg_write() (hive/lib/session-end.js) handles
 * all new triple writes at session-end.
 *
 * Usage: node scripts/kg-import-cycle-state.js [--dry-run] \
 *          [--cycle-state-dir <path>] [--source-epic-prefix <name>] \
 *          [--since YYYY-MM-DD]
 *
 * --cycle-state-dir <path>
 *   Override the default cycle-state directory (the script's repo root /
 *   .pHive/cycle-state). Used by kg-bootstrap-from-projects.js to import
 *   triples from registered sibling projects without changing cwd.
 *
 * --source-epic-prefix <name>
 *   Prefix every emitted triple's `source_epic` with `<name>/`. Used by
 *   the multi-project bootstrap to namespace epics so two projects with
 *   the same epic ID (e.g., `memory-redesign`) do not collide on the
 *   `idx_unique_triple(subject, predicate, object, source_epic)` index.
 *   Without the prefix, project B's triples would be silently dropped by
 *   INSERT OR IGNORE.
 *
 * STATE-DIR CLASSIFICATION (sdr-3): maintainer-only — stays literal.
 * Nothing in hooks/, skills/, or workflows invokes this at runtime; it is a
 * one-time seeding utility run by an operator (or by the maintainer-only
 * kg-bootstrap-from-projects.js). The default `.pHive/cycle-state` path is
 * intentional per design-decisions Q3 (proof/one-time scripts keep literal
 * paths); relocated projects can pass --cycle-state-dir explicitly.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use js-yaml for YAML parsing (check if available, else use simple regex fallback)
let yaml;
let usingFallbackYaml = false;
try {
  yaml = require('js-yaml');
} catch {
  usingFallbackYaml = true;
  console.warn('WARN: js-yaml not installed — using minimal fallback parser. Install js-yaml for full YAML coverage.');
  // Minimal YAML fallback — good enough for cycle-state structure.
  // Surface parse errors instead of swallowing them so silent backfill drops
  // produce a visible signal rather than an undercounted import.
  yaml = {
    load: (str) => parseSimpleYaml(str)
  };
}

const DB_PATH = path.join(os.homedir(), '.claude', 'hive', 'kg.sqlite');

// argv parser — minimal, in-pattern with the existing --dry-run flag.
function argvFlag(name) {
  return process.argv.includes(name);
}
function argvValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i === process.argv.length - 1) return null;
  return process.argv[i + 1];
}

const CYCLE_STATE_DIR =
  argvValue('--cycle-state-dir') ||
  path.join(__dirname, '..', '.pHive', 'cycle-state');
const SOURCE_EPIC_PREFIX = argvValue('--source-epic-prefix') || '';
const DRY_RUN = argvFlag('--dry-run');
const SUMMARY_ONLY = argvFlag('--summary-only');
const SINCE_VALUE = argvValue('--since') || '2026-04-28';

function parseSinceDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    console.error(`Error: Invalid --since '${value}'. Expected YYYY-MM-DD.`);
    process.exit(1);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    console.error(`Error: Invalid --since '${value}'. Expected a real YYYY-MM-DD date.`);
    process.exit(1);
  }
  return date;
}

const SINCE_DATE = parseSinceDate(SINCE_VALUE);

function parseSimpleYaml(content) {
  // Minimal YAML parser for cycle-state files
  // Only handles top-level keys and decisions[] array
  const result = {};
  const lines = content.split('\n');
  let inDecisions = false;
  let currentDecision = null;
  result.decisions = [];

  for (const line of lines) {
    if (line.startsWith('epic_id:')) {
      result.epic_id = line.replace('epic_id:', '').trim().replace(/['"]/g, '');
    }
    if (line.match(/^decisions:/)) {
      inDecisions = true;
      continue;
    }
    if (inDecisions && line.match(/^  - /)) {
      if (currentDecision) result.decisions.push(currentDecision);
      currentDecision = {};
      const rest = line.replace(/^  - /, '').trim();
      if (rest.includes(':')) {
        const [k, ...vs] = rest.split(':');
        currentDecision[k.trim()] = vs.join(':').trim().replace(/['"]/g, '');
      }
    } else if (inDecisions && currentDecision && line.match(/^    \w/)) {
      if (line.includes(':')) {
        const [k, ...vs] = line.split(':');
        const key = k.trim();
        const val = vs.join(':').trim().replace(/['"]/g, '');
        if (!currentDecision[key]) currentDecision[key] = val;
      }
    } else if (line.match(/^\w/) && !line.startsWith('decisions')) {
      inDecisions = false;
      if (currentDecision) { result.decisions.push(currentDecision); currentDecision = null; }
    }
  }
  if (currentDecision) result.decisions.push(currentDecision);
  return result;
}

// Supported decision-row shapes:
//
//   canonical (existing — kg_write at session-end + early cycle-state files):
//     { key: "...", value: "...", timestamp?: "..." }
//     Mapped: subject=epicId, predicate="decided",
//             object=`${key}:${value}` (truncated to 500),
//             valid_from=timestamp||fileMtime.
//
//   legacy (existing — pre-canonical handwritten cycle-state):
//     { decision: "...", rationale?: "...", set?: "..." }
//     Mapped: subject=epicId, predicate="decided",
//             object=decision (truncated), valid_from=set||fileMtime.
//
//   v2 (added 2026-05-11 per M-08 — newer epic cycle-state files):
//     { id: "...", value?: "...", rationale?: "...",
//       captured_at?|locked_at?|timestamp?: "...",
//       source?, implication?, phase? }
//     Mapped: subject=epicId, predicate="decided",
//             object=value (when value is not null/undefined; falsy values
//             like 0, false, '' are preserved) else rationale
//             (truncated to 500),
//             valid_from=captured_at||locked_at||timestamp||fileMtime.
//     `id`, `source`, `implication`, `phase` are not currently projected
//     into the triple — they are decision-row metadata the KG schema does
//     not have first-class fields for. If a future reader needs them,
//     surface via a richer projection rather than encoding into `object`.
//
// Rows that match none of the above are reported as `unknown` and
// surfaced as WARN at WARN log level (not silently dropped) so that
// shape drift produces a visible signal rather than an undercounted
// import.
function detectFormat(decision) {
  if ('key' in decision && 'value' in decision) return 'canonical';
  if ('id' in decision && ('value' in decision || 'rationale' in decision)) return 'v2';
  if ('decision' in decision) return 'legacy';
  return 'unknown';
}

function toIsoOrFallback(ts, fallbackIso) {
  if (!ts) return fallbackIso;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? fallbackIso : d.toISOString();
}

function toTriple(decision, epicId, fileMtime) {
  const fmt = detectFormat(decision);
  // namespacedEpic prevents idx_unique_triple collisions when triples are
  // imported from sibling projects via kg-bootstrap-from-projects.js. With
  // no prefix configured, the value is identical to the bare epicId — the
  // single-project import path is unchanged.
  const namespacedEpic = SOURCE_EPIC_PREFIX
    ? `${SOURCE_EPIC_PREFIX}/${epicId}`
    : epicId;
  if (fmt === 'canonical') {
    return {
      subject: epicId,
      predicate: 'decided',
      // Truncate to 500 chars to stay within SQLite TEXT field conventions.
      // Note: the same truncation applies on re-runs (idempotent for consistent inputs).
      // If source text changes between runs, a new triple may be inserted alongside the old one.
      object: `${decision.key}:${decision.value}`.substring(0, 500),
      valid_from: toIsoOrFallback(decision.timestamp, fileMtime),
      source_epic: namespacedEpic,
      source_agent: 'orchestrator'
    };
  } else if (fmt === 'legacy') {
    return {
      subject: epicId,
      predicate: 'decided',
      object: String(decision.decision || '').substring(0, 500),
      valid_from: toIsoOrFallback(decision.set, fileMtime),
      source_epic: namespacedEpic,
      source_agent: 'orchestrator'
    };
  } else if (fmt === 'v2') {
    // value preferred over rationale when both present; rationale is the
    // why and value is the what — the KG stores the what.
    const rawObject = decision.value != null ? decision.value : decision.rationale;
    const ts = decision.captured_at || decision.locked_at || decision.timestamp;
    return {
      subject: epicId,
      predicate: 'decided',
      object: String(rawObject || '').substring(0, 500),
      valid_from: toIsoOrFallback(ts, fileMtime),
      source_epic: namespacedEpic,
      source_agent: 'orchestrator'
    };
  }
  return null;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`Error: kg.sqlite not found at ${DB_PATH}. Run kickoff bootstrap first.`);
    process.exit(1);
  }
  if (!fs.existsSync(CYCLE_STATE_DIR)) {
    console.error(`Error: cycle-state directory not found at ${CYCLE_STATE_DIR}`);
    process.exit(1);
  }

  let db;
  let insertStmt;
  if (!DRY_RUN) {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    // SQLite leaves FK enforcement off per-connection — without this, an
    // undeclared predicate inserts silently despite the schema's
    // REFERENCES predicates(predicate) declaration.
    db.pragma('foreign_keys = ON');
    // idx_unique_triple is part of the canonical bootstrap DDL — see
    // hive/references/knowledge-graph-schema.md#sqlite-bootstrap.
    // Verify it exists at runtime so INSERT OR IGNORE can actually dedupe re-runs.
    const hasUniqueIdx = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_unique_triple'")
      .get();
    if (!hasUniqueIdx) {
      db.close();
      throw new Error(
        'Missing required index idx_unique_triple — run kickoff bootstrap before importing. ' +
        'Without it, INSERT OR IGNORE cannot deduplicate re-runs.'
      );
    }
    // Prepare the insert statement once; reuse across all decisions for backfill speed.
    insertStmt = db.prepare(
      'INSERT OR IGNORE INTO triples (subject, predicate, object, valid_from, valid_until, source_epic, source_agent) VALUES (?, ?, ?, ?, NULL, ?, ?)'
    );
  }

  const files = fs.readdirSync(CYCLE_STATE_DIR).filter(f => f.endsWith('.yaml'));
  let totalDecisions = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;
  let totalSkippedSince = 0;
  let totalMisformat = 0;

  // All work is wrapped so that real-mode imports run in a single SQLite
  // transaction. A runtime failure rolls back the entire backfill rather than
  // leaving a partial KG state.
  const runImport = () => {
    for (const file of files) {
      const filePath = path.join(CYCLE_STATE_DIR, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const fileMtime = fs.statSync(filePath).mtime.toISOString();

      let parsed;
      try {
        parsed = yaml.load(content);
      } catch (e) {
        totalMisformat++;
        console.warn(`  WARN: Failed to parse ${file}${usingFallbackYaml ? ' (fallback parser)' : ''}: ${e.message}`);
        continue;
      }

      if (!parsed || !parsed.decisions || !Array.isArray(parsed.decisions)) {
        totalMisformat++;
        console.warn(`  WARN: [${file}] No decisions array found${usingFallbackYaml ? ' (fallback parser)' : ''}`);
        continue;
      }

      const epicId = parsed.epic_id || file.replace('.yaml', '');
      const decisions = parsed.decisions;
      totalDecisions += decisions.length;

      for (const dec of decisions) {
        const triple = toTriple(dec, epicId, fileMtime);
        if (!triple) {
          totalMisformat++;
          console.warn(`  WARN: [${file}] Unknown format for decision: ${JSON.stringify(dec).substring(0, 80)}`);
          continue;
        }
        if (new Date(triple.valid_from) < SINCE_DATE) {
          totalSkippedSince++;
          continue;
        }

        if (DRY_RUN) {
          if (!SUMMARY_ONLY) {
            console.log(`  DRY: ${triple.subject} -[${triple.predicate}]-> ${triple.object.substring(0, 60)}`);
          }
          // Dry-run cannot consult INSERT OR IGNORE; count rows as "processed
          // preview" rather than asserting they would all be newly inserted.
          totalProcessed++;
        } else {
          const result = insertStmt.run(
            triple.subject,
            triple.predicate,
            triple.object,
            triple.valid_from,
            triple.source_epic,
            triple.source_agent
          );
          if (result.changes > 0) {
            totalProcessed++;
          } else {
            totalSkipped++;
          }
        }
      }
    }
  };

  if (!DRY_RUN) {
    const tx = db.transaction(runImport);
    tx();
  } else {
    runImport();
  }

  if (!DRY_RUN) {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM triples').get();
    const dbCount = countRow.cnt;
    console.log('\n=== Import Summary ===');
    console.log(`Files scanned:      ${files.length}`);
    console.log(`Decisions found:    ${totalDecisions}`);
    console.log(`Triples inserted:   ${totalProcessed}`);
    console.log(`Skipped (dup):      ${totalSkipped}`);
    console.log(`Skipped pre---since: ${totalSkippedSince}`);
    console.log(`Misformat:          ${totalMisformat}`);
    console.log(`Total in kg.sqlite: ${dbCount}`);
    db.close();
  } else {
    console.log('\n=== Dry Run Summary ===');
    console.log(`Files scanned:    ${files.length}`);
    console.log(`Decisions found:  ${totalDecisions}`);
    console.log(`Would process:    ${totalProcessed}`);
    console.log(`Skipped pre---since: ${totalSkippedSince}`);
    console.log(`Misformat:        ${totalMisformat}`);
    console.log(`WOULD INSERT ${totalProcessed} triples (${totalSkippedSince} skipped pre---since) -- DRY RUN`);
    console.log('(Note: dry-run does not consult INSERT OR IGNORE — actual inserted count in real mode may be lower due to dedup.)');
  }
}

main().catch(err => {
  if (err.code === 'MODULE_NOT_FOUND' && err.message.includes('better-sqlite3')) {
    console.error('Error: better-sqlite3 is required for real imports.');
    console.error('Install with: npm install better-sqlite3');
    console.error('Or use --dry-run to preview without writing to the database.');
  } else {
    console.error('Fatal:', err);
  }
  process.exit(1);
});
