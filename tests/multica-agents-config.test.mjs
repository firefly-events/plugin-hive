import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseAgentsConfig, resolveAgentInstructions } from '../hive/lib/multica-agents-config/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('AC1 parses tracked Multica agents config', () => {
  const yamlString = fs.readFileSync(path.join(repoRoot, '.pHive/multica/agents.yaml'), 'utf8');
  const config = parseAgentsConfig(yamlString);

  assert.equal(config.agents.length, 3);

  for (const agent of config.agents) {
    assert.ok(agent.name);
    assert.ok(agent.provider);
    assert.ok(agent.model);
    assert.ok(agent.persona_ref);
  }
});

test('AC2 developer persona exists and is non-empty markdown', () => {
  const personaPath = path.join(repoRoot, 'hive/agents/developer.md');
  const content = fs.readFileSync(personaPath, 'utf8');

  assert.equal(path.extname(personaPath), '.md');
  assert.ok(content.trim().length > 0);
});

test('AC3 rejects future schema versions', () => {
  assert.throws(
    () => parseAgentsConfig(`schema_version: 2
agents:
  - name: developer
    provider: claude
    model: claude-sonnet-4-6
    persona_ref: hive/agents/developer.md
`),
    /schema version mismatch/,
  );
});

test('AC4 missing persona_ref error names agent and path', () => {
  const agent = {
    name: 'developer',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    persona_ref: 'hive/agents/nonexistent.md',
  };

  assert.throws(
    () => resolveAgentInstructions(agent, repoRoot),
    (error) => error.message.includes('developer') && error.message.includes('hive/agents/nonexistent.md'),
  );
});

test('AC5 Multica agents config is not ignored', () => {
  const result = spawnSync('git', ['check-ignore', '.pHive/multica/agents.yaml'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
});
