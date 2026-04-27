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
 * Usage: node scripts/kg-import-cycle-state.js [--dry-run]
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Use js-yaml for YAML parsing (check if available, else use simple regex fallback)
let yaml;
try {
  yaml = require('js-yaml');
} catch {
  // Minimal YAML fallback — good enough for cycle-state structure
  yaml = {
    load: (str) => {
      try {
        return parseSimpleYaml(str);
      } catch (e) {
        return null;
      }
    }
  };
}

const DB_PATH = path.join(os.homedir(), '.claude', 'hive', 'kg.sqlite');
const CYCLE_STATE_DIR = path.join(__dirname, '..', '.pHive', 'cycle-state');
const DRY_RUN = process.argv.includes('--dry-run');

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

function detectFormat(decision) {
  if ('key' in decision && 'value' in decision) return 'canonical';
  if ('decision' in decision) return 'legacy';
  return 'unknown';
}

function toTriple(decision, epicId, fileMtime) {
  const fmt = detectFormat(decision);
  if (fmt === 'canonical') {
    return {
      subject: epicId,
      predicate: 'decided',
      // Truncate to 500 chars to stay within SQLite TEXT field conventions.
      // Note: the same truncation applies on re-runs (idempotent for consistent inputs).
      // If source text changes between runs, a new triple may be inserted alongside the old one.
      object: `${decision.key}:${decision.value}`.substring(0, 500),
      valid_from: decision.timestamp || fileMtime,
      source_epic: epicId,
      source_agent: 'orchestrator'
    };
  } else if (fmt === 'legacy') {
    return {
      subject: epicId,
      predicate: 'decided',
      object: String(decision.decision || '').substring(0, 500),
      valid_from: fileMtime,
      source_epic: epicId,
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
  if (!DRY_RUN) {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    // idx_unique_triple is part of the canonical bootstrap DDL — see
    // hive/references/knowledge-graph-schema.md#sqlite-bootstrap. Run kickoff
    // bootstrap first if this script reports a UNIQUE constraint error or
    // missing-index error.
  }

  const files = fs.readdirSync(CYCLE_STATE_DIR).filter(f => f.endsWith('.yaml'));
  let totalDecisions = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalMisformat = 0;
  for (const file of files) {
    const filePath = path.join(CYCLE_STATE_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const fileMtime = fs.statSync(filePath).mtime.toISOString();

    let parsed;
    try {
      parsed = yaml.load(content);
    } catch (e) {
      console.warn(`  WARN: Failed to parse ${file}: ${e.message}`);
      continue;
    }

    if (!parsed || !parsed.decisions || !Array.isArray(parsed.decisions)) continue;

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

      if (DRY_RUN) {
        console.log(`  DRY: ${triple.subject} -[${triple.predicate}]-> ${triple.object.substring(0, 60)}`);
        totalInserted++;
      } else {
        const insertStmt = db.prepare(
          'INSERT OR IGNORE INTO triples (subject, predicate, object, valid_from, valid_until, source_epic, source_agent) VALUES (?, ?, ?, ?, NULL, ?, ?)'
        );
        const result = insertStmt.run(
          triple.subject,
          triple.predicate,
          triple.object,
          triple.valid_from,
          triple.source_epic,
          triple.source_agent
        );
        if (result.changes > 0) {
          totalInserted++;
        } else {
          totalSkipped++;
        }
      }
    }
  }

  if (!DRY_RUN) {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM triples').get();
    const dbCount = countRow.cnt;
    console.log('\n=== Import Summary ===');
    console.log(`Files scanned:      ${files.length}`);
    console.log(`Decisions found:    ${totalDecisions}`);
    console.log(`Triples inserted:   ${totalInserted}`);
    console.log(`Skipped (dup):      ${totalSkipped}`);
    console.log(`Misformat:          ${totalMisformat}`);
    console.log(`Total in kg.sqlite: ${dbCount}`);
    db.close();
  } else {
    console.log('\n=== Dry Run Summary ===');
    console.log(`Files scanned:    ${files.length}`);
    console.log(`Decisions found:  ${totalDecisions}`);
    console.log(`Would insert:     ${totalInserted}`);
    console.log(`Misformat:        ${totalMisformat}`);
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
