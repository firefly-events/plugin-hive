import { test } from 'node:test';
import assert from 'node:assert/strict';

import { native } from '../flow-runner.mjs';

// Minimal Playwright-Page stub that records what fill/click receive.
function fakePage(sink) {
  const leaf = (record) => ({
    fill: async (v) => { sink.push({ ...record, fill: v }); },
    click: async () => { sink.push({ ...record, click: true }); },
  });
  const chain = (record) => ({ first: () => leaf(record) });
  return {
    locator: (selector) => chain({ op: 'locator', selector }),
    getByText: (re) => chain({ op: 'getByText', re: re.source }),
    getByRole: (role, o) => chain({ op: 'getByRole', role, name: o.name.source }),
    goto: async () => {},
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
}

// ── fill: text|value alias ──────────────────────────────────────────────────────

test('fill uses args.text when present', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'fill', args: { selector: '#c', text: 'FromText' } });
  assert.equal(sink[0].fill, 'FromText');
});

test('fill falls back to args.value (overlay-schema field)', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'fill', args: { selector: '#c', value: 'FromValue' } });
  assert.equal(sink[0].fill, 'FromValue');
});

test('fill never silently fills empty when value is provided', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'fill', args: { selector: '#c', value: 'Hello' } });
  assert.notEqual(sink[0].fill, '');
});

// ── tapText: text|name alias, never /undefined/ ─────────────────────────────────

test('tapText uses args.text and never builds /undefined/', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'tapText', args: { text: 'Submit' } });
  assert.equal(sink[0].re, 'Submit');
  assert.doesNotMatch(sink[0].re, /undefined/);
});

test('tapText still honors legacy args.name', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'tapText', args: { name: 'Legacy' } });
  assert.equal(sink[0].re, 'Legacy');
});

test('tapText throws when neither text nor name is given', async () => {
  await assert.rejects(
    () => native(fakePage([]), { act: 'tapText', args: {} }),
    /requires args\.text or args\.name/,
  );
});

// ── tapRole still reads args.name ───────────────────────────────────────────────

test('tapRole reads args.name', async () => {
  const sink = [];
  await native(fakePage(sink), { act: 'tapRole', args: { role: 'button', name: 'Go' } });
  assert.equal(sink[0].name, 'Go');
  assert.equal(sink[0].role, 'button');
});
