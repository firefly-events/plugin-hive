import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { writeMulticaRunEpisode } from '../episode-sync.mjs';

function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'episode-sync-test-'));
}

function makeTerminal(overrides = {}) {
  return {
    status: 'completed',
    notes: '',
    messages: [],
    task_id: 'task-uuid-1',
    agent_id: 'agent-uuid-1',
    agent_name: 'developer',
    work_dir: '/work',
    attempts: 1,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:00:01Z',
    ...overrides,
  };
}

function makeOpts(hiveStateDir, overrides = {}) {
  return {
    hiveStateDir,
    epicHandle: 'test-epic',
    storyId: 'test-story',
    issueUuid: 'issue-uuid-1',
    identifier: 'HIV-1',
    terminal: makeTerminal(),
    ...overrides,
  };
}

function makeEvaluation(overrides = {}) {
  return {
    actor_type: 'agent',
    actor_id: 'agent-uuid-42',
    outcome: 'action',
    reason: 'Story meets all acceptance criteria.',
    created_at: '2026-06-14T10:00:00Z',
    ...overrides,
  };
}

// --- squad_evaluation present ---

test('squad_evaluation present: marker contains a squad_evaluation block', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await writeMulticaRunEpisode(
    makeOpts(dir, { squad_evaluation: makeEvaluation() }),
  );
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.match(marker, /^squad_evaluation:$/m, 'top-level squad_evaluation: key must be present');
  assert.match(marker, /^\s+actor_type:/m, 'actor_type field must be present');
  assert.match(marker, /^\s+actor_id:/m, 'actor_id field must be present');
  assert.match(marker, /^\s+outcome:/m, 'outcome field must be present');
  assert.match(marker, /^\s+reason:/m, 'reason field must be present');
  assert.match(marker, /^\s+created_at:/m, 'created_at field must be present');
});

test('squad_evaluation present: block serializes each field value', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const evaluation = makeEvaluation({
    actor_type: 'agent',
    actor_id: 'agent-uuid-42',
    outcome: 'no_action',
    reason: 'Needs revision.',
    created_at: '2026-06-15T08:30:00Z',
  });

  const result = await writeMulticaRunEpisode(makeOpts(dir, { squad_evaluation: evaluation }));
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.match(marker, /"agent"/, 'actor_type value must appear');
  assert.match(marker, /"agent-uuid-42"/, 'actor_id value must appear');
  assert.match(marker, /"no_action"/, 'outcome value must appear');
  assert.match(marker, /"Needs revision\."/, 'reason value must appear');
  assert.match(marker, /"2026-06-15T08:30:00Z"/, 'created_at value must appear');
});

test('squad_evaluation present: null sub-fields serialize as "null"', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const evaluation = { actor_type: null, actor_id: null, outcome: null, reason: null, created_at: null };

  const result = await writeMulticaRunEpisode(makeOpts(dir, { squad_evaluation: evaluation }));
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.match(marker, /^squad_evaluation:$/m, 'squad_evaluation block must be present');
  // yamlScalar(null) returns bare `null` (YAML null scalar, not a quoted string)
  const sqBlock = marker.slice(marker.indexOf('squad_evaluation:'));
  const nullCount = (sqBlock.match(/: null\b/g) ?? []).length;
  assert.equal(nullCount, 5, 'all 5 null sub-fields must serialize as bare null');
});

// --- squad_evaluation null / omitted ---

test('squad_evaluation null: no squad_evaluation key in marker', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await writeMulticaRunEpisode(makeOpts(dir, { squad_evaluation: null }));
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.doesNotMatch(marker, /squad_evaluation/, 'squad_evaluation must not appear when null');
});

test('squad_evaluation omitted: no squad_evaluation key in marker', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await writeMulticaRunEpisode(makeOpts(dir));
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.doesNotMatch(marker, /squad_evaluation/, 'squad_evaluation must not appear when omitted');
});

// --- existing marker fields unchanged ---

test('existing fields: core marker fields present regardless of squad_evaluation', async (t) => {
  const REQUIRED_FIELDS = [
    /^step: multica-run$/m,
    /^story:/m,
    /^epic:/m,
    /^agent:/m,
    /^status:/m,
    /^completion_kind:/m,
    /^artifacts_committed:/m,
    /^episode_terminal:/m,
    /^requires_code_push_sha:/m,
    /^code_push_sha:/m,
    /^terminal_by_dialect:/m,
    /^started_at:/m,
    /^completed_at:/m,
    /^artifacts:/m,
    /^multica:/m,
    /^notes:/m,
  ];

  for (const squadEval of [makeEvaluation(), null, undefined]) {
    const dir = await makeTempDir();
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const result = await writeMulticaRunEpisode(makeOpts(dir, { squad_evaluation: squadEval }));
    const marker = await fs.readFile(result.markerPath, 'utf8');

    for (const pattern of REQUIRED_FIELDS) {
      assert.match(
        marker,
        pattern,
        `field ${pattern} must be present (squad_evaluation=${JSON.stringify(squadEval)})`,
      );
    }
  }
});

test('existing fields: status maps completed→passed with and without squad_evaluation', async (t) => {
  for (const squadEval of [makeEvaluation(), null]) {
    const dir = await makeTempDir();
    t.after(() => fs.rm(dir, { recursive: true, force: true }));

    const result = await writeMulticaRunEpisode(makeOpts(dir, { squad_evaluation: squadEval }));
    const marker = await fs.readFile(result.markerPath, 'utf8');

    assert.match(
      marker,
      /^status: passed$/m,
      `status must be 'passed' for completed terminal (squad_evaluation=${JSON.stringify(squadEval)})`,
    );
  }
});

test('existing fields: multica sub-fields carry through with non-null squad_evaluation', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await writeMulticaRunEpisode(
    makeOpts(dir, {
      issueUuid: 'issue-abc',
      identifier: 'HIV-99',
      squad_evaluation: makeEvaluation(),
      terminal: makeTerminal({ task_id: 'task-xyz', agent_id: 'agt-1' }),
    }),
  );
  const marker = await fs.readFile(result.markerPath, 'utf8');

  assert.match(marker, /"issue-abc"/, 'issue_uuid must appear in multica block');
  assert.match(marker, /"HIV-99"/, 'identifier must appear in multica block');
  assert.match(marker, /"task-xyz"/, 'task_id must appear in multica block');
});
