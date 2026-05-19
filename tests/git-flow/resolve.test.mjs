/**
 * Fixture tests for hive/lib/git_flow.mjs (story pe-1-config-schema).
 *
 * Run: node --test tests/git-flow/resolve.test.mjs
 *
 * Each test sets up an isolated temp cwd with its own hive.config.yaml +
 * hive/hive.config.yaml content, optionally initializes a git repo with an
 * origin/develop ref, then invokes resolveGitFlow({ cwd }).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveGitFlow } from '../../hive/lib/git_flow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function makeTmpCwd(prefix = 'gitflow-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(dir, rel, content) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function initGitRepo(dir, { withOriginDevelop = false } = {}) {
  // Hermetic: no global config, no signing, no hooks.
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const run = (args) =>
    execFileSync('git', ['-C', dir, ...args], { env, stdio: 'pipe' });
  run(['init', '-q', '-b', 'main']);
  run(['commit', '--allow-empty', '-q', '-m', 'init']);
  if (withOriginDevelop) {
    // Build a fake remote: bare repo, push a develop branch to it as origin.
    const remoteDir = `${dir}.remote`;
    fs.mkdirSync(remoteDir, { recursive: true });
    execFileSync('git', ['-C', remoteDir, 'init', '-q', '--bare'], { env, stdio: 'pipe' });
    run(['remote', 'add', 'origin', remoteDir]);
    run(['checkout', '-q', '-b', 'develop']);
    run(['commit', '--allow-empty', '-q', '-m', 'develop']);
    run(['push', '-q', 'origin', 'develop']);
    run(['checkout', '-q', 'main']);
  }
}

test('AC1: explicit default_pr_base: develop returns develop', () => {
  const cwd = makeTmpCwd();
  writeFile(
    cwd,
    'hive.config.yaml',
    [
      'git_flow:',
      '  default_pr_base: develop',
      '  branch_strategy: per-epic',
      '',
    ].join('\n'),
  );

  const out = resolveGitFlow({ cwd });
  assert.equal(out.base_branch, 'develop');
  assert.equal(out.branch_strategy, 'per-epic');
  assert.equal(out.source, 'root');
});

test('AC2: auto + origin/develop exists resolves to develop', () => {
  const cwd = makeTmpCwd();
  initGitRepo(cwd, { withOriginDevelop: true });
  writeFile(
    cwd,
    'hive.config.yaml',
    [
      'git_flow:',
      '  default_pr_base: auto',
      '  branch_strategy: per-epic',
      '',
    ].join('\n'),
  );

  const out = resolveGitFlow({ cwd });
  assert.equal(out.base_branch, 'develop');
  assert.equal(out.branch_strategy, 'per-epic');
  assert.equal(out.source, 'root');
});

test('AC3: auto + no origin/develop resolves to main', () => {
  const cwd = makeTmpCwd();
  initGitRepo(cwd, { withOriginDevelop: false });
  writeFile(
    cwd,
    'hive.config.yaml',
    [
      'git_flow:',
      '  default_pr_base: auto',
      '  branch_strategy: per-epic',
      '',
    ].join('\n'),
  );

  const out = resolveGitFlow({ cwd });
  assert.equal(out.base_branch, 'main');
  assert.equal(out.branch_strategy, 'per-epic');
  assert.equal(out.source, 'root');
});

test('AC4: root config omits git_flow → falls through to plugin baseline (auto + per-epic)', () => {
  const cwd = makeTmpCwd();
  initGitRepo(cwd, { withOriginDevelop: false });
  // Root config exists but has no git_flow block.
  writeFile(
    cwd,
    'hive.config.yaml',
    [
      'paths:',
      '  state_dir: .pHive',
      '',
      'execution:',
      '  default_methodology: classic',
      '',
    ].join('\n'),
  );
  // Plugin baseline at <cwd>/hive/hive.config.yaml provides the defaults.
  writeFile(
    cwd,
    'hive/hive.config.yaml',
    [
      'git_flow:',
      '  default_pr_base: auto',
      '  branch_strategy: per-epic',
      '',
    ].join('\n'),
  );

  const out = resolveGitFlow({ cwd });
  assert.equal(out.base_branch, 'main'); // no origin/develop -> main
  assert.equal(out.branch_strategy, 'per-epic');
  assert.equal(out.source, 'plugin');
});

test('AC5: no-argument invocation defaults cwd to process.cwd()', () => {
  const cwd = makeTmpCwd();
  writeFile(
    cwd,
    'hive.config.yaml',
    [
      'git_flow:',
      '  default_pr_base: develop',
      '  branch_strategy: per-story',
      '',
    ].join('\n'),
  );
  const prevCwd = process.cwd();
  try {
    process.chdir(cwd);
    const out = resolveGitFlow();
    assert.equal(out.base_branch, 'develop');
    assert.equal(out.branch_strategy, 'per-story');
    assert.equal(out.source, 'root');
  } finally {
    process.chdir(prevCwd);
  }
});
