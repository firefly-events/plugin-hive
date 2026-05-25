import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  filterShotgunEligible,
  markCandidatesDone,
  groupByDir,
} from '../../lib/meta-team/backlog-mutator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW_PATH = path.join(REPO_ROOT, 'hive', 'workflows', 'meta-shotgun.workflow.yaml');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadYaml(filePath) {
  const script = [
    'import json, sys, yaml',
    'with open(sys.argv[1], "r", encoding="utf-8") as fh:',
    '    print(json.dumps(yaml.safe_load(fh) or {}))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', script, filePath], { encoding: 'utf8' }));
}

function makeTmpQueue(candidates) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-shotgun-test-'));
  const queuePath = path.join(tmp, 'queue.yaml');
  const lines = [
    'schema_version: 1',
    'candidates:',
    ...candidates.flatMap((c) => [
      `  - candidate_id: "${c.candidate_id}"`,
      `    target: "${c.target}"`,
      `    tier: "${c.tier}"`,
      `    status: "${c.status}"`,
      `    description: "${c.description ?? 'stub'}"`,
    ]),
  ];
  fs.writeFileSync(queuePath, lines.join('\n') + '\n', 'utf8');
  return { tmp, queuePath };
}

// ---------------------------------------------------------------------------
// Stub backlog: 3 little-fix candidates spanning 2 dirs
// ---------------------------------------------------------------------------
const STUB_CANDIDATES = [
  {
    candidate_id: 'lf-dir-a-001',
    target: 'hive/skills/foo/README.md',
    tier: 'little-fix',
    status: 'pending',
    description: 'Append a note to README.',
  },
  {
    candidate_id: 'lf-dir-a-002',
    target: 'hive/skills/foo/GUIDE.md',
    tier: 'little-fix',
    status: 'pending',
    description: 'Fix a typo in GUIDE.',
  },
  {
    candidate_id: 'lf-dir-b-001',
    target: 'hive/references/schema.md',
    tier: 'little-fix',
    status: 'pending',
    description: 'Append a clarification line.',
  },
];

// ---------------------------------------------------------------------------
// Workflow YAML structure
// ---------------------------------------------------------------------------

describe('meta-shotgun workflow YAML', () => {
  let workflow;

  before(() => {
    workflow = loadYaml(WORKFLOW_PATH);
  });

  it('file exists', () => {
    assert.ok(fs.existsSync(WORKFLOW_PATH), 'meta-shotgun.workflow.yaml must exist');
  });

  it('has name meta-shotgun', () => {
    assert.equal(workflow.name, 'meta-shotgun');
  });

  it('has required named steps', () => {
    const ids = (workflow.steps ?? []).map((s) => s.id);
    for (const required of ['filter', 'exclude-recent', 'apply', 'validate', 'commit-push', 'mark-done']) {
      assert.ok(ids.includes(required), `missing step: ${required}`);
    }
  });

  it('filter step emits little_fix_candidates', () => {
    const step = workflow.steps.find((s) => s.id === 'filter');
    const outputNames = (step.outputs ?? []).map((o) => o.name);
    assert.ok(outputNames.includes('little_fix_candidates'), 'filter must emit little_fix_candidates');
  });

  it('exclude-recent step depends on filter', () => {
    const step = workflow.steps.find((s) => s.id === 'exclude-recent');
    assert.ok((step.depends_on ?? []).includes('filter'));
  });

  it('commit-push step has when predicate gating on validation_passed', () => {
    const step = workflow.steps.find((s) => s.id === 'commit-push');
    assert.ok(step.when, 'commit-push must have a when predicate');
    assert.ok(step.when.includes('validation_passed'), 'when must reference validation_passed');
  });

  it('mark-done step depends on commit-push', () => {
    const step = workflow.steps.find((s) => s.id === 'mark-done');
    assert.ok((step.depends_on ?? []).includes('commit-push'));
  });

  it('mark-done step emits marked_done_count', () => {
    const step = workflow.steps.find((s) => s.id === 'mark-done');
    const outputNames = (step.outputs ?? []).map((o) => o.name);
    assert.ok(outputNames.includes('marked_done_count'));
  });
});

// ---------------------------------------------------------------------------
// filterShotgunEligible — tier=little-fix + status=pending selection
// ---------------------------------------------------------------------------

describe('filterShotgunEligible', () => {
  it('returns only tier=little-fix + status=pending candidates', () => {
    const candidates = [
      ...STUB_CANDIDATES,
      { candidate_id: 'structural-1', tier: 'structural', status: 'pending' },
      { candidate_id: 'lf-done', tier: 'little-fix', status: 'done' },
    ];
    const result = filterShotgunEligible(candidates);
    assert.equal(result.length, 3);
    assert.ok(result.every((c) => c.tier === 'little-fix' && c.status === 'pending'));
  });

  it('excludes structural and strategic candidates', () => {
    const candidates = [
      { candidate_id: 'a', tier: 'structural', status: 'pending' },
      { candidate_id: 'b', tier: 'strategic', status: 'pending' },
    ];
    assert.equal(filterShotgunEligible(candidates).length, 0);
  });

  it('handles null/undefined gracefully', () => {
    assert.deepEqual(filterShotgunEligible(null), []);
    assert.deepEqual(filterShotgunEligible(undefined), []);
  });
});

// ---------------------------------------------------------------------------
// groupByDir — 3 candidates across 2 dirs → 2 sections
// ---------------------------------------------------------------------------

describe('groupByDir — stub 3 little-fix candidates spanning 2 dirs', () => {
  let groups;

  before(() => {
    groups = groupByDir(STUB_CANDIDATES);
  });

  it('produces exactly 2 directory sections', () => {
    assert.equal(groups.size, 2, `expected 2 dirs, got ${groups.size}: ${[...groups.keys()].join(', ')}`);
  });

  it('dir hive/skills/foo has 2 candidates', () => {
    const candidates = groups.get('hive/skills/foo');
    assert.ok(candidates, 'hive/skills/foo must be a key in groups');
    assert.equal(candidates.length, 2);
  });

  it('dir hive/references has 1 candidate', () => {
    const candidates = groups.get('hive/references');
    assert.ok(candidates, 'hive/references must be a key in groups');
    assert.equal(candidates.length, 1);
  });

  it('all 3 candidates are represented across groups', () => {
    const total = [...groups.values()].reduce((sum, arr) => sum + arr.length, 0);
    assert.equal(total, 3);
  });
});

// ---------------------------------------------------------------------------
// markCandidatesDone — queue mutation
// ---------------------------------------------------------------------------

describe('markCandidatesDone', () => {
  let tmp, queuePath;

  before(() => {
    ({ tmp, queuePath } = makeTmpQueue(STUB_CANDIDATES));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('marks specified candidates done and returns their IDs', () => {
    const toMark = ['lf-dir-a-001', 'lf-dir-b-001'];
    const marked = markCandidatesDone(queuePath, toMark);
    assert.deepEqual(marked.sort(), toMark.sort());
  });

  it('status=done is written to file for marked candidates', () => {
    const raw = fs.readFileSync(queuePath, 'utf8');
    assert.ok(raw.includes('"lf-dir-a-001"'), 'candidate id must still exist');
    const lines = raw.split('\n');
    let inTarget = false;
    for (const line of lines) {
      if (line.includes('"lf-dir-a-001"')) inTarget = true;
      if (inTarget && line.match(/status:/)) {
        assert.ok(line.includes('"done"'), `expected status:done, got: ${line}`);
        inTarget = false;
      }
    }
  });

  it('unmarked candidate retains status=pending', () => {
    const raw = fs.readFileSync(queuePath, 'utf8');
    const lines = raw.split('\n');
    let inTarget = false;
    for (const line of lines) {
      if (line.includes('"lf-dir-a-002"')) inTarget = true;
      if (inTarget && line.match(/status:/)) {
        assert.ok(line.includes('"pending"'), `expected status:pending, got: ${line}`);
        inTarget = false;
      }
    }
  });

  it('returns empty array when candidateIds is empty', () => {
    assert.deepEqual(markCandidatesDone(queuePath, []), []);
  });

  it('does not error on unknown candidate IDs', () => {
    const marked = markCandidatesDone(queuePath, ['does-not-exist']);
    assert.deepEqual(marked, []);
  });
});

// ---------------------------------------------------------------------------
// Integration scenario: 3 candidates → 1 PR with 2 sections
// ---------------------------------------------------------------------------

describe('integration scenario: 3 little-fix candidates → 1 PR with 2 sections', () => {
  it('full pipeline produces 2 dir sections from 3 stub candidates', () => {
    const eligible = filterShotgunEligible(STUB_CANDIDATES);
    assert.equal(eligible.length, 3, 'all 3 stub candidates are eligible');

    const groups = groupByDir(eligible);
    assert.equal(groups.size, 2, '2 directory sections for the PR body');

    // Simulate PR body generation: one H2 per dir, alphabetical order
    const sortedDirs = [...groups.keys()].sort();
    assert.deepEqual(sortedDirs, ['hive/references', 'hive/skills/foo']);

    const prBodySections = sortedDirs.map((dir) => {
      const entries = groups.get(dir);
      return `## ${dir}\n${entries.map((c) => `- ${c.candidate_id}: ${c.description}`).join('\n')}`;
    });
    assert.equal(prBodySections.length, 2);
    assert.ok(prBodySections[0].startsWith('## hive/references'));
    assert.ok(prBodySections[1].startsWith('## hive/skills/foo'));
  });

  it('after mark-done, all 3 candidates become done in the queue', () => {
    const { tmp, queuePath } = makeTmpQueue(STUB_CANDIDATES);
    try {
      const eligible = filterShotgunEligible(STUB_CANDIDATES);
      const ids = eligible.map((c) => c.candidate_id);
      const marked = markCandidatesDone(queuePath, ids);
      assert.equal(marked.length, 3);
      // verify file has no remaining pending little-fix entries
      const raw = fs.readFileSync(queuePath, 'utf8');
      assert.ok(!raw.includes('"pending"'), 'no pending entries should remain after mark-done');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
