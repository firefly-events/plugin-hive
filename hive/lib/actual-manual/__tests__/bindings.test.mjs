import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadBindings, validateBindings, KNOWN_TRUTH_SIGNALS } from '../bindings.mjs';

function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'hive-bindings-'));
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

function writeOverlay(dir, obj) {
  const filePath = join(dir, 'overlay.json');
  writeFileSync(filePath, JSON.stringify(obj), 'utf8');
  return filePath;
}

const VALID_NATIVE_OVERLAY = {
  scenario: 'flayr-campaign-compose',
  steps: [
    { how: 'native', act: 'goto', args: { url: 'https://app.flayr.com/campaigns/new' } },
    { how: 'native', act: 'fill', args: { selector: '[data-testid=caption-input]', value: 'Hello' }, truth: 'cta_enabled' },
  ],
};

const VALID_VISION_OVERLAY = {
  scenario: 'flayr-campaign-compose',
  steps: [
    { how: 'vision', target: 'Post Now button', truth: 'posted' },
  ],
};

// ── Well-formed cases ──────────────────────────────────────────────────────────

test('accepts well-formed native overlay', () => {
  const dir = makeTmp();
  try {
    const filePath = writeOverlay(dir, VALID_NATIVE_OVERLAY);
    const result = loadBindings(filePath, 'flayr-campaign-compose');
    assert.equal(result.scenario, 'flayr-campaign-compose');
    assert.equal(result.steps.length, 2);
    assert.equal(result.steps[0].how, 'native');
    assert.equal(result.steps[0].act, 'goto');
  } finally {
    cleanup(dir);
  }
});

test('accepts well-formed vision overlay', () => {
  const dir = makeTmp();
  try {
    const filePath = writeOverlay(dir, VALID_VISION_OVERLAY);
    const result = loadBindings(filePath, 'flayr-campaign-compose');
    assert.equal(result.steps[0].how, 'vision');
    assert.equal(result.steps[0].target, 'Post Now button');
    assert.equal(result.steps[0].truth, 'posted');
  } finally {
    cleanup(dir);
  }
});

test('accepts mixed native+vision overlay with setup[]', () => {
  const dir = makeTmp();
  try {
    const overlay = {
      scenario: 'flayr-campaign-compose',
      steps: [
        { how: 'native', act: 'goto', args: { url: 'https://app.flayr.com/' } },
        {
          how: 'vision',
          target: 'Post Now button',
          setup: [
            { act: 'fill', args: { selector: '[data-testid=caption]', value: 'hi' } },
          ],
          truth: 'posted',
        },
      ],
    };
    const filePath = writeOverlay(dir, overlay);
    const result = loadBindings(filePath, 'flayr-campaign-compose');
    assert.equal(result.steps[1].setup.length, 1);
    assert.equal(result.steps[1].setup[0].act, 'fill');
  } finally {
    cleanup(dir);
  }
});

test('all native act values are accepted', () => {
  const acts = [
    { act: 'goto', args: { url: 'https://x.com' } },
    { act: 'fill', args: { selector: 'input', value: 'v' } },
    { act: 'tapRole', args: { role: 'button', name: 'Submit' } },
    { act: 'tapText', args: { text: 'Submit' } },
    { act: 'wait', args: { ms: 500 } },
  ];
  for (const { act, args } of acts) {
    assert.doesNotThrow(
      () => validateBindings({ scenario: 'x', steps: [{ how: 'native', act, args }] }, 'x'),
      `act "${act}" should be accepted`,
    );
  }
});

function assertThrows(fn) {
  try {
    fn();
    throw new assert.AssertionError({ message: 'Expected function to throw' });
  } catch (e) {
    if (e instanceof assert.AssertionError && e.message === 'Expected function to throw') throw e;
    return e;
  }
}

// ── Unknown how ────────────────────────────────────────────────────────────────

test('rejects unknown how value', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'manual', act: 'goto', args: {} }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /step 0/);
  assert.match(err.message, /"how"/);
  assert.match(err.message, /manual/);
  assert.equal(err.scenarioId, 'test');
  assert.equal(err.stepIndex, 0);
});

// ── Missing vision target ──────────────────────────────────────────────────────

test('rejects vision step with missing target', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'vision' }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /step 0/);
  assert.match(err.message, /target/);
});

test('rejects vision step with empty target string', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'vision', target: '   ' }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /target/);
});

// ── Unknown truth signal ───────────────────────────────────────────────────────

test('rejects unknown truth signal', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'native', act: 'goto', args: {}, truth: 'unknown_signal' }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /truth signal/);
  assert.match(err.message, /unknown_signal/);
  assert.match(err.message, /step 0/);
});

test('accepts truth signal added to KNOWN_TRUTH_SIGNALS', () => {
  KNOWN_TRUTH_SIGNALS.add('custom_signal');
  try {
    assert.doesNotThrow(() =>
      validateBindings(
        { scenario: 'x', steps: [{ how: 'vision', target: 'btn', truth: 'custom_signal' }] },
        'x',
      ),
    );
  } finally {
    KNOWN_TRUTH_SIGNALS.delete('custom_signal');
  }
});

// ── Unknown native act ─────────────────────────────────────────────────────────

test('rejects native step with unknown act', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'native', act: 'click', args: {} }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /"act"/);
  assert.match(err.message, /click/);
  assert.match(err.message, /step 0/);
});

// ── Missing native args ────────────────────────────────────────────────────────

test('rejects native step with missing args', () => {
  const err = assertThrows(() =>
    validateBindings(
      { scenario: 'test', steps: [{ how: 'native', act: 'goto' }] },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /args/);
  assert.match(err.message, /step 0/);
});

// ── Setup validation ──────────────────────────────────────────────────────────

test('rejects setup item with unknown act', () => {
  const err = assertThrows(() =>
    validateBindings(
      {
        scenario: 'test',
        steps: [
          {
            how: 'vision',
            target: 'btn',
            setup: [{ act: 'hover', args: {} }],
          },
        ],
      },
      'test',
    ),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /setup\[0\]/);
  assert.match(err.message, /hover/);
});

// ── Missing scenario field ────────────────────────────────────────────────────

test('rejects overlay missing scenario field', () => {
  const err = assertThrows(() =>
    validateBindings({ steps: [{ how: 'native', act: 'goto', args: {} }] }, 'test'),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /"scenario"/);
});

// ── Scenario mismatch ─────────────────────────────────────────────────────────

test('rejects overlay authored for a different scenario', () => {
  const dir = makeTmp();
  try {
    const filePath = writeOverlay(dir, {
      scenario: 'other-scenario',
      steps: [{ how: 'native', act: 'goto', args: { url: 'https://x.com' } }],
    });
    const err = assertThrows(() => loadBindings(filePath, 'expected-scenario'));
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.match(err.message, /different scenario/);
    assert.match(err.message, /other-scenario/);
  } finally {
    cleanup(dir);
  }
});

test('accepts overlay when no concrete scenario id is required', () => {
  const dir = makeTmp();
  try {
    // loadBindings without an expected id infers from doc.scenario → no mismatch.
    const filePath = writeOverlay(dir, {
      scenario: 'whatever-id',
      steps: [{ how: 'native', act: 'goto', args: { url: 'https://x.com' } }],
    });
    assert.doesNotThrow(() => loadBindings(filePath));
  } finally {
    cleanup(dir);
  }
});

// ── Empty steps ───────────────────────────────────────────────────────────────

test('rejects overlay with empty steps array', () => {
  const err = assertThrows(() =>
    validateBindings({ scenario: 'test', steps: [] }, 'test'),
  );
  assert.equal(err.code, 'VALIDATION_ERROR');
  assert.match(err.message, /"steps"/);
});

// ── File not found ────────────────────────────────────────────────────────────

test('throws FILE_NOT_FOUND for missing file', () => {
  const err = assertThrows(() =>
    loadBindings('/nonexistent/path/overlay.json', 'my-scenario'),
  );
  assert.equal(err.code, 'FILE_NOT_FOUND');
  assert.equal(err.scenarioId, 'my-scenario');
});

// ── JSON parse error ──────────────────────────────────────────────────────────

test('throws JSON_PARSE_ERROR for malformed JSON', () => {
  const dir = makeTmp();
  try {
    const filePath = join(dir, 'bad.json');
    writeFileSync(filePath, '{ not valid json }', 'utf8');
    const err = assertThrows(() => loadBindings(filePath, 'test'));
    assert.equal(err.code, 'JSON_PARSE_ERROR');
  } finally {
    cleanup(dir);
  }
});

// ── Error names scenario + step index ────────────────────────────────────────

test('error message names scenario id and step index on step 2', () => {
  const err = assertThrows(() =>
    validateBindings(
      {
        scenario: 'my-flow',
        steps: [
          { how: 'native', act: 'goto', args: { url: 'https://x.com' } },
          { how: 'vision', target: 'btn' },
          { how: 'native', act: 'badact', args: {} },
        ],
      },
      'my-flow',
    ),
  );
  assert.match(err.message, /my-flow/);
  assert.match(err.message, /step 2/);
  assert.equal(err.stepIndex, 2);
});
