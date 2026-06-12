/**
 * Regression: a release_id-stamped `status: shipped` YAML projection is
 * terminal and outranks episode markers (fix/status-no-downgrade).
 *
 * Failure mode this guards: Multica-mode runs write intermediate episode
 * markers but no terminal marker, so marker-driven derivation returned
 * in_progress for already-released stories — and the reconcile workflow
 * then downgraded accurate shipped projections (bogus PR #282 after v2.11.0).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deriveStoryStatus } from '../../hive/lib/story-status.mjs';

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-status-shipped-'));
  const storyDir = path.join(dir, '.pHive', 'epics', 'demo-epic', 'stories');
  fs.mkdirSync(storyDir, { recursive: true });
  return dir;
}

function writeStory(repo, { status, releaseId, withMarker }) {
  const storyPath = path.join(repo, '.pHive', 'epics', 'demo-epic', 'stories', 'st-1.yaml');
  fs.writeFileSync(storyPath, [
    'id: st-1',
    'epic: demo-epic',
    'title: demo story',
    `status: ${status}`,
    ...(releaseId ? [`release_id: "${releaseId}"`] : []),
    'steps:',
    '- id: implement',
    '  agent: developer',
    '- id: integrate',
    '  agent: developer',
    '',
  ].join('\n'));
  if (withMarker) {
    // Intermediate marker only — terminal step (integrate) never completed.
    const epDir = path.join(repo, '.pHive', 'episodes', 'demo-epic', 'st-1');
    fs.mkdirSync(epDir, { recursive: true });
    fs.writeFileSync(path.join(epDir, 'implement.yaml'), [
      'story_id: st-1',
      'step_id: implement',
      'status: completed',
      '',
    ].join('\n'));
  }
}

test('shipped + release_id outranks non-terminal markers', () => {
  const repo = makeRepo();
  writeStory(repo, { status: 'shipped', releaseId: 'v2.11.0', withMarker: true });
  const got = deriveStoryStatus({ epic_id: 'demo-epic', story_id: 'st-1', repo_root: repo });
  assert.equal(got, 'shipped');
});

test('shipped without release_id does NOT short-circuit (marker derivation wins)', () => {
  const repo = makeRepo();
  writeStory(repo, { status: 'shipped', releaseId: null, withMarker: true });
  const got = deriveStoryStatus({ epic_id: 'demo-epic', story_id: 'st-1', repo_root: repo });
  assert.equal(got, 'in_progress');
});

test('depends_on treats shipped dependency as complete', () => {
  const repo = makeRepo();
  writeStory(repo, { status: 'shipped', releaseId: 'v2.11.0', withMarker: true }); // st-1

  const parentPath = path.join(repo, '.pHive', 'epics', 'demo-epic', 'stories', 'st-2.yaml');
  fs.writeFileSync(parentPath, [
    'id: st-2',
    'epic: demo-epic',
    'title: parent story',
    'status: pending',
    'depends_on: [st-1]',
    'steps:',
    '- id: implement',
    '  agent: developer',
    '',
  ].join('\n'));

  const got = deriveStoryStatus({ epic_id: 'demo-epic', story_id: 'st-2', repo_root: repo });
  assert.equal(got, 'pending'); // not blocked when dep is shipped
});

test('non-shipped YAML still derives from markers as before', () => {
  const repo = makeRepo();
  writeStory(repo, { status: 'in_progress', releaseId: null, withMarker: true });
  const got = deriveStoryStatus({ epic_id: 'demo-epic', story_id: 'st-1', repo_root: repo });
  assert.equal(got, 'in_progress');
});
