'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..', '..');
const WRAPPER_PATH = path.join(ROOT, 'hive', 'lib', 'chromadb-wrapper.js');

function clearWrapper() {
  delete require.cache[require.resolve(WRAPPER_PATH)];
}

function loadWrapper() {
  clearWrapper();
  return require(WRAPPER_PATH);
}

async function withPatchedReadFileSync(patch, fn) {
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(...args) {
    return patch(originalReadFileSync, ...args);
  };
  try {
    return await fn();
  } finally {
    fs.readFileSync = originalReadFileSync;
    clearWrapper();
  }
}

async function withMutedWarn(fn) {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = originalWarn;
  }
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function getUnusedPort() {
  const { server, port } = await startServer((_req, res) => res.end());
  await stopServer(server);
  return port;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
  });
}

test('readDynamicPort parses port from fixture file', async () => {
  await withPatchedReadFileSync((originalReadFileSync, filePath, ...args) => {
    if (String(filePath).endsWith(path.join('.claude', 'hive', 'chromadb.port'))) {
      return '49152\n';
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  }, async () => {
    const wrapper = loadWrapper();
    assert.equal(wrapper.readDynamicPort(), 49152);
  });
});

test('readDynamicPort falls back to 8000 when file absent', async () => {
  await withPatchedReadFileSync((originalReadFileSync, filePath, ...args) => {
    if (String(filePath).endsWith(path.join('.claude', 'hive', 'chromadb.port'))) {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  }, async () => {
    const wrapper = loadWrapper();
    assert.equal(wrapper.readDynamicPort(), 8000);
  });
});

test('readDynamicPort falls back to 8000 when file content malformed', async () => {
  await withPatchedReadFileSync((originalReadFileSync, filePath, ...args) => {
    if (String(filePath).endsWith(path.join('.claude', 'hive', 'chromadb.port'))) {
      return 'not-a-port\n';
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  }, async () => {
    const wrapper = loadWrapper();
    assert.equal(wrapper.readDynamicPort(), 8000);
  });
});

test('ensureDecisionsCollection POSTs to correct path and body shape', async () => {
  const requests = [];
  const { server, port } = await startServer(async (req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      body: await readBody(req),
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: 'decisions' }));
  });

  try {
    const wrapper = loadWrapper();
    const result = await wrapper.ensureDecisionsCollection('127.0.0.1', port);

    assert.equal(result, true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/v1/collections');
    assert.deepEqual(JSON.parse(requests[0].body), {
      name: 'decisions',
      get_or_create: true,
    });
  } finally {
    await stopServer(server);
    clearWrapper();
  }
});

test('bootstrap is idempotent across isAvailable calls', async () => {
  let bootstrapPosts = 0;
  const { server, port } = await startServer(async (req, res) => {
    if (req.url === '/api/v1/heartbeat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ heartbeat: Date.now() }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/collections') {
      bootstrapPosts += 1;
      await readBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'decisions' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const wrapper = loadWrapper();

    assert.equal(await wrapper.isAvailable('127.0.0.1', port), true);
    assert.equal(await wrapper.isAvailable('127.0.0.1', port), true);
    assert.equal(bootstrapPosts, 1);
  } finally {
    await stopServer(server);
    clearWrapper();
  }
});

test('degraded heartbeat path does not bootstrap', async () => {
  let bootstrapPosts = 0;
  const { server, port } = await startServer(async (req, res) => {
    if (req.url === '/api/v1/heartbeat') {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'down' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/collections') {
      bootstrapPosts += 1;
      await readBody(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: 'decisions' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const wrapper = loadWrapper();

    assert.equal(await wrapper.isAvailable('127.0.0.1', port), false);
    assert.equal(bootstrapPosts, 0);
  } finally {
    await stopServer(server);
    clearWrapper();
  }
});

test('sample document write and similarity query roundtrip', async () => {
  const documents = new Map();
  const { server, port } = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/collections/decisions/upsert') {
      const body = JSON.parse(await readBody(req));
      documents.set(body.ids[0], body.documents[0]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v1/collections/decisions/query') {
      await readBody(req);
      const ids = Array.from(documents.keys());
      const docs = ids.map((id) => documents.get(id));
      const metas = ids.map(() => ({
        predicate: 'phase_failed',
        source_epic: 'kg-signal-revival',
        source_agent: 'tester',
        valid_from: '2026-05-14T00:00:00.000Z'
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ids: [ids], documents: [docs], distances: [[0.01]], metadatas: [metas] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  try {
    const wrapper = loadWrapper();

    assert.equal(
      await wrapper.index(
        'decisions',
        'decision:kg-signal-revival:phase_failed:story:test:2026-05-14',
        'Phase failed because tests did not pass.',
        { predicate: 'phase_failed', source_epic: 'kg-signal-revival', source_agent: 'tester', valid_from: '2026-05-14T00:00:00.000Z' },
        '127.0.0.1',
        port
      ),
      true
    );
    assert.deepEqual(await wrapper.query('decisions', 'tests failed', 1, '127.0.0.1', port), [
      {
        id: 'decision:kg-signal-revival:phase_failed:story:test:2026-05-14',
        document: 'Phase failed because tests did not pass.',
        distance: 0.01,
        metadata: {
          predicate: 'phase_failed',
          source_epic: 'kg-signal-revival',
          source_agent: 'tester',
          valid_from: '2026-05-14T00:00:00.000Z',
        },
      },
    ]);
  } finally {
    await stopServer(server);
    clearWrapper();
  }
});

test('sidecar-down calls degrade gracefully without throwing', async () => {
  const port = await getUnusedPort();
  const wrapper = loadWrapper();

  await withMutedWarn(async () => {
    assert.equal(await wrapper.isAvailable('127.0.0.1', port), false);
    assert.deepEqual(await wrapper.query('decisions', 'anything', 5, '127.0.0.1', port), []);
    assert.equal(await wrapper.index('decisions', 'id', 'content', {}, '127.0.0.1', port), false);
  });
});
