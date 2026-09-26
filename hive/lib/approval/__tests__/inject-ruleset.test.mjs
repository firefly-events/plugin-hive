/**
 * Tests for inject-ruleset.mjs — injecting the Dostal approval ruleset into
 * a consuming project's AGENTS.md / CLAUDE.md (DOS-221).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { injectRuleset, upsertBlock } from '../inject-ruleset.mjs';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'approval-ruleset-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('upsertBlock inserts the block into empty content', () => {
  const result = upsertBlock('', 'Some ruleset text.');
  assert.match(result, /dostal:approval-ruleset:start/);
  assert.match(result, /Some ruleset text\./);
  assert.match(result, /dostal:approval-ruleset:end/);
});

test('upsertBlock appends after existing content, preserving it', () => {
  const result = upsertBlock('# My Project\n\nSome existing rules.\n', 'Ruleset body.');
  assert.match(result, /# My Project/);
  assert.match(result, /Some existing rules\./);
  assert.match(result, /Ruleset body\./);
});

test('upsertBlock is idempotent: re-running replaces the block in place, not appends a duplicate', () => {
  const once = upsertBlock('# My Project\n', 'Version 1.');
  const twice = upsertBlock(once, 'Version 2.');
  assert.equal((twice.match(/dostal:approval-ruleset:start/g) || []).length, 1);
  assert.doesNotMatch(twice, /Version 1\./);
  assert.match(twice, /Version 2\./);
  assert.match(twice, /# My Project/);
});

test('injectRuleset creates AGENTS.md and CLAUDE.md when neither exists', async () => {
  await withTempDir(async (dir) => {
    const results = await injectRuleset(dir);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.changed));

    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(agents, /Dostal approval ruleset/);
    assert.match(claude, /Dostal approval ruleset/);
    assert.match(agents, /No pure-chat secret-entry path/);
  });
});

test('injectRuleset preserves existing project content in AGENTS.md / CLAUDE.md', async () => {
  await withTempDir(async (dir) => {
    await fs.writeFile(path.join(dir, 'AGENTS.md'), '# Project rules\n\nBuild with `make build`.\n');
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Claude notes\n\nUse TypeScript.\n');

    await injectRuleset(dir);

    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    const claude = await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(agents, /Build with `make build`/);
    assert.match(agents, /Dostal approval ruleset/);
    assert.match(claude, /Use TypeScript/);
    assert.match(claude, /Dostal approval ruleset/);
  });
});

test('injectRuleset run twice is idempotent (no duplicate blocks, changed=false on the second run)', async () => {
  await withTempDir(async (dir) => {
    const first = await injectRuleset(dir);
    assert.ok(first.every((r) => r.changed));

    const second = await injectRuleset(dir);
    assert.ok(second.every((r) => r.changed === false));

    const agents = await fs.readFile(path.join(dir, 'AGENTS.md'), 'utf8');
    assert.equal((agents.match(/dostal:approval-ruleset:start/g) || []).length, 1);
  });
});
