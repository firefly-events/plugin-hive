import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const gate = path.resolve(here, '../../../../hooks/mcp-min-version-gate.sh');
const policyPath = path.resolve(here, '../../../compatibility-policy.json');
const policy = JSON.parse(await readFile(policyPath, 'utf8'));
const floor = policy.claude_code.minimum_version;
const floorParts = floor.split('.').map(Number);
const belowFloor = [...floorParts.slice(0, -1), floorParts.at(-1) - 1].join('.');
const floorPattern = new RegExp(floor.replaceAll('.', '\\.'));

async function withClaude(version, run) {
  const binDir = await mkdtemp(path.join(tmpdir(), 'hive-claude-version-'));
  try {
    const claude = path.join(binDir, 'claude');
    await writeFile(claude, `#!/bin/sh\nprintf '%s\\n' '${version}'\n`);
    await chmod(claude, 0o755);
    return run(`${binDir}:/usr/bin:/bin`);
  } finally {
    await rm(binDir, { recursive: true, force: true });
  }
}

function runGate(PATH) {
  return spawnSync('/bin/bash', [gate], {
    encoding: 'utf8',
    env: { ...process.env, PATH },
  });
}

test('below-floor Claude Code fails loudly with update remediation', async () => {
  await withClaude(belowFloor, (PATH) => {
    const result = runGate(PATH);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`REQUIRES CLAUDE CODE ${floorPattern.source} OR NEWER`));
    assert.match(result.stderr, /claude update/);
  });
});

test('at-floor and above-floor Claude Code versions pass silently', async () => {
  for (const version of [floor, '2.2.0']) {
    await withClaude(version, (PATH) => {
      const result = runGate(PATH);
      assert.equal(result.status, 0);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
    });
  }
});

test('missing Claude binary fails loudly because the minimum cannot be verified', () => {
  const result = runGate('/usr/bin:/bin');
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /COULD NOT VERIFY THE CLAUDE CODE VERSION/);
  assert.match(result.stderr, new RegExp(`${floorPattern.source} OR NEWER`));
});

test('unparseable Claude version fails loudly', async () => {
  await withClaude('Claude Code dev-build', (PATH) => {
    const result = runGate(PATH);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /COULD NOT VERIFY THE CLAUDE CODE VERSION/);
  });
});
