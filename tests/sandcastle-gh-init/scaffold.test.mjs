'use strict';

/**
 * Fixture tests for skills/hive/skills/sandcastle-gh-init/scaffold.mjs
 *
 * Story: s2-init-skill (sandcastle-gh-issue-dispatch).
 * Run:   node --test tests/sandcastle-gh-init/scaffold.test.mjs
 *
 * Each test sets up a tmp directory with whatever prereq state it wants
 * (with or without `.sandcastle/Dockerfile`, with or without an existing
 * manifest, with or without `gh` available) and invokes scaffold.mjs as a
 * subprocess via HIVE_GH_BIN/HIVE_GIT_BIN overrides.
 *
 * The fake-gh binary is rebuilt per-fixture so each test controls the
 * label-list output and the `gh auth status` exit code independently.
 *
 * NOTE: the story spec called for `bun test`, but the rest of the repo
 * (including s1's tests/sandcastle-gh-init-assets.test.js) runs on the
 * node-builtin test runner. Keeping the same runner here for consistency.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAFFOLD = path.join(
  REPO_ROOT,
  'skills',
  'hive',
  'skills',
  'sandcastle-gh-init',
  'scaffold.mjs',
);

const ALL_LABELS = [
  'hive:ready',
  'hive:in-flight',
  'hive:shipped',
  'hive:failed',
];

const MANAGED = [
  '.github/workflows/hive-dispatch.yml',
  '.github/scripts/sandcastle-hive-bridge.mts',
  '.hive-dispatch/manifest.yaml',
];

let tmpCounter = 0;
function makeTmpDir(label) {
  tmpCounter += 1;
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `sandcastle-gh-init-${label}-${tmpCounter}-`),
  );
  return dir;
}

function seedRepo(cwd, { withDockerfile = true } = {}) {
  if (withDockerfile) {
    fs.mkdirSync(path.join(cwd, '.sandcastle'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.sandcastle', 'Dockerfile'),
      'FROM node:22\n',
    );
  }
  execFileSync('git', ['init', '--initial-branch=main'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd });
  fs.writeFileSync(path.join(cwd, '.gitignore'), 'node_modules/\n');
  execFileSync('git', ['add', '.gitignore'], { cwd });
  execFileSync('git', ['commit', '-m', 'init'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeFakeGh(
  binDir,
  {
    authOk = true,
    labels = ALL_LABELS,
    labelListExitCode = 0,
  } = {},
) {
  fs.mkdirSync(binDir, { recursive: true });
  const labelsJson = JSON.stringify(labels.map((name) => ({ name })));
  const script =
    '#!/usr/bin/env bash\n' +
    'set -e\n' +
    'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then\n' +
    `  if [ "${authOk ? '1' : '0'}" = "1" ]; then\n` +
    '    echo "logged in"\n' +
    '    exit 0\n' +
    '  else\n' +
    '    echo "not authenticated" >&2\n' +
    '    exit 1\n' +
    '  fi\n' +
    'fi\n' +
    'if [ "$1" = "label" ] && [ "$2" = "list" ]; then\n' +
    `  if [ "${labelListExitCode}" != "0" ]; then exit ${labelListExitCode}; fi\n` +
    `  cat <<'__JSON__'\n${labelsJson}\n__JSON__\n` +
    '  exit 0\n' +
    'fi\n' +
    'echo "fake-gh: unsupported invocation: $*" >&2\n' +
    'exit 99\n';
  const ghPath = path.join(binDir, 'gh');
  fs.writeFileSync(ghPath, script, { mode: 0o755 });
  return ghPath;
}

function runScaffold(cwd, args = [], { ghBin, env = {} } = {}) {
  const result = spawnSync(
    process.execPath,
    [SCAFFOLD, '--cwd', cwd, ...args],
    {
      cwd,
      env: {
        ...process.env,
        ...(ghBin ? { HIVE_GH_BIN: ghBin } : {}),
        ...env,
      },
      encoding: 'utf8',
    },
  );
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function listRepoFiles(cwd) {
  const out = execFileSync(
    'git',
    ['ls-files', '--others', '--cached', '--exclude-standard'],
    { cwd, encoding: 'utf8' },
  );
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// (a) missing-prereq -> exit 2 + remediation message + ZERO files written
// ---------------------------------------------------------------------------

test('AC-1 missing .sandcastle/Dockerfile exits 2 with remediation and writes no files', () => {
  const cwd = makeTmpDir('missing-prereq');
  seedRepo(cwd, { withDockerfile: false });
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  const before = listRepoFiles(cwd);
  const result = runScaffold(cwd, [], { ghBin });
  assert.equal(result.status, 2, `stderr was: ${result.stderr}`);
  assert.match(result.stderr, /npx sandcastle init/);
  const after = listRepoFiles(cwd);
  assert.deepEqual(after, before, 'no files should have been written');
  for (const f of MANAGED) {
    assert.ok(!fs.existsSync(path.join(cwd, f)), `${f} should not exist`);
  }
});

// ---------------------------------------------------------------------------
// (b) prereq-met fresh -> all 3 artifacts + single commit
// ---------------------------------------------------------------------------

test('AC-2 fresh run with defaults writes all 3 artifacts and creates one commit', () => {
  const cwd = makeTmpDir('fresh');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  const result = runScaffold(cwd, [], { ghBin });
  assert.equal(result.status, 0, `stderr was: ${result.stderr}`);
  for (const f of MANAGED) {
    assert.ok(
      fs.existsSync(path.join(cwd, f)),
      `${f} should exist after fresh run`,
    );
  }
  const log = execFileSync(
    'git',
    ['log', '--pretty=%s', '--all'],
    { cwd, encoding: 'utf8' },
  );
  const scaffoldCommits = log
    .split('\n')
    .filter((l) => l.startsWith('chore(hive): wire github-issue dispatch'));
  assert.equal(
    scaffoldCommits.length,
    1,
    `expected exactly one scaffold commit, got log:\n${log}`,
  );
  const show = execFileSync(
    'git',
    ['show', '--name-only', '--pretty=format:', 'HEAD'],
    { cwd, encoding: 'utf8' },
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const f of MANAGED) {
    assert.ok(
      show.includes(f),
      `commit should include ${f}, got: ${show.join(', ')}`,
    );
  }
});

// ---------------------------------------------------------------------------
// (c) re-run idempotency -> user-owned files untouched; only managed_files rewritten
// ---------------------------------------------------------------------------

test('AC-3 re-run with existing manifest only rewrites managed_files; user files untouched', () => {
  const cwd = makeTmpDir('rerun');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  // First run
  let result = runScaffold(cwd, [], { ghBin });
  assert.equal(result.status, 0, `first run stderr: ${result.stderr}`);

  // Drop a user-owned file alongside hive files
  const userFile = path.join(cwd, '.github', 'scripts', 'other.mjs');
  fs.writeFileSync(userFile, 'export const owned = "by-user";\n');
  execFileSync('git', ['add', '.github/scripts/other.mjs'], { cwd });
  execFileSync('git', ['commit', '-m', 'add user script'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const userBefore = fs.readFileSync(userFile, 'utf8');
  const userMtimeBefore = fs.statSync(userFile).mtimeMs;

  // Hand-edit the bridge to verify it gets rewritten back to template content
  const bridgePath = path.join(cwd, '.github/scripts/sandcastle-hive-bridge.mts');
  fs.writeFileSync(bridgePath, '// stale hand-edit\n');

  // Second run
  result = runScaffold(cwd, [], { ghBin });
  assert.equal(result.status, 0, `second run stderr: ${result.stderr}`);

  // User file untouched (byte-for-byte)
  assert.equal(
    fs.readFileSync(userFile, 'utf8'),
    userBefore,
    'user-owned file content was modified',
  );
  // Managed file restored to template content
  const bridgeAfter = fs.readFileSync(bridgePath, 'utf8');
  assert.ok(
    bridgeAfter.includes('@ai-hero/sandcastle'),
    'bridge was not regenerated from template on re-run',
  );
  assert.ok(
    !bridgeAfter.includes('stale hand-edit'),
    'bridge still contains the hand-edit',
  );
});

// ---------------------------------------------------------------------------
// (d) --secret-mode openai -> workflow env references OPENAI_API_KEY
// ---------------------------------------------------------------------------

test('AC-4 --secret-mode openai writes OPENAI_API_KEY into the workflow env', () => {
  const cwd = makeTmpDir('openai-mode');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  const result = runScaffold(cwd, ['--secret-mode', 'openai'], { ghBin });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const yml = fs.readFileSync(
    path.join(cwd, '.github/workflows/hive-dispatch.yml'),
    'utf8',
  );
  assert.match(yml, /OPENAI_API_KEY:\s*\$\{\{\s*secrets\.OPENAI_API_KEY\s*\}\}/);
  assert.ok(
    !/ANTHROPIC_API_KEY:\s*\$\{\{/.test(yml),
    'workflow still references ANTHROPIC_API_KEY in openai mode',
  );
  const bridge = fs.readFileSync(
    path.join(cwd, '.github/scripts/sandcastle-hive-bridge.mts'),
    'utf8',
  );
  assert.match(bridge, /process\.env\["OPENAI_API_KEY"\]/);
});

// ---------------------------------------------------------------------------
// (e) missing gh auth -> fail fast before any writes
// ---------------------------------------------------------------------------

test('AC-5 unauthenticated gh fails fast and writes no files', () => {
  const cwd = makeTmpDir('unauth');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'), { authOk: false });
  const before = listRepoFiles(cwd);
  const result = runScaffold(cwd, [], { ghBin });
  assert.notEqual(result.status, 0, 'should exit non-zero');
  assert.match(result.stderr, /gh auth status|gh auth login/);
  for (const f of MANAGED) {
    assert.ok(!fs.existsSync(path.join(cwd, f)), `${f} should not exist`);
  }
  const after = listRepoFiles(cwd);
  assert.deepEqual(after, before, 'no files should have been written');
});

// ---------------------------------------------------------------------------
// (f) missing one canonical label -> warn + remediation; files still written
// ---------------------------------------------------------------------------

test('AC-6 missing canonical label warns with remediation and still ships the scaffold', () => {
  const cwd = makeTmpDir('missing-label');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'), {
    labels: ALL_LABELS.filter((l) => l !== 'hive:shipped'),
  });
  const result = runScaffold(cwd, [], { ghBin });
  assert.equal(
    result.status,
    0,
    `missing label must NOT block; stderr: ${result.stderr}`,
  );
  assert.match(result.stderr, /hive:shipped/);
  assert.match(result.stderr, /gh label create/);
  for (const f of MANAGED) {
    assert.ok(
      fs.existsSync(path.join(cwd, f)),
      `${f} should still be written when a label is missing`,
    );
  }
});

// ---------------------------------------------------------------------------
// (g) sandcastle pin extraction -> manifest pin matches node_modules version
// ---------------------------------------------------------------------------

test('AC-7 sandcastle_pin in manifest matches version from node_modules package.json', () => {
  const cwd = makeTmpDir('pin');
  seedRepo(cwd);
  const pkgDir = path.join(
    cwd,
    'node_modules',
    '@ai-hero',
    'sandcastle',
  );
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@ai-hero/sandcastle', version: '0.5.42' }),
  );
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  const result = runScaffold(cwd, [], { ghBin });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  const manifest = fs.readFileSync(
    path.join(cwd, '.hive-dispatch/manifest.yaml'),
    'utf8',
  );
  assert.match(manifest, /sandcastle_pin:\s*"?0\.5\.42"?/);
  assert.match(manifest, /managed_files:/);
  for (const f of MANAGED) {
    assert.ok(
      manifest.includes(`- ${f}`),
      `manifest.managed_files should list ${f}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Partial-scaffold guard (story risk: no manifest but workflow exists)
// ---------------------------------------------------------------------------

test('partial scaffold (no manifest, workflow present) refuses without --force-recover', () => {
  const cwd = makeTmpDir('partial');
  seedRepo(cwd);
  const ghBin = writeFakeGh(path.join(cwd, '.bin'));
  // Pre-create a managed file without a manifest
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.github/workflows/hive-dispatch.yml'),
    '# user-edited\n',
  );
  const result = runScaffold(cwd, [], { ghBin });
  assert.notEqual(result.status, 0, 'should refuse without --force-recover');
  assert.match(result.stderr, /partial scaffold/i);
  assert.match(result.stderr, /--force-recover/);
  // File untouched
  assert.equal(
    fs.readFileSync(
      path.join(cwd, '.github/workflows/hive-dispatch.yml'),
      'utf8',
    ),
    '# user-edited\n',
    'user-edited file should be untouched',
  );

  // With --force-recover the run succeeds
  const force = runScaffold(cwd, ['--force-recover'], { ghBin });
  assert.equal(force.status, 0, `force run stderr: ${force.stderr}`);
  assert.match(
    fs.readFileSync(
      path.join(cwd, '.github/workflows/hive-dispatch.yml'),
      'utf8',
    ),
    /Hive dispatch/,
  );
});
