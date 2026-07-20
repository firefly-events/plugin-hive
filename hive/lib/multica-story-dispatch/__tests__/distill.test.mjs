import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runMulticaInsightDistill } from '../distill.mjs';

function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'insight-distill-bridge-'));
}

test('runMulticaInsightDistill skips cleanly without invoking python when persona is missing', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await runMulticaInsightDistill({
    hiveStateDir: dir,
    epicHandle: 'test-epic',
    storyId: 'test-story',
    workDir: null,
    messagesPath: null,
    selfCapturePath: null,
    persona: null,
    pythonBin: '/no/such/interpreter-binary',
  });

  assert.deepEqual(result, {
    skipped: true, reason: 'missing-persona', written: null, kg_emitted: 0, degraded: false, error: null,
  });
});

test('runMulticaInsightDistill forwards paths + persona to the python bridge and returns its JSON verbatim', async (t) => {
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const fakePython = path.join(dir, 'fake-python.sh');
  const argsLog = path.join(dir, 'args.log');
  await fs.writeFile(
    fakePython,
    `#!/bin/sh\necho "$@" > ${JSON.stringify(argsLog)}\nprintf '{"skipped": false, "written": "/tmp/fake.md", "kg_emitted": 2, "degraded": false, "error": null}'\n`,
    { mode: 0o755 },
  );

  const result = await runMulticaInsightDistill({
    hiveStateDir: dir,
    epicHandle: 'multica-learning-loop',
    storyId: 's2-insight-distill-harvest',
    workDir: '/repo/work',
    messagesPath: '/repo/messages.jsonl',
    selfCapturePath: '/repo/.hive/insights/s2-insight-distill-harvest.md',
    persona: 'backend-developer',
    pythonBin: fakePython,
  });

  assert.deepEqual(result, {
    skipped: false, written: '/tmp/fake.md', kg_emitted: 2, degraded: false, error: null,
  });

  const loggedArgs = await fs.readFile(argsLog, 'utf8');
  assert.match(loggedArgs, /-m hive\.lib\.insight_distill/);
  assert.match(loggedArgs, /--epic multica-learning-loop/);
  assert.match(loggedArgs, /--story s2-insight-distill-harvest/);
  assert.match(loggedArgs, /--persona backend-developer/);
  assert.match(loggedArgs, /--work-dir \/repo\/work/);
  assert.match(loggedArgs, /--self-capture \/repo\/\.hive\/insights\/s2-insight-distill-harvest\.md/);
  assert.match(loggedArgs, /--transcript \/repo\/messages\.jsonl/);
});

test('writeMulticaRunEpisode degrades gracefully when the distill bridge throws', async (t) => {
  const { writeMulticaRunEpisode } = await import('../episode-sync.mjs');
  const dir = await makeTempDir();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  const result = await writeMulticaRunEpisode({
    hiveStateDir: dir,
    epicHandle: 'test-epic',
    storyId: 'test-story',
    issueUuid: 'issue-uuid-1',
    identifier: 'HIV-1',
    terminal: {
      status: 'completed',
      messages: [],
      task_id: 'task-1',
      agent_id: 'agent-1',
      agent_name: 'developer',
      work_dir: '/no/such/dir',
      attempts: 1,
    },
    messagesCaptureMax: 200,
    distill: { persona: 'backend-developer', pythonBin: '/no/such/interpreter-binary' },
  });

  // The episode marker must still be written even though distill failed.
  const marker = await fs.readFile(result.markerPath, 'utf8');
  assert.match(marker, /^status: passed$/m);
  assert.equal(result.distill.ok, false);
});
