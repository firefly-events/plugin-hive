'use strict';

/**
 * Routing fixture tests for tce-3-bootstrap-reconciliation-tests.
 *
 * Asserts every row of the §2.4 routing table:
 *   Codex runtime  : researcher / developer / backend-developer /
 *                    frontend-developer / technical-writer / architect
 *   Claude Sonnet  : tester / qa-engineer / ui-designer
 *   Claude Opus    : reviewer / peer-validator / security
 *
 * Run: node --test tests/multica-bootstrap-routing.test.js
 *
 * Story: tce-3-bootstrap-reconciliation-tests (team-cell-execution-mode)
 * Acceptance criteria covered:
 *   RT-1  All Codex-tier agents resolve to Codex runtime
 *   RT-2  researcher specifically resolves to Codex (AC2)
 *   RT-3  reviewer resolves to Claude Opus (AC3 cross-LLM gate)
 *   RT-4  Full §2.4 routing table — all 12 routed agents correct
 *   RT-5  security agent carries security-reviewer persona (name mismatch)
 *   RT-6  performance agent carries performance-reviewer persona (name mismatch)
 */

const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { test, before } = require('node:test');

const REPO_ROOT = path.resolve(__dirname, '..');

let reconcileAgents;
before(async () => {
  ({ reconcileAgents } = await import('../hive/lib/multica-bootstrap/index.mjs'));
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

async function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      try {
        await handler(req, res, body);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message ?? String(err) }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    server,
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'multica-routing-'));
}

/**
 * Write a routing-fixture agents.yaml to a temp dir.
 * Each agent entry uses provider/model from the §2.4 table.
 * persona_ref points to a single shared persona.md in the same dir.
 */
function writeRoutingFixture(dir, agents) {
  const personaPath = path.join(dir, 'persona.md');
  fs.writeFileSync(personaPath, 'agent persona instructions\n');

  const lines = ['schema_version: 1', 'agents:'];
  for (const { name, provider, model } of agents) {
    lines.push(
      `  - name: ${name}`,
      `    provider: ${provider}`,
      `    model: ${model}`,
      `    persona_ref: persona.md`,
      '',
    );
  }
  const configPath = path.join(dir, 'agents.yaml');
  fs.writeFileSync(configPath, lines.join('\n'));
  return configPath;
}

/** Mock server handler: two runtimes (codex + claude), no existing agents.
 *  body is pre-parsed by startMockServer and passed as the third argument. */
function makeRoutingHandler(workspaceId, createdBodies) {
  return (req, res, body) => {
    const runtimesUrl = `/api/runtimes?workspace_id=${encodeURIComponent(workspaceId)}`;
    const agentsUrl = `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`;

    if (req.url === runtimesUrl && req.method === 'GET') {
      sendJson(res, 200, [
        { id: 'runtime-codex', provider: 'codex' },
        { id: 'runtime-claude', provider: 'claude' },
      ]);
      return;
    }
    if (req.url === agentsUrl && req.method === 'GET') {
      sendJson(res, 200, []);
      return;
    }
    if (req.url === agentsUrl && req.method === 'POST') {
      createdBodies.push(body);
      sendJson(res, 201, { id: `${body.name}-id`, ...body });
      return;
    }
    sendJson(res, 500, { error: `unexpected request: ${req.method} ${req.url}` });
  };
}

// ---------------------------------------------------------------------------
// §2.4 routing table — all 12 explicitly routed agents
// ---------------------------------------------------------------------------

const CODEX_AGENTS = [
  { name: 'researcher', provider: 'codex', model: 'gpt-5.4' },
  { name: 'developer', provider: 'codex', model: 'gpt-5.4' },
  { name: 'backend-developer', provider: 'codex', model: 'gpt-5.4' },
  { name: 'frontend-developer', provider: 'codex', model: 'gpt-5.4' },
  { name: 'technical-writer', provider: 'codex', model: 'gpt-5.4' },
  { name: 'architect', provider: 'codex', model: 'gpt-5.4' },
];

const CLAUDE_SONNET_AGENTS = [
  { name: 'tester', provider: 'claude', model: 'claude-sonnet-4-6' },
  { name: 'qa-engineer', provider: 'claude', model: 'claude-sonnet-4-6' },
  { name: 'ui-designer', provider: 'claude', model: 'claude-sonnet-4-6' },
];

const CLAUDE_OPUS_AGENTS = [
  { name: 'reviewer', provider: 'claude', model: 'claude-opus-4-7' },
  { name: 'peer-validator', provider: 'claude', model: 'claude-opus-4-7' },
  { name: 'security', provider: 'claude', model: 'claude-opus-4-7' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('RT-1 Codex-tier agents all resolve to Codex runtime (researcher, developer, architect, technical-writer, backend-developer, frontend-developer)', async () => {
  const dir = tmpDir();
  const agentsConfigPath = writeRoutingFixture(dir, CODEX_AGENTS);
  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-1', createdBodies)(req, res, body);
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-1',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result.created.sort(), CODEX_AGENTS.map((a) => a.name).sort());
    assert.equal(result.patched.length, 0);

    for (const body of createdBodies) {
      assert.equal(
        body.runtime_id,
        'runtime-codex',
        `${body.name} should resolve to Codex runtime`,
      );
    }
  } finally {
    await close();
  }
});

test('RT-2 researcher specifically resolves to Codex runtime (AC2)', async () => {
  const dir = tmpDir();
  const agentsConfigPath = writeRoutingFixture(dir, [CODEX_AGENTS[0]]); // researcher only
  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-2', createdBodies)(req, res, body);
  });

  try {
    await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-2',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.equal(createdBodies.length, 1);
    assert.equal(createdBodies[0].name, 'researcher');
    assert.equal(createdBodies[0].runtime_id, 'runtime-codex');
  } finally {
    await close();
  }
});

test('RT-3 reviewer resolves to Claude runtime — cross-LLM gate (AC3)', async () => {
  const dir = tmpDir();
  const reviewer = CLAUDE_OPUS_AGENTS.find((a) => a.name === 'reviewer');
  const agentsConfigPath = writeRoutingFixture(dir, [reviewer]);
  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-3', createdBodies)(req, res, body);
  });

  try {
    await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-3',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.equal(createdBodies.length, 1);
    assert.equal(createdBodies[0].name, 'reviewer');
    assert.equal(createdBodies[0].runtime_id, 'runtime-claude');
    assert.equal(createdBodies[0].model, 'claude-opus-4-7');
  } finally {
    await close();
  }
});

test('RT-4 full §2.4 routing table — all 12 routed agents resolve to expected runtime', async () => {
  const dir = tmpDir();
  const allAgents = [...CODEX_AGENTS, ...CLAUDE_SONNET_AGENTS, ...CLAUDE_OPUS_AGENTS];
  const agentsConfigPath = writeRoutingFixture(dir, allAgents);
  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-4', createdBodies)(req, res, body);
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-4',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.equal(result.created.length, 12, 'All 12 routing-table agents should be created');

    const byName = Object.fromEntries(createdBodies.map((b) => [b.name, b]));

    for (const agent of CODEX_AGENTS) {
      assert.equal(byName[agent.name]?.runtime_id, 'runtime-codex', `${agent.name} → Codex`);
    }
    for (const agent of [...CLAUDE_SONNET_AGENTS, ...CLAUDE_OPUS_AGENTS]) {
      assert.equal(byName[agent.name]?.runtime_id, 'runtime-claude', `${agent.name} → Claude`);
    }
  } finally {
    await close();
  }
});

test('RT-5 name mismatch: security agent created with workspace name "security" (source: security-reviewer.md)', async () => {
  const dir = tmpDir();
  // security-reviewer.md is the source persona; workspace agent name is "security"
  const personaPath = path.join(dir, 'security-reviewer.md');
  fs.writeFileSync(personaPath, 'security reviewer persona\n');

  const configPath = path.join(dir, 'agents.yaml');
  fs.writeFileSync(
    configPath,
    [
      'schema_version: 1',
      'agents:',
      '  - name: security',
      '    provider: claude',
      '    model: claude-opus-4-7',
      '    persona_ref: security-reviewer.md',
      '',
    ].join('\n'),
  );

  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-5', createdBodies)(req, res, body);
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-5',
      agentsConfigPath: configPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result.created, ['security']);
    assert.equal(createdBodies[0].name, 'security');
    assert.equal(createdBodies[0].runtime_id, 'runtime-claude');
    assert.equal(createdBodies[0].instructions, 'security reviewer persona\n');
  } finally {
    await close();
  }
});

test('RT-6 name mismatch: performance agent created with workspace name "performance" (source: performance-reviewer.md)', async () => {
  const dir = tmpDir();
  const personaPath = path.join(dir, 'performance-reviewer.md');
  fs.writeFileSync(personaPath, 'performance reviewer persona\n');

  const configPath = path.join(dir, 'agents.yaml');
  fs.writeFileSync(
    configPath,
    [
      'schema_version: 1',
      'agents:',
      '  - name: performance',
      '    provider: claude',
      '    model: claude-sonnet-4-6',
      '    persona_ref: performance-reviewer.md',
      '',
    ].join('\n'),
  );

  const createdBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    makeRoutingHandler('ws-6', createdBodies)(req, res, body);
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'ws-6',
      agentsConfigPath: configPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result.created, ['performance']);
    assert.equal(createdBodies[0].name, 'performance');
    assert.equal(createdBodies[0].runtime_id, 'runtime-claude');
    assert.equal(createdBodies[0].instructions, 'performance reviewer persona\n');
  } finally {
    await close();
  }
});
