'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'hive', 'lib', 'config.js');
const EMIT_PATH = path.join(ROOT, 'hive', 'lib', 'kg-emit.js');
const SESSION_END_PATH = path.join(ROOT, 'hive', 'lib', 'session-end.js');

function clearModules() {
  for (const modulePath of [CONFIG_PATH, EMIT_PATH, SESSION_END_PATH]) {
    delete require.cache[require.resolve(modulePath)];
  }
}

async function withConfigText(text, fn) {
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  fs.existsSync = function patchedExistsSync(filePath) {
    if (String(filePath).endsWith('hive.config.yaml')) return true;
    return originalExistsSync.call(this, filePath);
  };
  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (String(filePath).endsWith('hive.config.yaml')) return text;
    return originalReadFileSync.call(this, filePath, ...args);
  };
  try {
    return await fn();
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    clearModules();
  }
}

function loadEmitterWithKgWrite(text, kgWrite, kgSupersede = async () => ({ updated: 0 })) {
  clearModules();
  return withConfigText(text, () => {
    const sessionEnd = require(SESSION_END_PATH);
    sessionEnd.kgWrite = kgWrite;
    sessionEnd.kgSupersede = kgSupersede;
    return require(EMIT_PATH);
  });
}

function event(overrides = {}) {
  return {
    subject: 'story-1',
    predicate: 'phase_failed',
    object: 'phase=test failed',
    sourceEpic: 'kg-signal-revival',
    sourceAgent: 'tester',
    ...overrides,
  };
}

for (const knob of ['phase', 'story', 'step']) {
  test(`knob value ${knob} permits emit`, async () => {
    const writes = [];
    const emitter = await loadEmitterWithKgWrite(`emit_lifecycle_at: ${knob}\n`, async (...args) => {
      writes.push(args);
    });

    const result = await emitter.emitKgEvent(event());

    assert.equal(result.emitted, true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1], 'kg-signal-revival');
    assert.equal(writes[0][2], 'tester');
    assert.equal(writes[0][0][0].predicate, 'phase_failed');
    assert.deepEqual(Object.keys(result.metadata).sort(), [
      'object',
      'predicate',
      'source_agent',
      'source_epic',
      'subject',
      'valid_from',
      'valid_until',
    ]);
  });
}

test('knob value off no-ops without kg_write or counter increment', async () => {
  let writes = 0;
  const emitter = await loadEmitterWithKgWrite('emit_lifecycle_at: off\n', async () => {
    writes += 1;
  });

  const result = await emitter.emitKgEvent(event());

  assert.deepEqual(result, { emitted: false, metadata: null });
  assert.equal(writes, 0);
  assert.deepEqual(emitter.getKgWritesCounterSnapshot(), { kg_writes_total: {} });
});

test('counter increments on successful emit by predicate', async () => {
  const emitter = await loadEmitterWithKgWrite('emit_lifecycle_at: phase\n', async () => {});

  await emitter.emitKgEvent(event({ predicate: 'phase_failed' }));
  await emitter.emitKgEvent(event({ predicate: 'phase_failed' }));
  await emitter.emitKgEvent(event({ predicate: 'phase_blocked' }));

  assert.deepEqual(emitter.getKgWritesCounterSnapshot(), {
    kg_writes_total: {
      phase_failed: 2,
      phase_blocked: 1,
    },
  });
});

test('no-op when kg.sqlite unavailable', async () => {
  let writes = 0;
  const emitter = await loadEmitterWithKgWrite('emit_lifecycle_at: phase\n', async () => {
    writes += 1;
    const err = new Error('kg.sqlite not found at /tmp/kg.sqlite');
    err.code = 'SQLITE_CANTOPEN';
    throw err;
  });

  const result = await emitter.emitKgEvent(event());

  assert.deepEqual(result, { emitted: false, metadata: null });
  assert.equal(writes, 1);
  assert.deepEqual(emitter.getKgWritesCounterSnapshot(), { kg_writes_total: {} });
});

test('emitSupersededEvent updates prior and emits one provenance edge', async () => {
  const writes = [];
  const emitter = await loadEmitterWithKgWrite(
    'emit_lifecycle_at: phase\n',
    async () => {},
    async (...args) => {
      writes.push(args);
      return { updated: 1 };
    }
  );

  const result = await emitter.emitSupersededEvent({
    subject: 'story-1',
    predicate: 'story-spec',
    priorObject: 'Old Hash',
    newObject: 'New Hash',
    sourceEpic: 'kg-signal-revival',
    sourceAgent: 'plan',
  });

  assert.equal(result.emitted, true);
  assert.equal(result.metadata.object, 'old-hash->new-hash');
  assert.equal(result.metadata.prior_valid_until_updated, true);
  assert.deepEqual(writes[0], [
    'story-1',
    'story-spec',
    'old-hash',
    'new-hash',
    'kg-signal-revival',
    'plan',
  ]);
  assert.deepEqual(emitter.getKgWritesCounterSnapshot(), {
    kg_writes_total: { superseded: 1 },
  });
});

test('emitSupersededEvent off knob no-ops before kg write', async () => {
  let writes = 0;
  const emitter = await loadEmitterWithKgWrite(
    'emit_lifecycle_at: off\n',
    async () => {},
    async () => {
      writes += 1;
    }
  );

  const result = await emitter.emitSupersededEvent({
    subject: 'story-1',
    predicate: 'story-spec',
    priorObject: 'old',
    newObject: 'new',
    sourceEpic: 'kg-signal-revival',
    sourceAgent: 'plan',
  });

  assert.deepEqual(result, { emitted: false, metadata: null });
  assert.equal(writes, 0);
});

test('emitSupersededEvent no-ops when kg.sqlite unavailable', async () => {
  const emitter = await loadEmitterWithKgWrite(
    'emit_lifecycle_at: phase\n',
    async () => {},
    async () => {
      const err = new Error('kg.sqlite not found at /tmp/kg.sqlite');
      err.code = 'SQLITE_CANTOPEN';
      throw err;
    }
  );

  const result = await emitter.emitSupersededEvent({
    subject: 'story-1',
    predicate: 'story-spec',
    priorObject: 'old',
    newObject: 'new',
    sourceEpic: 'kg-signal-revival',
    sourceAgent: 'plan',
  });

  assert.deepEqual(result, { emitted: false, metadata: null });
  assert.deepEqual(emitter.getKgWritesCounterSnapshot(), { kg_writes_total: {} });
});

test('unknown knob value raises clear config-reader error', async () => {
  await assert.rejects(
    () => loadEmitterWithKgWrite('emit_lifecycle_at: banana\n', async () => {}),
    /Invalid emit_lifecycle_at .*Allowed values: phase, story, step, off/
  );
});
