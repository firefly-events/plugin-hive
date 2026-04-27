/**
 * Session-End Three-Op Orchestration
 *
 * Implements the session-end window:
 *   Phase A: insight promotion (sequential)
 *   Phase B: kg_write() (after A — triples reference promoted slugs)
 *   Phase C: compile() || chromadb.index() (parallel, after B)
 *
 * Used by both:
 *   - Natural session-end (Stop hook) — full three phases
 *   - Pre-shutdown receiver — same ordering, skipCompile: true on hard shutdown
 */

const path = require('path');
const fs = require('fs');
const { index: chromadbIndex, isAvailable: chromadbAvailable } = require('./chromadb-wrapper');

const KG_SQLITE_PATH = path.join(process.env.HOME, '.claude', 'hive', 'kg.sqlite');
const MEMORIES_BASE = path.join(process.env.HOME, '.claude', 'hive', 'memories');
const LATENCY_THRESHOLD_MS = 30000; // 30 seconds

/**
 * Run the session-end three-op window.
 *
 * @param {Object} options
 * @param {string} options.agentName - agent whose memories are being promoted
 * @param {string} options.epicId - current epic context for KG triple source_epic
 * @param {string[]} options.promotedSlugs - slugs of insights promoted in Phase A
 * @param {Array<{subject, predicate, object, source_agent}>} options.triples - KG triples to write
 * @param {boolean} [options.skipCompile=false] - skip compile() (for pre-shutdown hard shutdown)
 * @returns {Promise<{elapsed: number, kgError: Error|null, chromadbWarning: string|null}>}
 */
async function runSessionEnd({ agentName, epicId, promotedSlugs = [], triples = [], skipCompile = false }) {
  const startMs = Date.now();
  let kgError = null;
  let chromadbWarning = null;

  // Phase A: Insight promotion
  // Caller is responsible for writing insight files before calling runSessionEnd.
  // promotedSlugs confirms which files were promoted — referenced in Phase B triples.

  // Phase B: KG triple write (after Phase A — slugs must be promoted first)
  if (triples.length > 0) {
    try {
      await kgWrite(triples, epicId, agentName);
    } catch (err) {
      kgError = err;
      console.error(`[session-end] kg_write() failed: ${err.message}`);
      // Surface but do not rethrow — proceed to Phase C
    }
  }

  // Phase C: compile() and chromadb.index() in parallel (after Phase B)
  const phaseC = [];

  // compile() — rebuild memory wiki
  if (!skipCompile) {
    phaseC.push(
      runCompile(MEMORIES_BASE).catch(err => {
        console.error(`[session-end] compile() failed: ${err.message}`);
        // Preserve existing behavior: log, don't rethrow
      })
    );
  }

  // chromadb.index() — index promoted documents (best-effort)
  if (promotedSlugs.length > 0) {
    const indexPromise = (async () => {
      const available = await chromadbAvailable();
      if (!available) {
        chromadbWarning = 'ChromaDB unavailable — semantic index not updated';
        console.warn(`[session-end] ${chromadbWarning}`);
        return;
      }
      for (const slug of promotedSlugs) {
        const memPath = path.join(MEMORIES_BASE, agentName, `${slug}.md`);
        if (fs.existsSync(memPath)) {
          const content = fs.readFileSync(memPath, 'utf8');
          await chromadbIndex('hive-memories', slug, content, { agentName, epicId }).catch(err => {
            chromadbWarning = `chromadb.index() failed for ${slug}: ${err.message}`;
            console.warn(`[session-end] ${chromadbWarning}`);
          });
        }
      }
    })();
    phaseC.push(indexPromise);
  }

  await Promise.all(phaseC);

  // Latency monitoring
  const elapsed = Date.now() - startMs;
  if (elapsed > LATENCY_THRESHOLD_MS) {
    console.warn(
      `[session-end] ⚠ latency spike: ${(elapsed / 1000).toFixed(1)}s (threshold: 30s). ` +
      `Consider optimizing compile() or chromadb.index() for large memory corpora.`
    );
  }

  return { elapsed, kgError, chromadbWarning };
}

/**
 * Write KG triples to kg.sqlite via WAL transaction.
 * Validates predicates against controlled vocabulary before writing.
 */
async function kgWrite(triples, sourceEpic, sourceAgent) {
  // Dynamic require to avoid hard dependency when SQLite not available
  let sqlite3;
  try {
    sqlite3 = require('better-sqlite3');
  } catch {
    throw new Error('better-sqlite3 not available — cannot write KG triples');
  }

  const db = sqlite3(KG_SQLITE_PATH);
  const validPredicates = new Set(
    db.prepare('SELECT predicate FROM predicates').all().map(r => r.predicate)
  );

  const insert = db.prepare(
    'INSERT INTO triples (subject, predicate, object, valid_from, source_epic, source_agent) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const writeAll = db.transaction((rows) => {
    const now = new Date().toISOString();
    for (const t of rows) {
      if (!validPredicates.has(t.predicate)) {
        throw new Error(
          `unknown predicate "${t.predicate}" — must be one of: ${[...validPredicates].join(', ')}`
        );
      }
      insert.run(t.subject, t.predicate, t.object, t.valid_from || now, sourceEpic, t.source_agent || sourceAgent);
    }
  });

  writeAll(triples);
  db.close();
}

/**
 * Rebuild memory wiki from agent memory directories.
 * Stub — actual implementation is in the compile() MemoryStore method.
 */
async function runCompile(memoriesBase) {
  // The compile() operation is performed by the agent following the MemoryStore
  // interface contract. This stub signals completion for orchestration purposes.
  // Real compilation reads memoriesBase and writes to ~/.claude/hive/memory-wiki/.
  // TODO: integrate with MemoryStore compile() implementation when available
  // (see hive/references/memory-store-interface.md → compile() method)
  console.log(`[session-end] compile() triggered for ${memoriesBase}`);
}

module.exports = { runSessionEnd };
