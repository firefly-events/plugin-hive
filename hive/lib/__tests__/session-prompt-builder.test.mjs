// PAN-7194 — memory-injection tests for buildPromptWithMemory().
//
// Runner-agnostic: verifies that NON-Claude runners get a Mnemosyne recall
// bundle appended to their first-message prompt, and — critically — that a
// recall MISS or ERROR falls open to the exact plain buildPrompt() output and
// never throws. Uses an injected recall stub (opts.recall), so it hits no
// network and needs no running Mnemosyne service.
//
// Run: node --test hive/lib/__tests__/session-prompt-builder.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildPrompt, buildPromptWithMemory } = require('../session-prompt-builder.js');

const STORY = '# Add retry to the S3 uploader\nImplement exponential backoff on the upload path so transient 5xx errors are retried.';

const hitResult = {
  total_hits: 2,
  scopes: [
    {
      scope: 'ffe',
      hits: [
        {
          source: 'hive/lib/uploader.js',
          chunk_span: [40, 61],
          score: 0.87,
          match_type: 'semantic',
          text: 'prior decision: use p-retry with base delay 200ms and jitter for the S3 path',
        },
        {
          source: 'docs/retry-policy.md',
          score: 0.72,
          match_type: 'semantic',
          text: 'cap retries at 3 attempts; do not retry 4xx',
        },
      ],
    },
  ],
};

test('injects a "## Recalled Memory" block when recall returns hits', async () => {
  const recall = async () => hitResult;
  const out = await buildPromptWithMemory({ story_context: STORY }, { recall });
  assert.ok(out.includes('## Recalled Memory'), 'must contain the Recalled Memory header');
  assert.ok(out.includes('hive/lib/uploader.js'), 'must contain a recalled pointer source');
  assert.ok(out.includes('lines 40-61'), 'must render the chunk line range');
  assert.ok(out.startsWith(STORY), 'story_context must remain the unreordered prefix');
});

test('recall MISS leaves the prompt byte-identical to buildPrompt() and does not throw', async () => {
  const recall = async () => ({ total_hits: 0, scopes: [] });
  const base = buildPrompt({ story_context: STORY });
  let out;
  await assert.doesNotReject(async () => {
    out = await buildPromptWithMemory({ story_context: STORY }, { recall });
  });
  assert.equal(out, base, 'a miss must not alter the prompt');
  assert.ok(!out.includes('## Recalled Memory'), 'no memory section on a miss');
});

test('recall ERROR falls open to plain buildPrompt() output and does not throw', async () => {
  const recall = async () => { throw new Error('mnemosyne unreachable'); };
  const base = buildPrompt({ story_context: STORY });
  let out;
  await assert.doesNotReject(async () => {
    out = await buildPromptWithMemory({ story_context: STORY }, { recall });
  });
  assert.equal(out, base, 'an error must fall open to the plain prompt');
});

test('the injected bundle respects the size cap', async () => {
  const bigHits = Array.from({ length: 60 }, (_, i) => ({
    source: `pkg/module-${i}.js`,
    score: 0.9 - i * 0.001,
    match_type: 'semantic',
    text: 'x'.repeat(400),
  }));
  const recall = async () => ({ total_hits: bigHits.length, scopes: [{ scope: 'ffe', hits: bigHits }] });
  const maxChars = 1500;
  const out = await buildPromptWithMemory({ story_context: STORY }, { recall, maxChars });
  const marker = '## Recalled Memory\n';
  const idx = out.indexOf(marker);
  assert.ok(idx >= 0, 'memory section present for the hit case');
  const bundle = out.slice(idx + marker.length);
  assert.ok(bundle.length <= maxChars, `bundle (${bundle.length}) must be <= cap (${maxChars})`);
});

test('missing story_context still throws (required-field behavior preserved)', async () => {
  await assert.rejects(
    async () => buildPromptWithMemory({ story_context: '' }, { recall: async () => hitResult }),
    /story_context is required/,
  );
});
