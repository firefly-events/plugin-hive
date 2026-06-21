/**
 * Unit tests for s5-multica-bridge: create-issue + reconcile subcommands.
 * Uses a real HTTP mock server (node:http) and a real temp git repo.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const execAsync = promisify(execFile);
const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url));

// ── Mock HTTP server ─────────────────────────────────────────────────────────

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
    serverUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── CLI runner ───────────────────────────────────────────────────────────────

async function runCli(argv, { serverUrl, cwd } = {}) {
  const env = {
    ...process.env,
    MULTICA_SERVER_URL: serverUrl ?? 'http://127.0.0.1:1',
    MULTICA_TOKEN: 'test-token',
    MULTICA_WORKSPACE_ID: 'test-ws',
  };
  return execAsync('node', [CLI, ...argv], { env, cwd: cwd ?? process.cwd() });
}

async function runCliExpectFail(argv, opts) {
  try {
    await runCli(argv, opts);
    throw new Error('expected CLI to exit non-zero but it succeeded');
  } catch (err) {
    if (err.message === 'expected CLI to exit non-zero but it succeeded') throw err;
    return err;
  }
}

// ── create-issue tests ───────────────────────────────────────────────────────

test('create-issue: success prints {id,url,...} JSON to stdout', async () => {
  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.method === 'POST' && req.url === '/api/issues?workspace_id=test-ws') {
      assert.equal(body.title, 'My task');
      assert.equal(body.description, 'step_file_content here');
      sendJson(res, 201, { id: 'new-issue-uuid', url: 'https://example.com/i/new-issue-uuid', status: 'todo' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  try {
    const { stdout, stderr } = await runCli(
      ['create-issue', '--title', 'My task', '--body', 'step_file_content here'],
      { serverUrl },
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.id, 'new-issue-uuid');
    assert.equal(result.url, 'https://example.com/i/new-issue-uuid');
    assert.equal(stderr, '');
  } finally {
    await close();
  }
});

test('create-issue: API error prints {code,message} to stderr and exits 1', async () => {
  const { serverUrl, close } = await startMockServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/issues?workspace_id=test-ws') {
      sendJson(res, 422, { message: 'title is required' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  try {
    const err = await runCliExpectFail(
      ['create-issue', '--title', 'x', '--body', 'y'],
      { serverUrl },
    );
    assert.equal(err.code, 1);
    const result = JSON.parse(err.stderr.trim());
    assert.ok(result.code, 'stderr must have code field');
    assert.ok(result.message, 'stderr must have message field');
  } finally {
    await close();
  }
});

test('create-issue: missing --title fails with MISSING_ARG', async () => {
  const err = await runCliExpectFail(['create-issue', '--body', 'desc']);
  assert.equal(err.code, 1);
  const result = JSON.parse(err.stderr.trim());
  assert.equal(result.code, 'MISSING_ARG');
});

test('create-issue: missing --body fails with MISSING_ARG', async () => {
  const err = await runCliExpectFail(['create-issue', '--title', 'x']);
  assert.equal(err.code, 1);
  const result = JSON.parse(err.stderr.trim());
  assert.equal(result.code, 'MISSING_ARG');
});

test('create-issue: --dedup-title returns existing issue without POSTing a new one', async () => {
  let postCount = 0;
  const existingIssue = { id: 'existing-uuid', url: 'https://example.com/i/existing-uuid', title: '[dag:run1:stepA] developer', status: 'todo' };

  const { serverUrl, close } = await startMockServer((req, res, body) => {
    if (req.method === 'GET' && req.url.startsWith('/api/issues')) {
      // Return a list containing an issue whose title matches the dedup key.
      sendJson(res, 200, [existingIssue]);
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/api/issues')) {
      postCount++;
      sendJson(res, 201, { id: 'new-uuid', url: 'https://example.com/i/new-uuid' });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  try {
    const { stdout } = await runCli(
      ['create-issue', '--title', '[dag:run1:stepA] developer', '--body', 'brief', '--dedup-title', '[dag:run1:stepA] developer'],
      { serverUrl },
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.id, 'existing-uuid', 'must return existing issue id, not create a new one');
    assert.equal(postCount, 0, 'must NOT POST a new issue when dedup match found');
  } finally {
    await close();
  }
});

// ── reconcile tests ──────────────────────────────────────────────────────────

async function setupGitFixture() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-reconcile-test-'));

  // Bare repo acts as "remote"
  const bareDir = path.join(tmpDir, 'bare.git');
  await execAsync('git', ['init', '--bare', bareDir]);

  // Working repo cloned from bare
  const workDir = path.join(tmpDir, 'work');
  await execAsync('git', ['clone', bareDir, workDir]);

  // Configure identity for commits
  await execAsync('git', ['-C', workDir, 'config', 'user.email', 'test@test.com']);
  await execAsync('git', ['-C', workDir, 'config', 'user.name', 'Test']);

  // Create initial commit on main branch in work dir and push
  await fs.writeFile(path.join(workDir, 'README.md'), 'init\n');
  await execAsync('git', ['-C', workDir, 'add', 'README.md']);
  await execAsync('git', ['-C', workDir, 'commit', '-m', 'init']);
  await execAsync('git', ['-C', workDir, 'push', 'origin', 'HEAD:main']);

  // Get the base sha
  const { stdout: baseSha } = await execAsync('git', ['-C', workDir, 'rev-parse', 'HEAD']);

  // Create agent branch with one extra commit (simulates agent push)
  const agentDir = path.join(tmpDir, 'agent');
  await execAsync('git', ['clone', bareDir, agentDir]);
  await execAsync('git', ['-C', agentDir, 'config', 'user.email', 'test@test.com']);
  await execAsync('git', ['-C', agentDir, 'config', 'user.name', 'Test']);
  await execAsync('git', ['-C', agentDir, 'checkout', '-b', 'agent/developer/run1']);
  await fs.writeFile(path.join(agentDir, 'feature.js'), 'export const x = 1;\n');
  await execAsync('git', ['-C', agentDir, 'add', 'feature.js']);
  await execAsync('git', ['-C', agentDir, 'commit', '-m', 'feat: agent work']);
  await execAsync('git', ['-C', agentDir, 'push', 'origin', 'agent/developer/run1']);
  const { stdout: agentSha } = await execAsync('git', ['-C', agentDir, 'rev-parse', 'HEAD']);

  return { tmpDir, bareDir, workDir, agentDir, baseSha: baseSha.trim(), agentSha: agentSha.trim() };
}

test('reconcile: ff-merge succeeds and returns {merged:true,sha}', async () => {
  const { tmpDir, bareDir, workDir, agentSha } = await setupGitFixture();
  try {
    const { stdout, stderr } = await runCli(
      ['reconcile', '--repo', bareDir, '--branch', 'agent/developer/run1', '--sha', agentSha, '--work-dir', workDir],
    );
    const result = JSON.parse(stdout.trim());
    assert.equal(result.merged, true);
    assert.equal(result.sha, agentSha);
    assert.equal(stderr, '');

    // Verify HEAD advanced to agent sha
    const { stdout: headSha } = await execAsync('git', ['-C', workDir, 'rev-parse', 'HEAD']);
    assert.equal(headSha.trim(), agentSha);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('reconcile: non-ff situation fails with NON_FF code', async () => {
  const { tmpDir, bareDir, workDir, baseSha } = await setupGitFixture();
  try {
    // Create a diverging commit in workDir so agent sha can't ff-merge
    await execAsync('git', ['-C', workDir, 'config', 'user.email', 'test@test.com']);
    await execAsync('git', ['-C', workDir, 'config', 'user.name', 'Test']);
    await fs.writeFile(path.join(workDir, 'local.txt'), 'local diverge\n');
    await execAsync('git', ['-C', workDir, 'add', 'local.txt']);
    await execAsync('git', ['-C', workDir, 'commit', '-m', 'local: diverge']);

    // Now try to ff-merge the agent branch sha (which branched from baseSha, not from the local diverge commit)
    // We need agent sha — fetch it first
    const agentDir = path.join(tmpDir, 'agent');
    const { stdout: agentSha } = await execAsync('git', ['-C', agentDir, 'rev-parse', 'HEAD']);

    const err = await runCliExpectFail(
      ['reconcile', '--repo', bareDir, '--branch', 'agent/developer/run1', '--sha', agentSha.trim(), '--work-dir', workDir],
    );
    assert.equal(err.code, 1);
    const result = JSON.parse(err.stderr.trim());
    assert.equal(result.code, 'NON_FF');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('reconcile: missing --repo fails with MISSING_ARG', async () => {
  const err = await runCliExpectFail(['reconcile', '--branch', 'b', '--sha', 'abc123']);
  const result = JSON.parse(err.stderr.trim());
  assert.equal(result.code, 'MISSING_ARG');
});

test('reconcile: missing --branch fails with MISSING_ARG', async () => {
  const err = await runCliExpectFail(['reconcile', '--repo', '/tmp/x', '--sha', 'abc123']);
  const result = JSON.parse(err.stderr.trim());
  assert.equal(result.code, 'MISSING_ARG');
});

test('reconcile: missing --sha fails with MISSING_ARG', async () => {
  const err = await runCliExpectFail(['reconcile', '--repo', '/tmp/x', '--branch', 'b']);
  const result = JSON.parse(err.stderr.trim());
  assert.equal(result.code, 'MISSING_ARG');
});

test('reconcile: sha present as git object but not reachable from FETCH_HEAD fails with SHA_NOT_FOUND', async () => {
  // M1 regression test: old code used `git cat-file -e` which only proves the object
  // exists locally (passes even for stale objects from a prior fetch of a different
  // branch). New code uses `git merge-base --is-ancestor sha FETCH_HEAD` which proves
  // the sha is actually reachable from the branch we just fetched.
  //
  // Setup: fetch agent branch so agentSha is in the object DB, then call reconcile
  // with --branch main so FETCH_HEAD = baseSha. agentSha is NOT an ancestor of baseSha
  // (it's a descendant), so the reachability check must fail with SHA_NOT_FOUND.
  const { tmpDir, bareDir, workDir, agentSha } = await setupGitFixture();
  try {
    // Pre-fetch agent branch: agentSha now lives in workDir's object store.
    await execAsync('git', ['-C', workDir, 'fetch', bareDir, 'agent/developer/run1']);

    // Reconcile with --branch main (FETCH_HEAD will be baseSha after the fetch).
    // agentSha is ahead of baseSha, so it is NOT an ancestor of FETCH_HEAD(=baseSha).
    // Old cat-file -e would pass (object exists); new merge-base check must fail.
    const err = await runCliExpectFail([
      'reconcile',
      '--repo', bareDir,
      '--branch', 'main',
      '--sha', agentSha,
      '--work-dir', workDir,
    ]);
    assert.equal(err.code, 1);
    const result = JSON.parse(err.stderr.trim());
    assert.equal(result.code, 'SHA_NOT_FOUND');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
