import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveAnchor,
  classifyItem,
  findStuckTriageItems,
} from '../triage-aging-finder.mjs';

const NOW = '2026-06-09T20:00:00Z';

function makeItem(over = {}) {
  return {
    id: 't-001',
    state: 'inbox',
    kind: 'bug',
    title: 'A stuck item',
    description: '',
    reporter: 'reporter@x',
    reported_at: '2026-06-08T20:00:00Z',
    priority: null,
    severity: null,
    state_history: [{ state: 'inbox', at: '2026-06-08T20:00:00Z' }],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// resolveAnchor
// ---------------------------------------------------------------------------

test('resolveAnchor — uses last state_history entry when present', () => {
  const item = makeItem({
    state_history: [
      { state: 'inbox', at: '2026-06-01T00:00:00Z' },
      { state: 'clarified', at: '2026-06-04T00:00:00Z' },
    ],
  });
  assert.equal(resolveAnchor(item), '2026-06-04T00:00:00Z');
});

test('resolveAnchor — falls back to reported_at when history empty', () => {
  const item = makeItem({ state_history: [] });
  assert.equal(resolveAnchor(item), '2026-06-08T20:00:00Z');
});

test('resolveAnchor — returns null when nothing usable', () => {
  assert.equal(resolveAnchor({ id: 't-bad' }), null);
  assert.equal(resolveAnchor(null), null);
  assert.equal(resolveAnchor(undefined), null);
});

// ---------------------------------------------------------------------------
// classifyItem
// ---------------------------------------------------------------------------

test('classifyItem — null for closed item', () => {
  const item = makeItem({ state: 'closed' });
  assert.equal(classifyItem(item, NOW), null);
});

test('classifyItem — null for unknown state', () => {
  const item = makeItem({ state: 'totally-made-up' });
  assert.equal(classifyItem(item, NOW), null);
});

test('classifyItem — null for fresh inbox item (≤7d)', () => {
  const item = makeItem({
    state: 'inbox',
    state_history: [{ state: 'inbox', at: '2026-06-08T00:00:00Z' }],
  });
  assert.equal(classifyItem(item, NOW), null);
});

test('classifyItem — medium tier for 8d-stuck inbox', () => {
  const item = makeItem({
    state: 'inbox',
    state_history: [{ state: 'inbox', at: '2026-06-01T20:00:00Z' }],
  });
  const result = classifyItem(item, NOW);
  assert.equal(result.tier, 'medium');
});

test('classifyItem — critical tier for 15d-stuck inbox', () => {
  const item = makeItem({
    state: 'inbox',
    state_history: [{ state: 'inbox', at: '2026-05-25T00:00:00Z' }],
  });
  const result = classifyItem(item, NOW);
  assert.equal(result.tier, 'critical');
});

test('classifyItem — plan-ready uses softer 14d threshold', () => {
  const item = makeItem({
    state: 'plan-ready',
    state_history: [{ state: 'plan-ready', at: '2026-06-01T00:00:00Z' }],
  });
  assert.equal(classifyItem(item, NOW), null); // 8d < 14d
});

test('classifyItem — plan-ready: 15d stuck → medium', () => {
  const item = makeItem({
    state: 'plan-ready',
    state_history: [{ state: 'plan-ready', at: '2026-05-25T20:00:00Z' }],
  });
  const result = classifyItem(item, NOW);
  assert.equal(result.tier, 'medium');
});

test('classifyItem — plan-ready: 31d stuck → critical', () => {
  const item = makeItem({
    state: 'plan-ready',
    state_history: [{ state: 'plan-ready', at: '2026-05-09T00:00:00Z' }],
  });
  const result = classifyItem(item, NOW);
  assert.equal(result.tier, 'critical');
});

test('classifyItem — uses fallback anchor when state_history malformed', () => {
  const item = makeItem({
    state: 'inbox',
    state_history: [],
    reported_at: '2026-05-25T00:00:00Z',
  });
  const result = classifyItem(item, NOW);
  assert.equal(result.tier, 'critical');
});

// ---------------------------------------------------------------------------
// findStuckTriageItems
// ---------------------------------------------------------------------------

test('findStuckTriageItems — throws when caller forgets nowIso', () => {
  assert.throws(() => findStuckTriageItems({ items: [] }), /nowIso/);
});

test('findStuckTriageItems — null/empty queue returns no findings', () => {
  assert.deepEqual(findStuckTriageItems(null, { nowIso: NOW }), []);
  assert.deepEqual(findStuckTriageItems(undefined, { nowIso: NOW }), []);
  assert.deepEqual(findStuckTriageItems({}, { nowIso: NOW }), []);
  assert.deepEqual(findStuckTriageItems({ items: [] }, { nowIso: NOW }), []);
});

test('findStuckTriageItems — emits one finding per stuck item, severity-mapped + sorted', () => {
  const queue = {
    version: 1,
    items: [
      makeItem({
        id: 't-101',
        title: 'fresh',
        state: 'inbox',
        state_history: [{ state: 'inbox', at: '2026-06-09T00:00:00Z' }],
      }),
      makeItem({
        id: 't-102',
        title: 'medium-stuck inbox',
        state: 'inbox',
        state_history: [{ state: 'inbox', at: '2026-06-01T00:00:00Z' }],
      }),
      makeItem({
        id: 't-103',
        title: 'critical-stuck inbox',
        state: 'inbox',
        state_history: [{ state: 'inbox', at: '2026-05-20T00:00:00Z' }],
      }),
      makeItem({
        id: 't-104',
        title: 'closed item',
        state: 'closed',
        state_history: [{ state: 'closed', at: '2026-05-01T00:00:00Z' }],
      }),
    ],
  };
  const findings = findStuckTriageItems(queue, { nowIso: NOW });
  assert.equal(findings.length, 2);
  // critical (high severity) sorts first; medium second
  assert.equal(findings[0].evidence.triage_id, 't-103');
  assert.equal(findings[0].severity, 'high');
  assert.equal(findings[1].evidence.triage_id, 't-102');
  assert.equal(findings[1].severity, 'medium');
});

test('findStuckTriageItems — finding shape carries triage_id, kind, state, age, tier', () => {
  const queue = {
    items: [
      makeItem({
        id: 't-200',
        title: 'still stuck',
        state: 'prioritized',
        priority: 'p1',
        state_history: [
          { state: 'inbox', at: '2026-05-15T00:00:00Z' },
          { state: 'clarified', at: '2026-05-20T00:00:00Z' },
          { state: 'prioritized', at: '2026-05-25T00:00:00Z' },
        ],
      }),
    ],
  };
  const [f] = findStuckTriageItems(queue, { nowIso: NOW });
  assert.equal(f.id, 'finding-triage-t-200');
  assert.equal(f.category, 'STUCK_TRIAGE_ITEM');
  assert.equal(f.location, 'triage:t-200');
  assert.equal(f.evidence.triage_id, 't-200');
  assert.equal(f.evidence.kind, 'bug');
  assert.equal(f.evidence.state, 'prioritized');
  assert.equal(f.evidence.age_days, 15);
  assert.equal(f.evidence.tier, 'critical');
  assert.equal(f.evidence.priority, 'p1');
  assert.equal(f.evidence.anchor, '2026-05-25T00:00:00Z');
});

test('findStuckTriageItems — graceful when queue.items is not an array', () => {
  assert.deepEqual(findStuckTriageItems({ items: 'oops' }, { nowIso: NOW }), []);
});
