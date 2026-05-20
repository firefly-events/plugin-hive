'use strict';

/**
 * Tests for hive/lib/external/github-issues-adapter.js
 *
 * Story: s1-github-issues-adapter (sandcastle-ops-layer)
 * Run:   node --test tests/hive-lib/github-issues-adapter.test.js
 *
 * The adapter LABELS existing issues — it does NOT create them. Issue
 * creation is owned by Epic C ABI (step 19 of /plan Phase D); this module
 * runs in step 19a and reads each story's `tracker_id`
 * ("<owner>/<repo>#<number>") to find the upstream-created issue and add
 * hive:* labels.
 *
 * Mocking: every test injects `_deps` that replaces:
 *   - execFileFn  — child_process.execFile spy (no real gh calls)
 *   - readFileFn  — returns canned YAML strings keyed by path
 *   - writeFileFn — captures writes to an in-memory map
 *   - renameFn    — captures temp→final renames
 *   - yamlLib     — minimal in-test js-yaml shim (load + dump)
 *
 * Covers:
 *  1. Happy path — 3 stories with tracker_id → 3 `gh issue edit` calls with
 *     locked label namespace; external_id written back.
 *  2. Skip when tracker_id missing (Epic C didn't create) — no_tracker_id.
 *  3. Skip when external_id already set — already_published (no gh call).
 *  4. Skip when tracker_id malformed.
 *  5. dryRun — no gh calls; planned actions returned.
 *  6. Mid-batch gh edit failure — first persists, second in errors[].
 *  7. Empty storyIds → no-op.
 *  8. label_prefix override honored.
 *  9. sweepBlockedByLabels — closed parent unblocks child + adds ready.
 * 10. sweep — open parent leaves child blocked.
 * 11. sweep — child with 2 blockers (1 closed, 1 open) → partial remove.
 * 12. parseTrackerId — accepts canonical, rejects malformed.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', 'hive', 'lib', 'external', 'github-issues-adapter.js');

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

// ---------------------------------------------------------------------------
// Minimal in-test yaml shim — uses a __JSON__: sentinel prefix to avoid
// pulling in real js-yaml.
// ---------------------------------------------------------------------------

const yamlShim = {
  load: (text) => {
    if (!text || !text.trim()) return null;
    if (text.startsWith('__JSON__:')) {
      return JSON.parse(text.slice('__JSON__:'.length));
    }
    throw new Error(`yamlShim.load: expected __JSON__-prefixed fixture; got: ${text.slice(0, 80)}`);
  },
  dump: (data, _opts) => {
    return '__JSON__:' + JSON.stringify(data);
  },
};

function makeStoryYaml(story) {
  return '__JSON__:' + JSON.stringify(story);
}

// ---------------------------------------------------------------------------
// Spy helpers
// ---------------------------------------------------------------------------

function makeExecFileSpy(script) {
  const calls = [];
  let idx = 0;
  function execFileFn(file, args, options, cb) {
    calls.push({ file, args: args.slice(), options });
    const step = script[idx] || script[script.length - 1] || { stdout: '' };
    idx += 1;
    if (step.error) {
      const err = step.error;
      err.stderr = step.stderr || '';
      err.stdout = step.stdout || '';
      return process.nextTick(() => cb(err, step.stdout || '', step.stderr || ''));
    }
    process.nextTick(() => cb(null, step.stdout || '', step.stderr || ''));
  }
  return { execFileFn, calls };
}

function makeFsSpy(initialFiles) {
  const files = Object.assign({}, initialFiles);
  const writes = [];
  const renames = [];

  function readFileFn(filePath, _enc) {
    if (!(filePath in files)) {
      const err = new Error(`ENOENT: no such file ${filePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return files[filePath];
  }
  function writeFileFn(filePath, content, _enc) {
    files[filePath] = content;
    writes.push({ filePath, content });
  }
  function renameFn(from, to) {
    if (!(from in files)) {
      const err = new Error(`ENOENT: no such file ${from}`);
      err.code = 'ENOENT';
      throw err;
    }
    files[to] = files[from];
    delete files[from];
    renames.push({ from, to });
  }
  return { readFileFn, writeFileFn, renameFn, files, writes, renames };
}

function storyPath(epicId, storyId) {
  return path.join('.pHive', 'epics', epicId, 'stories', `${storyId}.yaml`);
}

const baseConfig = {
  adapter: 'github',
  // Note: github_owner/team_value are NOT required for publishStoriesToIssues
  // — repo info comes from each story's tracker_id. They ARE required for
  // sweepBlockedByLabels (which lists issues by label, not by id).
  label_prefix: 'hive',
};

const sweepConfig = {
  adapter: 'github',
  team_value: 'firefly-events',
  project_value: 'plugin-hive',
  label_prefix: 'hive',
};

// ---------------------------------------------------------------------------
// AC-1: Happy path — 3 stories with tracker_id → 3 gh edit calls + labels
// ---------------------------------------------------------------------------

test('happy path — 3 stories with tracker_id get labeled, external_id written', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'demo-epic';
  const stories = [
    { id: 's-one',   title: 'One',   tracker_id: 'firefly-events/plugin-hive#101', depends_on: [] },
    { id: 's-two',   title: 'Two',   tracker_id: 'firefly-events/plugin-hive#102', depends_on: ['s-one'] },
    { id: 's-three', title: 'Three', tracker_id: 'firefly-events/plugin-hive#103', depends_on: ['s-one', 's-two'] },
  ];
  const fs = makeFsSpy({
    [storyPath(epicId, 's-one')]:   makeStoryYaml(stories[0]),
    [storyPath(epicId, 's-two')]:   makeStoryYaml(stories[1]),
    [storyPath(epicId, 's-three')]: makeStoryYaml(stories[2]),
  });
  const exec = makeExecFileSpy([
    { stdout: '' },
    { stdout: '' },
    { stdout: '' },
  ]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-one', 's-two', 's-three'],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(result.labeled.length, 3);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.labeled.map((c) => c.issue_number), [101, 102, 103]);

  // All three calls are `gh issue edit <n> --repo o/r --add-label ...`
  for (const c of exec.calls) {
    assert.equal(c.args[0], 'issue');
    assert.equal(c.args[1], 'edit');
    assert.ok(c.args.includes('--repo'));
    assert.ok(c.args.includes('--add-label'));
    // No --title / --body / `gh issue create` — issues already exist.
    assert.ok(!c.args.includes('create'));
    assert.ok(!c.args.includes('--title'));
    assert.ok(!c.args.includes('--body'));
  }

  // s-one (no deps) → hive:ready
  const oneArgs = exec.calls[0].args;
  assert.equal(oneArgs[2], '101', 'issue number is positional after edit');
  assert.ok(oneArgs.includes('hive:ready'));
  assert.ok(oneArgs.includes('hive:epic:demo-epic'));
  assert.ok(oneArgs.includes('hive:story:s-one'));

  // s-two (deps: s-one) → hive:blocked-by:s-one (no ready)
  const twoArgs = exec.calls[1].args;
  assert.equal(twoArgs[2], '102');
  assert.ok(twoArgs.includes('hive:blocked-by:s-one'));
  assert.ok(!twoArgs.includes('hive:ready'));

  // s-three (deps: s-one, s-two) → both blocked-by labels
  const threeArgs = exec.calls[2].args;
  assert.equal(threeArgs[2], '103');
  assert.ok(threeArgs.includes('hive:blocked-by:s-one'));
  assert.ok(threeArgs.includes('hive:blocked-by:s-two'));

  // external_id written back as bare int
  const updatedOne = yamlShim.load(fs.files[storyPath(epicId, 's-one')]);
  assert.equal(updatedOne.external_id, 101);
  assert.equal(updatedOne.tracker_id, 'firefly-events/plugin-hive#101', 'tracker_id preserved');
});

// ---------------------------------------------------------------------------
// AC-2: Missing tracker_id — Epic C didn't create → skip "no_tracker_id"
// ---------------------------------------------------------------------------

test('no tracker_id — story skipped with reason "no_tracker_id", no gh call', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'missing-tid';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-orphan')]: makeStoryYaml({
      id: 's-orphan',
      title: 'Orphan',
      depends_on: [],
      // no tracker_id
    }),
  });
  const exec = makeExecFileSpy([]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-orphan'],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(result.labeled.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].id, 's-orphan');
  assert.equal(result.skipped[0].reason, 'no_tracker_id');
  assert.equal(result.errors.length, 0);
  assert.equal(exec.calls.length, 0, 'must NOT call gh — adapter never creates');
});

// ---------------------------------------------------------------------------
// AC-3: Idempotent re-run — external_id already set → already_published
// ---------------------------------------------------------------------------

test('idempotent re-run — external_id present → skipped, no gh call', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'idemp-epic';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-done')]: makeStoryYaml({
      id: 's-done',
      title: 'Done',
      tracker_id: 'firefly-events/plugin-hive#77',
      external_id: 77,
      depends_on: [],
    }),
  });
  const exec = makeExecFileSpy([]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-done'],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(result.labeled.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'already_published');
  assert.equal(result.skipped[0].issue_number, 77);
  assert.equal(exec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// AC-4: Malformed tracker_id → skipped (treated like no_tracker_id)
// ---------------------------------------------------------------------------

test('malformed tracker_id — skipped with reason "no_tracker_id"', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'bad-tid';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-bad')]: makeStoryYaml({
      id: 's-bad',
      title: 'Bad',
      tracker_id: 'not-a-valid-format',
      depends_on: [],
    }),
  });
  const exec = makeExecFileSpy([]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-bad'],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'no_tracker_id');
  assert.equal(exec.calls.length, 0);
});

// ---------------------------------------------------------------------------
// AC-5: dryRun — no gh calls, planned labels returned, no YAML mutation
// ---------------------------------------------------------------------------

test('dryRun — no gh calls, planned actions returned with labels', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'dry-epic';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-a')]: makeStoryYaml({
      id: 's-a', title: 'A',
      tracker_id: 'o/r#9',
      depends_on: [],
    }),
  });
  const exec = makeExecFileSpy([]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-a'],
    config: baseConfig,
    dryRun: true,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(exec.calls.length, 0, 'dryRun must not invoke gh');
  assert.equal(result.labeled.length, 1);
  assert.equal(result.labeled[0].dryRun, true);
  assert.equal(result.labeled[0].issue_number, 9);
  assert.ok(result.labeled[0].labels.includes('hive:ready'));
  // YAML unchanged
  const yaml = yamlShim.load(fs.files[storyPath(epicId, 's-a')]);
  assert.equal(yaml.external_id, undefined);
});

// ---------------------------------------------------------------------------
// AC-6: gh edit failure mid-batch — first persists external_id, second errors
// ---------------------------------------------------------------------------

test('gh edit failure mid-batch — first persists, second in errors[], no half-write', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'fail-epic';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-ok')]:  makeStoryYaml({ id: 's-ok',  title: 'OK',  tracker_id: 'o/r#501', depends_on: [] }),
    [storyPath(epicId, 's-bad')]: makeStoryYaml({ id: 's-bad', title: 'BAD', tracker_id: 'o/r#502', depends_on: [] }),
  });
  const exec = makeExecFileSpy([
    { stdout: '' },                              // s-ok edit succeeds
    { error: new Error('HTTP 403: rate limited'), stderr: 'gh: rate limited' },
  ]);

  const result = await publishStoriesToIssues({
    epicId,
    storyIds: ['s-ok', 's-bad'],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(result.labeled.length, 1);
  assert.equal(result.labeled[0].id, 's-ok');
  assert.equal(result.labeled[0].issue_number, 501);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, 's-bad');
  assert.match(result.errors[0].error, /rate limited|403/);

  // s-ok YAML has external_id=501; s-bad YAML unchanged
  const okYaml = yamlShim.load(fs.files[storyPath(epicId, 's-ok')]);
  assert.equal(okYaml.external_id, 501);
  const badYaml = yamlShim.load(fs.files[storyPath(epicId, 's-bad')]);
  assert.equal(badYaml.external_id, undefined);

  // No token leakage in surfaced error
  assert.doesNotMatch(result.errors[0].error, /ghp_|github_pat_|gho_/);
});

// ---------------------------------------------------------------------------
// AC-7: Empty storyIds → no-op
// ---------------------------------------------------------------------------

test('empty storyIds — no gh calls, no errors', async () => {
  const { publishStoriesToIssues } = loadModule();
  const fs = makeFsSpy({});
  const exec = makeExecFileSpy([]);

  const result = await publishStoriesToIssues({
    epicId: 'empty-epic',
    storyIds: [],
    config: baseConfig,
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  assert.equal(exec.calls.length, 0);
  assert.equal(result.labeled.length, 0);
  assert.equal(result.skipped.length, 0);
  assert.equal(result.errors.length, 0);
});

// ---------------------------------------------------------------------------
// AC-8: label_prefix override is honored
// ---------------------------------------------------------------------------

test('label_prefix override — custom prefix used in all labels', async () => {
  const { publishStoriesToIssues } = loadModule();
  const epicId = 'pfx-epic';
  const fs = makeFsSpy({
    [storyPath(epicId, 's-a')]: makeStoryYaml({
      id: 's-a', title: 'A',
      tracker_id: 'o/r#9',
      depends_on: [],
    }),
  });
  const exec = makeExecFileSpy([{ stdout: '' }]);

  await publishStoriesToIssues({
    epicId,
    storyIds: ['s-a'],
    config: Object.assign({}, baseConfig, { label_prefix: 'acme' }),
    _deps: {
      execFileFn: exec.execFileFn,
      readFileFn: fs.readFileFn,
      writeFileFn: fs.writeFileFn,
      renameFn: fs.renameFn,
      yamlLib: yamlShim,
    },
  });

  const args = exec.calls[0].args;
  assert.ok(args.includes('acme:ready'));
  assert.ok(args.includes('acme:epic:pfx-epic'));
  assert.ok(args.includes('acme:story:s-a'));
  assert.ok(!args.some((a) => a === 'hive:ready'));
});

// ---------------------------------------------------------------------------
// AC-9: sweepBlockedByLabels — closed parent unblocks child + adds ready
// ---------------------------------------------------------------------------

test('sweep — closed parent unblocks child, adds hive:ready when no other blockers', async () => {
  const { sweepBlockedByLabels } = loadModule();
  const exec = makeExecFileSpy([
    {
      stdout: JSON.stringify([
        { number: 42, labels: [{ name: 'hive:epic:sweep-epic' }, { name: 'hive:blocked-by:s-parent' }] },
      ]),
    },
    { stdout: JSON.stringify([{ number: 41, state: 'CLOSED' }]) },
    { stdout: '' },
  ]);

  const result = await sweepBlockedByLabels({
    epicId: 'sweep-epic',
    config: sweepConfig,
    _deps: { execFileFn: exec.execFileFn },
  });

  assert.deepEqual(result.unblocked, [42]);
  const editCall = exec.calls[2];
  assert.equal(editCall.args[0], 'issue');
  assert.equal(editCall.args[1], 'edit');
  assert.ok(editCall.args.includes('--remove-label'));
  assert.ok(editCall.args.includes('hive:blocked-by:s-parent'));
  assert.ok(editCall.args.includes('--add-label'));
  assert.ok(editCall.args.includes('hive:ready'));
});

// ---------------------------------------------------------------------------
// AC-10: sweep — parent still open → no edit, no unblock
// ---------------------------------------------------------------------------

test('sweep — open parent leaves child blocked (no edit)', async () => {
  const { sweepBlockedByLabels } = loadModule();
  const exec = makeExecFileSpy([
    {
      stdout: JSON.stringify([
        { number: 42, labels: [{ name: 'hive:epic:sweep-epic' }, { name: 'hive:blocked-by:s-parent' }] },
      ]),
    },
    { stdout: JSON.stringify([{ number: 41, state: 'OPEN' }]) },
  ]);

  const result = await sweepBlockedByLabels({
    epicId: 'sweep-epic',
    config: sweepConfig,
    _deps: { execFileFn: exec.execFileFn },
  });

  assert.deepEqual(result.unblocked, []);
  assert.equal(exec.calls.length, 2, 'no edit call when parent still open');
});

// ---------------------------------------------------------------------------
// AC-11: sweep — child with 2 blockers (1 closed, 1 open) → partial remove
// ---------------------------------------------------------------------------

test('sweep — child with 2 blockers (1 closed, 1 open) → partial remove, no ready', async () => {
  const { sweepBlockedByLabels } = loadModule();
  const exec = makeExecFileSpy([
    {
      stdout: JSON.stringify([
        {
          number: 50,
          labels: [
            { name: 'hive:epic:e' },
            { name: 'hive:blocked-by:p-closed' },
            { name: 'hive:blocked-by:p-open' },
          ],
        },
      ]),
    },
    { stdout: JSON.stringify([{ number: 1, state: 'CLOSED' }]) },
    { stdout: JSON.stringify([{ number: 2, state: 'OPEN' }]) },
    { stdout: '' },
  ]);

  const result = await sweepBlockedByLabels({
    epicId: 'e',
    config: sweepConfig,
    _deps: { execFileFn: exec.execFileFn },
  });

  assert.deepEqual(result.unblocked, [50]);
  const editCall = exec.calls[3];
  assert.ok(editCall.args.includes('--remove-label'));
  assert.ok(editCall.args.includes('hive:blocked-by:p-closed'));
  assert.ok(!editCall.args.includes('hive:blocked-by:p-open'), 'open blocker stays');
  assert.ok(!editCall.args.includes('hive:ready'), 'still has 1 blocker → no ready');
});

// ---------------------------------------------------------------------------
// AC-12: parseTrackerId internal — accepts canonical, rejects malformed
// ---------------------------------------------------------------------------

test('_internal.parseTrackerId — accepts canonical, rejects malformed', () => {
  const { _internal } = loadModule();
  assert.deepEqual(
    _internal.parseTrackerId('firefly-events/plugin-hive#42'),
    { owner: 'firefly-events', repo: 'plugin-hive', number: 42 },
  );
  assert.equal(_internal.parseTrackerId(''), null);
  assert.equal(_internal.parseTrackerId(null), null);
  assert.equal(_internal.parseTrackerId('owner/repo'), null, 'missing #n');
  assert.equal(_internal.parseTrackerId('owner#42'), null, 'missing /repo');
  assert.equal(_internal.parseTrackerId('owner/repo#'), null, 'empty number');
});
