import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeStoryIssue, closeStoryIssues } from '../../hive/lib/multica-issue-closer.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'closer-test-'));
}

function writeMarker(dir, epic, story, fields = {}) {
  const markerDir = path.join(dir, '.pHive', 'episodes', epic, story);
  fs.mkdirSync(markerDir, { recursive: true });
  const content = [
    'mode: multica',
    `issue_id: ${fields.issue_id ?? 'test-issue-uuid'}`,
    `assignee_id: ${fields.assignee_id ?? 'agent-uuid-abc'}`,
    `epic: ${epic}`,
    `story_id: ${story}`,
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(markerDir, 'multica-run.yaml'), content, 'utf8');
}

function writeConfig(dir, fields = {}) {
  const cfgDir = path.join(dir, '.multica');
  fs.mkdirSync(cfgDir, { recursive: true });
  const cfg = {
    token: fields.token ?? 'test-token',
    server_url: fields.server_url ?? 'http://127.0.0.1:9999',
    workspace_id: fields.workspace_id ?? 'wsp-uuid',
  };
  fs.writeFileSync(path.join(cfgDir, 'config.json'), JSON.stringify(cfg), 'utf8');
  return path.join(cfgDir, 'config.json');
}

async function startMockServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const body = rawBody ? JSON.parse(rawBody) : null;
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
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('marker-absent: returns {ok: false, reason: "no_marker"}', async () => {
  const dir = makeTmpDir();
  const result = await closeStoryIssue({
    epic_id: 'my-epic',
    story_id: 's-1',
    repo_root: dir,
    config_path: path.join(dir, 'nonexistent.json'),
  });
  assert.deepEqual(result, { ok: false, reason: 'no_marker' });
});

test('no-auth: returns {ok: false, reason: "no_auth"} and does not throw', async () => {
  const dir = makeTmpDir();
  writeMarker(dir, 'my-epic', 's-1');
  const result = await closeStoryIssue({
    epic_id: 'my-epic',
    story_id: 's-1',
    repo_root: dir,
    config_path: path.join(dir, 'nonexistent.json'),
  });
  assert.deepEqual(result, { ok: false, reason: 'no_auth' });
});

test('already-done: returns {ok: true, was_changed: false, reason: "already_done"}', async () => {
  const dir = makeTmpDir();
  const mock = await startMockServer((req, res) => {
    sendJson(res, 200, { id: 'test-issue-uuid', status: 'done', assignee_id: 'agent-uuid-abc' });
  });
  try {
    writeMarker(dir, 'epic-a', 's-2', { issue_id: 'test-issue-uuid', assignee_id: 'agent-uuid-abc' });
    const cfgPath = writeConfig(dir, { server_url: mock.url, workspace_id: 'wsp-1' });
    const result = await closeStoryIssue({
      epic_id: 'epic-a',
      story_id: 's-2',
      repo_root: dir,
      config_path: cfgPath,
    });
    assert.deepEqual(result, { ok: true, was_changed: false, reason: 'already_done' });
  } finally {
    await mock.close();
  }
});

test('cancelled: returns {ok: true, was_changed: false, reason: "cancelled"} and never PUTs', async () => {
  const dir = makeTmpDir();
  let putCalled = false;
  const mock = await startMockServer((req, res) => {
    if (req.method === 'PUT') putCalled = true;
    sendJson(res, 200, { id: 'test-issue-uuid', status: 'cancelled', assignee_id: 'agent-uuid-abc' });
  });
  try {
    writeMarker(dir, 'epic-b', 's-3', { issue_id: 'test-issue-uuid', assignee_id: 'agent-uuid-abc' });
    const cfgPath = writeConfig(dir, { server_url: mock.url, workspace_id: 'wsp-1' });
    const result = await closeStoryIssue({
      epic_id: 'epic-b',
      story_id: 's-3',
      repo_root: dir,
      config_path: cfgPath,
    });
    assert.deepEqual(result, { ok: true, was_changed: false, reason: 'cancelled' });
    assert.equal(putCalled, false, 'must not PUT a cancelled issue');
  } finally {
    await mock.close();
  }
});

test('happy-path: PUTs done and returns {ok: true, was_changed: true, prior_status}', async () => {
  const dir = makeTmpDir();
  const requests = [];
  const mock = await startMockServer((req, res, body) => {
    requests.push({ method: req.method, url: req.url, body });
    if (req.method === 'GET') {
      sendJson(res, 200, { id: 'test-issue-uuid', status: 'in_review', assignee_id: 'agent-uuid-abc' });
    } else {
      sendJson(res, 200, { id: 'test-issue-uuid', status: 'done' });
    }
  });
  try {
    writeMarker(dir, 'epic-c', 's-4', { issue_id: 'test-issue-uuid', assignee_id: 'agent-uuid-abc' });
    const cfgPath = writeConfig(dir, { server_url: mock.url, workspace_id: 'wsp-1' });
    const result = await closeStoryIssue({
      epic_id: 'epic-c',
      story_id: 's-4',
      repo_root: dir,
      config_path: cfgPath,
    });
    assert.deepEqual(result, { ok: true, was_changed: true, prior_status: 'in_review' });
    const put = requests.find((r) => r.method === 'PUT');
    assert.ok(put, 'should have issued a PUT');
    assert.deepEqual(put.body, { status: 'done' });
  } finally {
    await mock.close();
  }
});

test('transport-error: returns {ok: false, reason: "transport_error"} without throwing', async () => {
  const dir = makeTmpDir();
  // Point to a port nothing is listening on
  writeMarker(dir, 'epic-d', 's-5', { issue_id: 'test-issue-uuid' });
  const cfgPath = writeConfig(dir, { server_url: 'http://127.0.0.1:1', workspace_id: 'wsp-1' });
  const result = await closeStoryIssue({
    epic_id: 'epic-d',
    story_id: 's-5',
    repo_root: dir,
    config_path: cfgPath,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'transport_error');
  assert.ok(typeof result.error === 'string');
});

test('agent-drift: skips close when assignee_id changed', async () => {
  const dir = makeTmpDir();
  let putCalled = false;
  const mock = await startMockServer((req, res) => {
    if (req.method === 'PUT') putCalled = true;
    sendJson(res, 200, { id: 'test-issue-uuid', status: 'in_progress', assignee_id: 'different-agent' });
  });
  try {
    writeMarker(dir, 'epic-e', 's-6', { issue_id: 'test-issue-uuid', assignee_id: 'agent-uuid-abc' });
    const cfgPath = writeConfig(dir, { server_url: mock.url, workspace_id: 'wsp-1' });
    const result = await closeStoryIssue({
      epic_id: 'epic-e',
      story_id: 's-6',
      repo_root: dir,
      config_path: cfgPath,
    });
    assert.deepEqual(result, { ok: false, reason: 'agent_drift' });
    assert.equal(putCalled, false);
  } finally {
    await mock.close();
  }
});

test('closeStoryIssues bulk: returns closed/skipped/errors buckets', async () => {
  const dir = makeTmpDir();
  const mock = await startMockServer((req, res) => {
    if (req.url?.includes('done-issue')) {
      sendJson(res, 200, { id: 'done-issue', status: 'done', assignee_id: 'a' });
    } else {
      sendJson(res, 200, { id: 'open-issue', status: 'in_progress', assignee_id: 'a' });
    }
  });
  try {
    writeMarker(dir, 'bulk-epic', 'story-done', { issue_id: 'done-issue', assignee_id: 'a' });
    writeMarker(dir, 'bulk-epic', 'story-open', { issue_id: 'open-issue', assignee_id: 'a' });
    // story-missing has no marker
    const cfgPath = writeConfig(dir, { server_url: mock.url, workspace_id: 'wsp-1' });

    const result = await closeStoryIssues([
      { epic_id: 'bulk-epic', story_id: 'story-done', repo_root: dir, config_path: cfgPath },
      { epic_id: 'bulk-epic', story_id: 'story-open', repo_root: dir, config_path: cfgPath },
      { epic_id: 'bulk-epic', story_id: 'story-missing', repo_root: dir, config_path: cfgPath },
    ]);

    assert.equal(result.closed.length, 1, 'one story actually closed (was open)');
    assert.equal(result.skipped.length, 2, 'already-done + no-marker go to skipped');
    assert.equal(result.errors.length, 0);
    assert.equal(result.closed[0].story_id, 'story-open');
  } finally {
    await mock.close();
  }
});
