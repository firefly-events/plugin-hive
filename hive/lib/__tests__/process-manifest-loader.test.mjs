/**
 * Tests for hive/lib/process-manifest-loader.mjs and hive/lib/cc-manifest-adapter.mjs
 *
 * Covers:
 *  (a) loadManifests() from the real hive/manifests/ dir — plan manifest loads
 *  (b) listWorkflows() returns expected shape
 *  (c) getManifest('plan') returns the plan manifest
 *  (d) Validation rejects structurally invalid manifests
 *  (e) Non-CC executor path: step enumeration from raw manifest object
 *  (f) resolveCCSkill() returns correct paths for each substrate
 *  (g) resolveCCSkill() falls back to 'default' for unknown substrates
 *
 * Convention: node:test + node:assert/strict (matches the 37-file repo majority;
 * vitest is not a declared dependency).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  loadManifests,
  getManifest,
  listWorkflows,
} from '../process-manifest-loader.mjs';

import {
  resolveCCSkill,
  listCCSkillAdapters,
} from '../cc-manifest-adapter.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpManifestsDir(manifests = []) {
  const dir = mkdtempSync(join(tmpdir(), 'hive-manifest-test-'));
  for (const { filename, content } of manifests) {
    writeFileSync(join(dir, filename), content, 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// (a) loadManifests() from the real manifests directory
// ---------------------------------------------------------------------------

describe('loadManifests() — real manifests dir', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('loads without throwing', () => {
    const registry = loadManifests();
    assert.notStrictEqual(registry, undefined);
    assert.ok(registry.size >= 1);
  });

  it('includes the plan workflow', () => {
    const registry = loadManifests();
    assert.strictEqual(registry.has('plan'), true);
  });
});

// ---------------------------------------------------------------------------
// (b) listWorkflows()
// ---------------------------------------------------------------------------

describe('listWorkflows()', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('returns an array of workflow summaries', () => {
    const list = listWorkflows();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 1);

    const plan = list.find((w) => w.id === 'plan');
    assert.notStrictEqual(plan, undefined);
    assert.strictEqual(typeof plan.name, 'string');
    assert.strictEqual(typeof plan.source, 'string');
    assert.match(plan.source, /plan\.process\.yaml$/);
  });
});

// ---------------------------------------------------------------------------
// (c) getManifest('plan')
// ---------------------------------------------------------------------------

describe('getManifest()', () => {
  beforeEach(() => loadManifests({ _reset: true }));

  it('returns the plan manifest with expected shape', () => {
    const { manifest, source } = getManifest('plan');
    assert.strictEqual(manifest.id, 'plan');
    assert.match(manifest.name, /plan/i);
    assert.strictEqual(typeof manifest.version, 'string');
    assert.ok(Array.isArray(manifest.steps));
    assert.ok(manifest.steps.length > 0);
    assert.strictEqual(typeof manifest.adapters, 'object');
    assert.match(source, /plan\.process\.yaml$/);
  });

  it('plan manifest has default, multica, cc-workflows, and hive-dag adapters', () => {
    const { manifest } = getManifest('plan');
    assert.ok('default' in manifest.adapters);
    assert.ok('multica' in manifest.adapters);
    assert.ok('cc-workflows' in manifest.adapters);
    assert.ok('hive-dag' in manifest.adapters);
  });

  it('plan steps include research, design, design-gate, author', () => {
    const { manifest } = getManifest('plan');
    const ids = manifest.steps.map((s) => s.id);
    assert.ok(ids.includes('research'));
    assert.ok(ids.includes('design'));
    assert.ok(ids.includes('design-gate'));
    assert.ok(ids.includes('author'));
  });

  it('throws for unknown workflow id', () => {
    assert.throws(
      () => getManifest('nonexistent-workflow-xyz'),
      /no manifest for workflow/
    );
  });
});

// ---------------------------------------------------------------------------
// (d) Validation rejects invalid manifests
// ---------------------------------------------------------------------------

describe('validation — invalid manifests', () => {
  it('rejects a manifest with non-kebab id', () => {
    const dir = makeTmpManifestsDir([
      { filename: 'Bad_Name.process.yaml', content: `id: Bad_Name\nname: x\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n` },
    ]);
    assert.throws(() => loadManifests({ _manifestsDir: dir, _reset: true }), /kebab-case/);
  });

  it('rejects a manifest with no adapters.default', () => {
    const dir = makeTmpManifestsDir([
      { filename: 'foo.process.yaml', content: `id: foo\nname: Foo\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  multica:\n    type: cc-skill\n    skill: x.md\n` },
    ]);
    assert.throws(() => loadManifests({ _manifestsDir: dir, _reset: true }), /adapters.default is required/);
  });

  it('rejects a manifest with duplicate step ids', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'dup.process.yaml',
        content: `id: dup\nname: Dup\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    assert.throws(() => loadManifests({ _manifestsDir: dir, _reset: true }), /duplicate step ids/);
  });

  it('rejects a manifest where depends_on references an unknown step', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'bad-dep.process.yaml',
        content: `id: bad-dep\nname: Bad\nversion: "1.0"\nsteps:\n  - id: a\n    role: r\n    depends_on: [ghost]\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    assert.throws(() => loadManifests({ _manifestsDir: dir, _reset: true }), /depends_on unknown step/);
  });

  it('rejects a manifest whose filename stem does not match its id', () => {
    const dir = makeTmpManifestsDir([
      {
        filename: 'other-name.process.yaml',
        content: `id: foo\nname: Foo\nversion: "1.0"\nsteps:\n  - id: s\n    role: r\nadapters:\n  default:\n    type: cc-skill\n    skill: x.md\n`,
      },
    ]);
    assert.throws(
      () => loadManifests({ _manifestsDir: dir, _reset: true }),
      /filename stem.*does not match manifest id/
    );
  });
});

// ---------------------------------------------------------------------------
// (e) Non-CC executor path: step enumeration from manifest object
// ---------------------------------------------------------------------------

describe('non-CC executor path — step enumeration', () => {
  it('a non-CC executor can enumerate steps and gates without CC context', () => {
    const { manifest } = getManifest('plan');

    // A non-CC executor only needs to read manifest.steps — no CC SDK, no hooks.
    const gateSteps = manifest.steps.filter(
      (s) => s.node_type === 'user_gate' || s.node_type === 'gate'
    );
    assert.ok(gateSteps.length > 0);

    const agentSteps = manifest.steps.filter((s) => !s.node_type || s.node_type === 'agent');
    assert.ok(agentSteps.length > 0);

    // Every step can be inspected for its id, role, and depends_on
    for (const step of manifest.steps) {
      assert.strictEqual(typeof step.id, 'string');
      assert.strictEqual(typeof step.role, 'string');
      assert.ok(Array.isArray(step.depends_on ?? []));
    }
  });

  it('non-CC executor can find a dag-workflow adapter without any cc-skill knowledge', () => {
    const { manifest } = getManifest('plan');
    const dagAdapter = manifest.adapters['hive-dag'];
    assert.notStrictEqual(dagAdapter, undefined);
    assert.strictEqual(dagAdapter.type, 'dag-workflow');
    assert.match(dagAdapter.workflow, /\.yaml$/);
  });
});

// ---------------------------------------------------------------------------
// (f) resolveCCSkill() returns correct paths
// ---------------------------------------------------------------------------

describe('resolveCCSkill()', () => {
  let planManifest;
  beforeEach(() => {
    planManifest = getManifest('plan', { _reset: true }).manifest;
  });

  it('resolves default substrate to skills/plan/SKILL.md', () => {
    assert.strictEqual(resolveCCSkill(planManifest, 'default'), 'skills/plan/SKILL.md');
  });

  it('resolves multica substrate', () => {
    assert.strictEqual(
      resolveCCSkill(planManifest, 'multica'),
      'skills/hive/skills/plan-mode-multica/SKILL.md'
    );
  });

  it('resolves cc-workflows substrate', () => {
    assert.strictEqual(
      resolveCCSkill(planManifest, 'cc-workflows'),
      'skills/hive/skills/plan-mode-cc-workflows/SKILL.md'
    );
  });

  it('falls back to default for unknown substrate', () => {
    assert.strictEqual(resolveCCSkill(planManifest, 'unknown-substrate'), 'skills/plan/SKILL.md');
  });

  it('throws when called on a dag-workflow adapter without a cc-skill fallback path', () => {
    const noDefault = {
      id: 'mock',
      adapters: {
        default: { type: 'dag-workflow', workflow: 'hive/workflows/mock.yaml' },
      },
    };
    assert.throws(() => resolveCCSkill(noDefault, 'default'), /not "cc-skill"/);
  });
});

// ---------------------------------------------------------------------------
// (g) listCCSkillAdapters()
// ---------------------------------------------------------------------------

describe('listCCSkillAdapters()', () => {
  it('returns default, multica, and cc-workflows entries for plan', () => {
    const { manifest } = getManifest('plan');
    const cc = listCCSkillAdapters(manifest);
    const substrates = cc.map((a) => a.substrate).sort();
    assert.ok(substrates.includes('default'));
    assert.ok(substrates.includes('multica'));
    assert.ok(substrates.includes('cc-workflows'));
    // hive-dag is dag-workflow type, should NOT appear
    assert.ok(!substrates.includes('hive-dag'));
  });
});
