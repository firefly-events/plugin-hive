'use strict';

const { readEmitLifecycleAt } = require('./config');
const { kgWrite, kgSupersede } = require('./session-end');

const KG_WRITES_TOTAL_COUNTER = 'kg_writes_total';
const EMIT_LIFECYCLE_AT = readEmitLifecycleAt();
const kgWriteCounter = new Map();

function incrementKgWritesCounter(predicate) {
  kgWriteCounter.set(predicate, (kgWriteCounter.get(predicate) || 0) + 1);
}

function sanitizeObj(value) {
  let text = value == null ? '' : String(value);
  text = text.replace(/File\s+"[^"]+",\s+line\s+\d+(?:,\s+in\s+\S+)?/g, ' ');
  text = text.replace(/\/[^\s:;,)\]}]+/g, ' ');
  text = text.replace(/[\r\n]/g, ' ').toLowerCase();
  text = text.replace(/[^a-z0-9]+/g, '-');
  text = text.replace(/-+/g, '-').replace(/^-|-$/g, '');
  return text.slice(0, 80).replace(/-$/g, '');
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

async function emitSupersededEvent({
  subject,
  predicate,
  priorObject,
  newObject,
  sourceEpic,
  sourceAgent,
}) {
  if (EMIT_LIFECYCLE_AT === 'off') {
    return { emitted: false, metadata: null };
  }

  const prior = sanitizeObj(priorObject);
  const next = sanitizeObj(newObject);
  const validFrom = new Date().toISOString();
  const metadata = {
    subject,
    predicate: 'superseded',
    object: `${prior}->${next}`,
    source_epic: sourceEpic,
    source_agent: sourceAgent,
    valid_from: validFrom,
    valid_until: null,
    superseded_subject: subject,
    superseded_predicate: predicate,
    prior_object: prior,
    new_object: next,
    prior_valid_until_updated: false,
  };

  try {
    const result = await kgSupersede(subject, predicate, prior, next, sourceEpic, sourceAgent);
    metadata.prior_valid_until_updated = Boolean(result && result.updated > 0);
  } catch (err) {
    if (isUnavailableKgError(err)) {
      return { emitted: false, metadata: null };
    }
    throw err;
  }

  incrementKgWritesCounter('superseded');
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
  emitSupersededEvent,
  getKgWritesCounterSnapshot,
  resetKgWritesCounterForTest,
  sanitizeObj,
};
