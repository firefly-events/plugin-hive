/**
 * Contract tests for buildSystemPrompt() in hive/lib/session-prompt-builder.js
 *
 * Story s6-a3-prior-knowledge-block. TDD: written RED before implementation.
 * Run: node tests/hive-lib/session-prompt-builder.prior-knowledge.test.js
 *
 * Four cases (per slice spec steps[0]):
 *   a) truncation rule — oversize memories trimmed deterministically per §3
 *   b) two-call merge (story_id ∪ agent_role, dedupe, ordering) per §6
 *   c) runtime-agnostic output shape (Messages-API == Sessions-API consumer)
 *   d) injection-allowlist guard — SQL-meta and shell-meta payloads in
 *      story_id / agent_role return empty rows, never reach the SQL builder
 *
 * Authoritative refs:
 *   - hive/references/session-system-prompt-spec.md §3 (prior knowledge),
 *     §6 (two-call merge), §7 (runtime-agnostic invariant)
 *   - hive/references/knowledge-graph-schema.md (Triple shape)
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const MODULE_PATH = path.join(__dirname, '..', '..', 'hive', 'lib', 'session-prompt-builder.js');

function loadModule() {
  delete require.cache[require.resolve(MODULE_PATH)];
  return require(MODULE_PATH);
}

/**
 * Build a fixture KG handle whose query_decisions() returns scripted triples.
 * Records each call so tests can assert two-call invariant and arg shape.
 */
function makeFakeKg(scriptedByEntity) {
  const calls = [];
  return {
    calls,
    query_decisions(filter) {
      calls.push(filter);
      const entity = filter && filter.entity;
      const triples = scriptedByEntity[entity];
      if (Array.isArray(triples)) return triples.slice();
      return [];
    },
  };
}

/**
 * Triple shape per knowledge-graph-schema.md: pinned to the actual return
 * type so any drift (e.g., missing valid_from) breaks the fixture early.
 */
function triple({ subject, predicate, object, valid_from, valid_until = null, source_epic = 'cwc-2026-integration', source_agent = 'tester' }) {
  return { subject, predicate, object, valid_from, valid_until, source_epic, source_agent };
}

// ---------------------------------------------------------------------------
// Case (a): truncation rule
// ---------------------------------------------------------------------------
test('case a — oldest memories drop first; override/pitfall always retained; reference truncated to 200 chars', () => {
  const { buildSystemPrompt } = loadModule();

  const longBody = 'x'.repeat(800);
  const memories = [
    { name: 'old-reference', type: 'reference', last_verified: '2025-01-01', content: longBody },
    { name: 'newer-reference', type: 'reference', last_verified: '2026-04-01', content: longBody },
    { name: 'critical-pitfall', type: 'pitfall', last_verified: '2025-06-01', content: 'Always validate inputs before sqlite shell-out.' },
    { name: 'override-rule', type: 'override', last_verified: '2024-12-01', content: 'Use Codex for dev, Opus for review.' },
    { name: 'mid-codebase', type: 'codebase', last_verified: '2026-02-01', content: longBody },
  ];

  const kg = makeFakeKg({});

  const result = buildSystemPrompt({
    story_id: 's6-a3-prior-knowledge-block',
    agent_role: 'developer',
    kg,
    memories,
    persona: 'persona-text',
    domain_patterns: ['hive/lib/'],
    budget_chars: 1500, // tight budget to force truncation deterministically
  });

  assert.equal(typeof result, 'object', 'returns an object');
  assert.equal(typeof result.system, 'string', 'system slot is a string');
  const sys = result.system;

  // override + pitfall always present in full
  assert.ok(sys.includes('critical-pitfall'), 'pitfall retained');
  assert.ok(sys.includes('Always validate inputs before sqlite shell-out.'), 'pitfall content retained in full');
  assert.ok(sys.includes('override-rule'), 'override retained');
  assert.ok(sys.includes('Use Codex for dev, Opus for review.'), 'override content retained in full');

  // reference and codebase types: truncated to 200 chars per §3 step 2
  // (the long 800-char body must NOT appear in full)
  const longBodyHits = (sys.match(/x{800}/g) || []).length;
  assert.equal(longBodyHits, 0, 'no reference/codebase memory survives at full 800 chars');

  // truncation signal appears when truncation occurred
  assert.ok(/\[\d+ memor(y|ies) truncated for length\]/.test(sys), 'truncation signal present');

  // determinism: oldest by last_verified drops first if budget still tight after step 2.
  // 'old-reference' (2025-01-01) is oldest reference; if any reference dropped, this one
  // must be dropped before 'newer-reference' (2026-04-01).
  const oldKept = sys.includes('old-reference');
  const newKept = sys.includes('newer-reference');
  if (!(oldKept && newKept)) {
    assert.ok(newKept || !oldKept, 'oldest reference drops before newer reference (deterministic)');
  }
});

// ---------------------------------------------------------------------------
// Case (b): two-call merge — dedupe, ordering, story-before-role
// ---------------------------------------------------------------------------
test('case b — query_decisions called twice (story_id then agent_role); dedupe identical triples; story-scoped sorts before role-scoped', () => {
  const { buildSystemPrompt } = loadModule();

  const sharedTriple = triple({
    subject: 'cwc-2026-integration',
    predicate: 'decided',
    object: 'use-messages-api-substrate',
    valid_from: '2026-05-09T10:00:00Z',
  });

  const storyOnly = triple({
    subject: 's6-a3-prior-knowledge-block',
    predicate: 'depends_on',
    object: 's4-a1-session-spec-rewrite',
    valid_from: '2026-05-08T09:00:00Z',
  });

  const roleOnly = triple({
    subject: 'developer',
    predicate: 'decided',
    object: 'tdd-discipline',
    valid_from: '2026-05-07T09:00:00Z',
  });

  const kg = makeFakeKg({
    's6-a3-prior-knowledge-block': [storyOnly, sharedTriple],
    'developer': [sharedTriple, roleOnly],
  });

  const result = buildSystemPrompt({
    story_id: 's6-a3-prior-knowledge-block',
    agent_role: 'developer',
    kg,
    memories: [],
    persona: 'persona-text',
    domain_patterns: ['hive/lib/'],
  });

  // two-call invariant
  assert.equal(kg.calls.length, 2, 'query_decisions invoked exactly twice');
  assert.deepEqual(kg.calls[0], { entity: 's6-a3-prior-knowledge-block' }, 'first call: entity = story_id');
  assert.deepEqual(kg.calls[1], { entity: 'developer' }, 'second call: entity = agent_role');

  const sys = result.system;

  // shared triple appears exactly once (deduped)
  const sharedMatches = (sys.match(/use-messages-api-substrate/g) || []).length;
  assert.equal(sharedMatches, 1, 'shared triple deduped to a single rendering');

  // story-scoped before role-scoped: storyOnly's object must precede roleOnly's object in output
  const storyIdx = sys.indexOf('s4-a1-session-spec-rewrite');
  const roleIdx = sys.indexOf('tdd-discipline');
  assert.ok(storyIdx >= 0, 'story-scoped triple rendered');
  assert.ok(roleIdx >= 0, 'role-scoped triple rendered');
  assert.ok(storyIdx < roleIdx, `story-scoped (${storyIdx}) sorts before role-scoped (${roleIdx})`);

  // shared triple is rendered once and lives in the story group (per §6: "rendered once
  // in the story group and dropped from the role group")
  const sharedIdx = sys.indexOf('use-messages-api-substrate');
  assert.ok(sharedIdx < roleIdx, 'shared triple lives in story group, before role group');
});

// ---------------------------------------------------------------------------
// Case (c): runtime-agnostic shape — same {system} consumed by both runtimes
// ---------------------------------------------------------------------------
test('case c — output shape is {system: string} only; no Messages-API or Sessions-API specific fields', () => {
  const { buildSystemPrompt } = loadModule();

  const memories = [
    { name: 'mem-1', type: 'pitfall', last_verified: '2026-04-01', content: 'short pitfall' },
  ];

  const triples = [
    triple({
      subject: 's6-a3-prior-knowledge-block',
      predicate: 'decided',
      object: 'inject-prior-knowledge-in-system-slot',
      valid_from: '2026-05-09T10:00:00Z',
    }),
  ];

  const kg = makeFakeKg({ 's6-a3-prior-knowledge-block': triples });

  const result = buildSystemPrompt({
    story_id: 's6-a3-prior-knowledge-block',
    agent_role: 'developer',
    kg,
    memories,
    persona: '# Developer\nYou ship code.',
    domain_patterns: ['hive/lib/'],
  });

  const keys = Object.keys(result).sort();
  assert.deepEqual(keys, ['system'], `output has only {system}; got: ${keys.join(',')}`);
  assert.equal(typeof result.system, 'string');
  assert.ok(result.system.length > 0, 'system string is non-empty');

  // Runtime-agnostic invariant: the Sessions-API cloud adapter (§7) and the
  // Messages-API loop (§1) both consume the SAME composed string. The shape
  // must NOT contain runtime-specific fields like `messages`, `tools`,
  // `agent_id`, `environment_id`, or `bootstrap`.
  for (const forbidden of ['messages', 'tools', 'agent_id', 'environment_id', 'bootstrap']) {
    assert.equal(result[forbidden], undefined, `output must not include ${forbidden} (runtime-specific)`);
  }
});

// ---------------------------------------------------------------------------
// Case (d): injection-allowlist guard
// ---------------------------------------------------------------------------
test('case d — SQL-meta and shell-meta payloads in story_id / agent_role return empty rows; never reach the SQL builder', () => {
  const { buildSystemPrompt } = loadModule();

  // Sentinel triple keyed under the EXACT raw payload — would only be returned
  // if the builder bypassed sanitization and forwarded raw input verbatim.
  const sqlPayload = "'; DROP TABLE triples;--";
  const shellPayload = '$(rm -rf /)';

  const kg = makeFakeKg({
    [sqlPayload]: [
      triple({
        subject: sqlPayload,
        predicate: 'decided',
        object: 'PWNED-SQL',
        valid_from: '2026-05-09T10:00:00Z',
      }),
    ],
    [shellPayload]: [
      triple({
        subject: shellPayload,
        predicate: 'decided',
        object: 'PWNED-SHELL',
        valid_from: '2026-05-09T10:00:00Z',
      }),
    ],
  });

  // Attempt 1: SQL-meta in story_id
  const r1 = buildSystemPrompt({
    story_id: sqlPayload,
    agent_role: 'developer',
    kg,
    memories: [],
    persona: 'p',
    domain_patterns: [],
  });
  assert.ok(!r1.system.includes('PWNED-SQL'), 'SQL-meta payload must not match a sentinel triple');

  // Attempt 2: shell-meta in agent_role
  const r2 = buildSystemPrompt({
    story_id: 's6-a3-prior-knowledge-block',
    agent_role: shellPayload,
    kg,
    memories: [],
    persona: 'p',
    domain_patterns: [],
  });
  assert.ok(!r2.system.includes('PWNED-SHELL'), 'shell-meta payload must not match a sentinel triple');

  // Sanitization invariant: the entity values forwarded to query_decisions
  // must conform to the allowlist [a-zA-Z0-9\-_] — no quotes, semicolons,
  // dollar signs, parens, slashes, or spaces.
  const allowlist = /^[a-zA-Z0-9\-_]*$/;
  for (const call of kg.calls) {
    assert.ok(
      allowlist.test(call.entity),
      `entity reaching query_decisions violates allowlist: ${JSON.stringify(call.entity)}`
    );
  }
});
