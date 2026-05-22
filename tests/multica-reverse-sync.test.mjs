import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run } from '../hive/scripts/multica-reverse-sync.mjs';

const TOKEN = 'mul_test';
const WORKSPACE_ID = 'ws-1';

// ---------------------------------------------------------------------------
// Mock Multica server
// ---------------------------------------------------------------------------

async function startMockMultica(issueStatuses = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401); res.end(JSON.stringify({ error: 'bad token' })); return;
    }

    const match = url.pathname.match(/^\/api\/issues\/([^/]+)$/);
    if (req.method === 'GET' && match) {
      const issueId = decodeURIComponent(match[1]);
      const status = issueStatuses[issueId];
      if (status === undefined) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'not found' })); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: issueId, status }));
      return;
    }

    res.writeHead(500); res.end(JSON.stringify({ error: `unexpected ${req.method} ${req.url}` }));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-reverse-sync-'));

  async function mkMarker(epicId, storyId, issueId, issueIdentifier) {
    const dir = path.join(root, '.pHive', 'episodes', epicId, storyId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, 'multica-run.yaml'),
      [
        '---',
        `mode: multica`,
        `status: queued`,
        `story_id: ${storyId}`,
        `epic: ${epicId}`,
        `workspace_id: ${WORKSPACE_ID}`,
        `issue_id: ${issueId}`,
        `issue_identifier: ${issueIdentifier}`,
      ].join('\n') + '\n',
    );
  }

  async function mkStory(epicId, storyId, status = 'pending', extra = '') {
    const dir = path.join(root, '.pHive', 'epics', epicId, 'stories');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, `${storyId}.yaml`),
      `id: ${storyId}\nepic: ${epicId}\nstatus: ${status}\n${extra}`,
    );
  }

  async function readStory(epicId, storyId) {
    return fs.readFile(
      path.join(root, '.pHive', 'epics', epicId, 'stories', `${storyId}.yaml`),
      'utf8',
    );
  }

  return { root, mkMarker, mkStory, readStory };
}

// ---------------------------------------------------------------------------
// Tests — one test per counter bucket and combined
// ---------------------------------------------------------------------------

test('checked bucket: non-cancelled issue increments checked only', async () => {
  const { root, mkMarker, mkStory } = await makeFixture();
  const mock = await startMockMultica({ 'issue-active': 'in_progress' });
  try {
    await mkMarker('epic-a', 'story-active', 'issue-active', 'PLU-10');
    await mkStory('epic-a', 'story-active', 'pending');

    const result = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });

    assert.equal(result.checked, 1);
    assert.equal(result.cancelled, 0);
    assert.equal(result.patched, 0);
    assert.equal(result.noops, 0);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('patched bucket: cancelled issue with pending story gets patched', async () => {
  const { root, mkMarker, mkStory, readStory } = await makeFixture();
  const mock = await startMockMultica({ 'issue-cancelled': 'cancelled' });
  try {
    await mkMarker('epic-b', 'story-pending', 'issue-cancelled', 'PLU-20');
    await mkStory('epic-b', 'story-pending', 'pending');

    const result = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });

    assert.equal(result.checked, 1);
    assert.equal(result.cancelled, 1);
    assert.equal(result.patched, 1);
    assert.equal(result.noops, 0);

    const yaml = await readStory('epic-b', 'story-pending');
    assert.match(yaml, /^status: deferred$/m);
    assert.match(yaml, /^deferred:$/m);
    assert.match(yaml, /source: multica-cancelled/);
    assert.match(yaml, /issue_identifier: PLU-20/);
    assert.match(yaml, /at: "\d{4}-\d{2}-\d{2}T/);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('no-op bucket: cancelled issue but story already deferred', async () => {
  const { root, mkMarker, mkStory } = await makeFixture();
  const mock = await startMockMultica({ 'issue-c': 'cancelled' });
  try {
    await mkMarker('epic-c', 'story-already', 'issue-c', 'PLU-30');
    await mkStory(
      'epic-c',
      'story-already',
      'deferred',
      'deferred:\n  at: "2026-01-01T00:00:00.000Z"\n  source: multica-cancelled\n  issue_identifier: PLU-30\n',
    );

    const result = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });

    assert.equal(result.checked, 1);
    assert.equal(result.cancelled, 1);
    assert.equal(result.patched, 0);
    assert.equal(result.noops, 1);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('no-op bucket: cancelled issue but story already completed', async () => {
  const { root, mkMarker, mkStory } = await makeFixture();
  const mock = await startMockMultica({ 'issue-d': 'cancelled' });
  try {
    await mkMarker('epic-d', 'story-done', 'issue-d', 'PLU-40');
    await mkStory('epic-d', 'story-done', 'completed');

    const result = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });

    assert.equal(result.checked, 1);
    assert.equal(result.cancelled, 1);
    assert.equal(result.patched, 0);
    assert.equal(result.noops, 1);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('all four buckets in one pass', async () => {
  const { root, mkMarker, mkStory, readStory } = await makeFixture();
  const mock = await startMockMultica({
    'issue-1': 'in_progress',   // checked only
    'issue-2': 'cancelled',     // patched
    'issue-3': 'cancelled',     // noop (already deferred)
    'issue-4': 'cancelled',     // noop (completed)
  });
  try {
    await mkMarker('epic-x', 's1-active',    'issue-1', 'PLU-1');
    await mkMarker('epic-x', 's2-cancelled', 'issue-2', 'PLU-2');
    await mkMarker('epic-x', 's3-deferred',  'issue-3', 'PLU-3');
    await mkMarker('epic-x', 's4-done',      'issue-4', 'PLU-4');

    await mkStory('epic-x', 's1-active',    'in_progress');
    await mkStory('epic-x', 's2-cancelled', 'pending');
    await mkStory(
      'epic-x',
      's3-deferred',
      'deferred',
      'deferred:\n  at: "2026-01-01T00:00:00.000Z"\n  source: multica-cancelled\n  issue_identifier: PLU-3\n',
    );
    await mkStory('epic-x', 's4-done', 'completed');

    const result = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });

    assert.equal(result.checked, 4, 'checked');
    assert.equal(result.cancelled, 3, 'cancelled');
    assert.equal(result.patched, 1, 'patched');
    assert.equal(result.noops, 2, 'noops');

    const patchedYaml = await readStory('epic-x', 's2-cancelled');
    assert.match(patchedYaml, /^status: deferred$/m);
    assert.match(patchedYaml, /source: multica-cancelled/);
    assert.match(patchedYaml, /issue_identifier: PLU-2/);
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('idempotent: re-running on already-patched story is a no-op', async () => {
  const { root, mkMarker, mkStory, readStory } = await makeFixture();
  const mock = await startMockMultica({ 'issue-idem': 'cancelled' });
  try {
    await mkMarker('epic-e', 'story-idem', 'issue-idem', 'PLU-50');
    await mkStory('epic-e', 'story-idem', 'pending');

    const first = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });
    assert.equal(first.patched, 1);

    const second = await run({ repoRoot: root, serverUrl: mock.serverUrl, token: TOKEN });
    assert.equal(second.patched, 0, 'second run patches nothing');
    assert.equal(second.noops, 1, 'second run counts as no-op');

    const yaml = await readStory('epic-e', 'story-idem');
    const deferredCount = (yaml.match(/^deferred:/gm) || []).length;
    assert.equal(deferredCount, 1, 'deferred block appears exactly once');
  } finally {
    await mock.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
