import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseAgentsConfig } from '../index.mjs';

test('parses an inline flow sequence for skills into an array of names', () => {
  const yaml = `schema_version: 1
agents:
  - name: writer
    provider: codex
    model: ""
    persona_ref: hive/agents/technical-writer.md
    skills: [story-writing, architecture-doc, readme, adr, research-brief, runbook]
    visibility: workspace
  - name: dev
    provider: codex
    model: ""
    persona_ref: hive/agents/developer.md
    skills: []
    visibility: workspace
`;
  const cfg = parseAgentsConfig(yaml);
  const writer = cfg.agents.find((a) => a.name === 'writer');
  const dev = cfg.agents.find((a) => a.name === 'dev');
  assert.deepEqual(writer.skills, ['story-writing', 'architecture-doc', 'readme', 'adr', 'research-brief', 'runbook']);
  assert.deepEqual(dev.skills, []);
});

test('trims whitespace and drops empty entries in a flow sequence', () => {
  const yaml = `schema_version: 1
agents:
  - name: writer
    provider: codex
    model: ""
    persona_ref: hive/agents/technical-writer.md
    skills: [ story-writing ,adr ,, ]
    visibility: workspace
`;
  const cfg = parseAgentsConfig(yaml);
  assert.deepEqual(cfg.agents[0].skills, ['story-writing', 'adr']);
});

test('empty flow sequence still parses to an empty array (no regression)', () => {
  const yaml = `schema_version: 1
agents:
  - name: dev
    provider: codex
    model: ""
    persona_ref: hive/agents/developer.md
    custom_args: []
    skills: []
    visibility: workspace
`;
  const cfg = parseAgentsConfig(yaml);
  assert.deepEqual(cfg.agents[0].skills, []);
  assert.deepEqual(cfg.agents[0].custom_args, []);
});
