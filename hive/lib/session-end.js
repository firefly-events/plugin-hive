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
const os = require('os');
const { index: chromadbIndex, isAvailable: chromadbAvailable } = require('./chromadb-wrapper');

const HOME = os.homedir();
const KG_SQLITE_PATH = path.join(HOME, '.claude', 'hive', 'kg.sqlite');
const MEMORIES_BASE = path.join(HOME, '.claude', 'hive', 'memories');
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
 *   `chromadbWarning` is a `; `-joined string of all warnings raised during the
 *   ChromaDB phase (or null if none). All warnings are also `console.warn`'d.
 */
async function runSessionEnd({ agentName, epicId, promotedSlugs = [], triples = [], skipCompile = false }) {
  const startMs = Date.now();
  let kgError = null;
  const chromadbWarnings = [];
  const warnChromadb = (msg) => {
    chromadbWarnings.push(msg);
    console.warn(`[session-end] ${msg}`);
  };

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
        warnChromadb('ChromaDB unavailable — semantic index not updated');
        return;
      }
      const NAME_RE = /^[a-z0-9-]+$/;
      if (!NAME_RE.test(agentName)) {
        warnChromadb(`invalid agentName — skipping ChromaDB indexing: ${agentName}`);
        return;
      }
      const memoriesBaseResolved = path.resolve(MEMORIES_BASE);
      const agentDir = path.resolve(memoriesBaseResolved, agentName);
      if (!agentDir.startsWith(`${memoriesBaseResolved}${path.sep}`)) {
        warnChromadb(`unsafe agent directory — skipping ChromaDB indexing: ${agentName}`);
        return;
      }
      const SLUG_RE = NAME_RE;
      for (const slug of promotedSlugs) {
        if (!SLUG_RE.test(slug)) {
          warnChromadb(`invalid memory slug skipped: ${slug}`);
          continue;
        }
        const memPath = path.resolve(agentDir, `${slug}.md`);
        if (memPath !== path.join(agentDir, `${slug}.md`) || !memPath.startsWith(`${agentDir}${path.sep}`)) {
          warnChromadb(`unsafe memory path skipped for slug: ${slug}`);
          continue;
        }
        try {
          const content = await fs.promises.readFile(memPath, 'utf8');
          // Namespace docId with agentName to prevent cross-agent collisions in shared collection
          const docId = `${agentName}/${slug}`;
          const ok = await chromadbIndex('hive-memories', docId, content, { agentName, epicId, slug });
          if (!ok) {
            warnChromadb(`chromadb.index() failed for ${docId}`);
          }
        } catch (err) {
          warnChromadb(`chromadb.index() skipped/failed for ${slug}: ${err.message}`);
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

  const chromadbWarning = chromadbWarnings.length ? chromadbWarnings.join('; ') : null;
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

  let db;
  try {
    db = sqlite3(KG_SQLITE_PATH);

    // Guard: idx_unique_triple is required for INSERT OR IGNORE to dedupe re-runs.
    // Mirrors the precondition check in scripts/kg-import-cycle-state.js.
    const hasUniqueIdx = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_unique_triple'")
      .get();
    if (!hasUniqueIdx) {
      throw new Error(
        'Missing required index idx_unique_triple — run kickoff bootstrap before kg_write(). ' +
        'Without it, INSERT OR IGNORE cannot enforce uniqueness across re-runs.'
      );
    }

    const validPredicates = new Set(
      db.prepare('SELECT predicate FROM predicates').all().map(r => r.predicate)
    );

    const insert = db.prepare(
      'INSERT OR IGNORE INTO triples (subject, predicate, object, valid_from, source_epic, source_agent) VALUES (?, ?, ?, ?, ?, ?)'
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
  } finally {
    if (db) db.close();
  }
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

module.exports = { runSessionEnd, kgWrite };
