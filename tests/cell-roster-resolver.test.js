'use strict';
/**
 * Unit tests for hive/lib/cell-roster-resolver/
 *
 * Run: node --test tests/cell-roster-resolver.test.js
 *
 * AC-1  backend-tagged story → backend-developer replaces developer
 * AC-2  UI-tagged story → frontend-developer variant in roster
 * AC-3  no triggering signals → only core[] roles returned in order
 * AC-4  every roster slot carries a workflow-phase field (not bare "phase")
 * AC-5  replaces swaps role, preserves workflow-phase label
 * AC-6  appends_after inserts new slot after named workflow-phase
 */

const { describe, test, before } = require('node:test');
const assert = require('node:assert/strict');

// --- fixture cell definition (mirrors execute-cell.yaml shape) ---

const EXECUTE_CELL = {
  cell: 'execute',
  core: ['researcher', 'developer', 'tester', 'reviewer'],
  scope_signals: {
    backend: {
      keywords: ['api', 'database', 'server', 'backend', 'sql', 'endpoint', 'migration', 'orm'],
    },
    frontend: {
      keywords: [
        'ui', 'ux', 'component', 'react', 'frontend', 'screen', 'view', 'page',
        'modal', 'button', 'form', 'widget', 'layout', 'visual', 'wireframe',
      ],
    },
    security: {
      keywords: ['auth', 'security', 'xss', 'csrf', 'injection', 'vulnerability', 'cve', 'jwt', 'oauth'],
    },
  },
  optional: [
    { role: 'backend-developer', when: 'scope_signals.backend', replaces: 'developer' },
    { role: 'frontend-developer', when: 'scope_signals.frontend', replaces: 'developer' },
    { role: 'security-reviewer', when: 'scope_signals.security', appends_after: 'reviewer' },
    { role: 'peer-validator', when: 'planning.collaborative_review == true', appends_after: 'reviewer' },
  ],
};

// --- helpers ---

function roles(roster) {
  return roster.map((s) => s.role);
}

function phases(roster) {
  return roster.map((s) => s['workflow-phase']);
}

// --- suite ---

describe('cell-roster-resolver', () => {
  // Dynamic import — resolveRoster is in an ESM module.
  let resolveRoster;

  before(async () => {
    const mod = await import('../hive/lib/cell-roster-resolver/index.mjs');
    resolveRoster = mod.resolveRoster;
  });

  test('AC-3: no signals → only core[] roles in declaration order', () => {
    const story = { title: 'Simple refactor', description: 'Clean up unused imports.' };
    const roster = resolveRoster(story, EXECUTE_CELL);
    assert.deepEqual(roles(roster), ['researcher', 'developer', 'tester', 'reviewer']);
  });

  test('AC-1: backend-tagged story → backend-developer replaces developer', () => {
    const story = {
      title: 'Add REST API endpoint',
      description: 'Implement a new database migration and server endpoint for the user resource.',
    };
    const roster = resolveRoster(story, EXECUTE_CELL);
    assert.ok(roster.some((s) => s.role === 'backend-developer'), 'backend-developer must appear');
    assert.ok(!roster.some((s) => s.role === 'developer'), 'developer slot must be replaced');
  });

  test('AC-2: UI-tagged story → frontend-developer variant in roster', () => {
    const story = {
      title: 'Redesign settings screen',
      description: 'Update the UI component layout and form inputs for the settings view.',
    };
    const roster = resolveRoster(story, EXECUTE_CELL);
    assert.ok(roster.some((s) => s.role === 'frontend-developer'), 'frontend-developer must appear');
    assert.ok(!roster.some((s) => s.role === 'developer'), 'developer slot must be replaced');
  });

  test('AC-4: every roster slot carries workflow-phase field, never bare "phase"', () => {
    const stories = [
      { title: 'No signals here', description: 'Plain story.' },
      { title: 'Backend API endpoint', description: 'database migration and server.' },
      { title: 'UI redesign page', description: 'New view and component layout.' },
      {
        title: 'Auth security audit',
        description: 'Check for JWT vulnerabilities.',
        planning: { collaborative_review: true },
      },
    ];
    for (const story of stories) {
      const roster = resolveRoster(story, EXECUTE_CELL);
      for (const slot of roster) {
        assert.ok('workflow-phase' in slot, `slot missing workflow-phase: ${JSON.stringify(slot)}`);
        assert.ok(!('phase' in slot), `slot must not have bare "phase" key: ${JSON.stringify(slot)}`);
      }
    }
  });

  test('AC-5: replaces preserves the original workflow-phase label', () => {
    const story = { title: 'Add backend API', description: 'Server endpoint and database.' };
    const roster = resolveRoster(story, EXECUTE_CELL);
    const beSlot = roster.find((s) => s.role === 'backend-developer');
    assert.ok(beSlot, 'backend-developer slot must exist');
    assert.equal(beSlot['workflow-phase'], 'developer', 'workflow-phase must remain "developer"');
  });

  test('AC-6: appends_after inserts new slot after the named workflow-phase', () => {
    const story = {
      title: 'Improve auth security',
      description: 'Fix JWT oauth vulnerability and add CSRF protection.',
    };
    const roster = resolveRoster(story, EXECUTE_CELL);
    const reviewerIdx = roster.findIndex((s) => s['workflow-phase'] === 'reviewer');
    const secIdx = roster.findIndex((s) => s.role === 'security-reviewer');
    assert.ok(secIdx > reviewerIdx, 'security-reviewer must appear after reviewer');
  });

  test('core[] order preserved when no optional signals fire', () => {
    const story = { title: 'Documentation update', description: 'Fix typo in README.' };
    const roster = resolveRoster(story, EXECUTE_CELL);
    assert.deepEqual(roles(roster), ['researcher', 'developer', 'tester', 'reviewer']);
    assert.deepEqual(phases(roster), ['researcher', 'developer', 'tester', 'reviewer']);
  });

  test('planning.collaborative_review fires peer-validator appended after reviewer', () => {
    const story = {
      title: 'Routine fix',
      description: 'Minor cleanup.',
      planning: { collaborative_review: true },
    };
    const roster = resolveRoster(story, EXECUTE_CELL);
    const reviewerIdx = roster.findIndex((s) => s['workflow-phase'] === 'reviewer');
    const peerIdx = roster.findIndex((s) => s.role === 'peer-validator');
    assert.ok(peerIdx > reviewerIdx, 'peer-validator must appear after reviewer');
  });
});
