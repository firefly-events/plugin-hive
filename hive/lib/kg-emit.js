'use strict';

const { readEmitLifecycleAt } = require('./config');
const { kgWrite } = require('./session-end');

const KG_WRITES_TOTAL_COUNTER = 'kg_writes_total';
const EMIT_LIFECYCLE_AT = readEmitLifecycleAt();
const kgWriteCounter = new Map();

function incrementKgWritesCounter(predicate) {
  kgWriteCounter.set(predicate, (kgWriteCounter.get(predicate) || 0) + 1);
}

function isUnavailableKgError(err) {
  const message = err && err.message ? err.message : '';
  return (
    err && (err.code === 'SQLITE_CANTOPEN' || err.code === 'SQLITE_NOTADB') ||
    message.includes('better-sqlite3 not available') ||
    message.includes('kg.sqlite') ||
    message.includes('cannot write KG triples')
  );
}

/**
 * Emit one KG lifecycle event.
 *
 * @param {Object} event
 * @param {string} event.subject
 * @param {string} event.predicate
 * @param {string} event.object
 * @param {string} event.sourceEpic
 * @param {string} event.sourceAgent
 * @returns {Promise<{emitted: boolean, metadata: Object|null}>}
 */
async function emitKgEvent({ subject, predicate, object, sourceEpic, sourceAgent }) {
  if (EMIT_LIFECYCLE_AT === 'off') {
    return { emitted: false, metadata: null };
  }

  const validFrom = new Date().toISOString();
  const metadata = {
    subject,
    predicate,
    object,
    source_epic: sourceEpic,
    source_agent: sourceAgent,
    valid_from: validFrom,
    valid_until: null,
  };

  try {
    await kgWrite([
      {
        subject,
        predicate,
        object,
        valid_from: validFrom,
        valid_until: null,
        source_agent: sourceAgent,
      },
    ], sourceEpic, sourceAgent);
  } catch (err) {
    if (isUnavailableKgError(err)) {
      return { emitted: false, metadata: null };
    }
    throw err;
  }

  incrementKgWritesCounter(predicate);
  return { emitted: true, metadata };
}

function getKgWritesCounterSnapshot() {
  return {
    [KG_WRITES_TOTAL_COUNTER]: Object.fromEntries(kgWriteCounter.entries()),
  };
}

function resetKgWritesCounterForTest() {
  kgWriteCounter.clear();
}

module.exports = {
  KG_WRITES_TOTAL_COUNTER,
  emitKgEvent,
  getKgWritesCounterSnapshot,
  resetKgWritesCounterForTest,
};
