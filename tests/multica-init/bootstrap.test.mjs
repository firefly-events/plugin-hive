import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkHealth,
  ensureAuth,
  ensureCli,
  reconcileAgents,
} from '../../hive/lib/multica-bootstrap/index.mjs';

async function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
      try {
        await handler(req, res, body);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error?.message ?? String(error) }));
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'multica-bootstrap-'));
}

function writeAgentFixture(dir, agentsYaml, instruction = 'developer instructions') {
  const personaPath = path.join(dir, 'persona.md');
  const configPath = path.join(dir, 'agents.yaml');
  fs.writeFileSync(personaPath, `${instruction}\n`);
  fs.writeFileSync(
    configPath,
    agentsYaml.replaceAll('__PERSONA__', 'persona.md'),
  );
  return configPath;
}

function agentYaml(names) {
  return `schema_version: 1
agents:
${names
  .map(
    (name) => `  - name: ${name}
    provider: claude
    model: claude-sonnet-4-6
    persona_ref: __PERSONA__
`,
  )
  .join('')}`;
}

function desiredExisting(name, overrides = {}) {
  return {
    id: `${name}-id`,
    name,
    runtime_id: 'runtime-claude',
    instructions: 'developer instructions\n',
    model: 'claude-sonnet-4-6',
    visibility: 'workspace',
    max_concurrent_tasks: 1,
    custom_env: {},
    custom_args: [],
    mcp_config: {},
    skills: [],
    ...overrides,
  };
}

test('AC1 server-not-running: checkHealth throws structured transport error', async () => {
  await assert.rejects(
    () => checkHealth({ serverUrl: 'http://127.0.0.1:9' }),
    (error) =>
      error.code === 'TRANSPORT' &&
      typeof error.message === 'string' &&
      typeof error.hint === 'string',
  );
});

test('AC2 CLI-missing: ensureCli requires consent before brew install', async (t) => {
  const calls = [];
  t.mock.method(childProcess, 'execSync', (command) => {
    calls.push(command);
    throw new Error('not found');
  });

  await assert.rejects(
    () => ensureCli({ consent: false }),
    (error) => error.code === 'CONSENT_REQUIRED',
  );
  assert.deepEqual(calls, ['multica --version']);
});

test('AC3 auth-flow: ensureAuth mints PAT and persists tmp config only', async () => {
  const dir = tmpDir();
  const configPath = path.join(dir, 'config.json');
  const calls = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    calls.push({ method: req.method, url: req.url, body });
    if (req.url === '/auth/send-code' && req.method === 'POST') {
      assert.deepEqual(body, { email: 'user@example.com' });
      sendJson(res, 200, { message: 'Verification code sent' });
      return;
    }
    if (req.url === '/auth/verify-code' && req.method === 'POST') {
      assert.deepEqual(body, { email: 'user@example.com', code: '123456' });
      sendJson(res, 200, { token: 'jwt-session', user: { email: 'user@example.com' } });
      return;
    }
    if (req.url === '/api/tokens' && req.method === 'POST') {
      assert.equal(req.headers.authorization, 'Bearer jwt-session');
      sendJson(res, 201, {
        id: 'token-id',
        name: 'hive-bootstrap',
        token_prefix: 'mul_secret',
        token: 'mul_secretfullvalue',
      });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  try {
    const prompts = ['user@example.com', '123456'];
    const result = await ensureAuth({
      serverUrl,
      configPath,
      consent: true,
      promptFn: async () => prompts.shift(),
    });

    assert.deepEqual(result, { tokenSource: 'minted' });
    assert.equal(calls.filter((call) => call.url === '/api/tokens').length, 1);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(config.token, 'mul_secretfullvalue');
    assert.equal(config.server_url, serverUrl);
    assert.ok(!fs.existsSync(path.join(os.homedir(), '.multica', 'config.json.backup-from-test')));
  } finally {
    await close();
  }
});

test('AC4 full idempotency: reconcileAgents skips matching agents with zero POST/PUT', async () => {
  const dir = tmpDir();
  const agentsConfigPath = writeAgentFixture(dir, agentYaml(['developer']));
  const counts = { post: 0, put: 0 };
  const { serverUrl, close } = await startMockServer((req, res) => {
    if (req.url === '/api/runtimes?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [{ id: 'runtime-claude', provider: 'claude' }]);
      return;
    }
    if (req.url === '/api/agents?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [desiredExisting('developer')]);
      return;
    }
    if (req.url.startsWith('/api/agents') && req.method === 'POST') counts.post += 1;
    if (req.url.startsWith('/api/agents') && req.method === 'PUT') counts.put += 1;
    sendJson(res, 500, { error: 'unexpected mutation' });
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'workspace-1',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result, { created: [], patched: [], skipped: ['developer'] });
    assert.equal(counts.post, 0);
    assert.equal(counts.put, 0);
  } finally {
    await close();
  }
});

test('AC5 partial agents: reconcileAgents creates missing and does not PUT existing', async () => {
  const dir = tmpDir();
  const agentsConfigPath = writeAgentFixture(dir, agentYaml(['developer', 'tester']));
  const createdBodies = [];
  let putCount = 0;
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.url === '/api/runtimes?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [{ id: 'runtime-claude', provider: 'claude' }]);
      return;
    }
    if (req.url === '/api/agents?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [desiredExisting('developer')]);
      return;
    }
    if (req.url === '/api/agents?workspace_id=workspace-1' && req.method === 'POST') {
      createdBodies.push(body);
      sendJson(res, 201, { id: 'tester-id', ...body });
      return;
    }
    if (req.url.startsWith('/api/agents') && req.method === 'PUT') putCount += 1;
    sendJson(res, 500, { error: 'unexpected request' });
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'workspace-1',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result, { created: ['tester'], patched: [], skipped: ['developer'] });
    assert.equal(createdBodies.length, 1);
    assert.equal(createdBodies[0].name, 'tester');
    assert.equal(createdBodies[0].runtime_id, 'runtime-claude');
    assert.equal(putCount, 0);
  } finally {
    await close();
  }
});

test('AC6 agent drift patch: reconcileAgents PUTs corrected custom_env', async () => {
  const dir = tmpDir();
  const agentsConfigPath = writeAgentFixture(dir, agentYaml(['developer']));
  const putBodies = [];
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.url === '/api/runtimes?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [{ id: 'runtime-claude', provider: 'claude' }]);
      return;
    }
    if (req.url === '/api/agents?workspace_id=workspace-1' && req.method === 'GET') {
      sendJson(res, 200, [desiredExisting('developer', { custom_env: { STALE: '1' } })]);
      return;
    }
    if (req.url === '/api/agents/developer-id?workspace_id=workspace-1' && req.method === 'PUT') {
      putBodies.push(body);
      sendJson(res, 200, { id: 'developer-id', ...body });
      return;
    }
    sendJson(res, 500, { error: 'unexpected request' });
  });

  try {
    const result = await reconcileAgents({
      serverUrl,
      token: 'mul_test',
      workspaceId: 'workspace-1',
      agentsConfigPath,
      repoRoot: dir,
      consent: true,
    });

    assert.deepEqual(result, { created: [], patched: ['developer'], skipped: [] });
    assert.equal(putBodies.length, 1);
    assert.deepEqual(putBodies[0].custom_env, {});
    assert.equal(putBodies[0].instructions, 'developer instructions\n');
    assert.equal(putBodies[0].runtime_id, 'runtime-claude');
  } finally {
    await close();
  }
});
