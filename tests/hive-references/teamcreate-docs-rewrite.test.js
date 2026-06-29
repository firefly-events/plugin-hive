/**
 * Contract tests for story s3-reference-docs-rewrite (epic teamcreate-migration).
 *
 * Claude Code v2.1.178 deleted the TeamCreate tool and replaced it with a
 * natural-language auto-spawn model: the lead describes the team in prose and
 * the runtime materializes teammates automatically — no tool call. Three
 * reference/glossary documents still described TeamCreate mechanics and shipped
 * an internally contradictory documentation state. This story rewrites them:
 *
 *   - hive/references/agent-teams-guide.md   (default-path mechanics → auto-spawn)
 *   - hive/references/parallel-call-sites.md (mechanism column → teammate spawn)
 *   - .pHive/CONTEXT.md                       (Backend glossary + routing warning)
 *
 * Run: node --test tests/hive-references/teamcreate-docs-rewrite.test.js
 *
 * Each test maps to a story acceptance criterion (AC1..AC8). The tests are
 * behavioral: they assert on the published contract of the documents (the prose
 * a reader receives, the catalog IDs gate code depends on, the glossary
 * definition) — not on implementation internals.
 *
 * SCOPE NOTE (AC8): s3 owns exactly the three files above. Other files under
 * hive/references/ (skill-prelude.md, configuration.md, session-resilience.md)
 * still mention TeamCreate because they document the sessions/respawn execution
 * path, which is out of s3's documentation-area-C scope and belongs to other
 * stories. AC8's intent — "the rewritten docs no longer leak TeamCreate" — is
 * encoded as: every s3-owned reference file is clean, and no remaining hit under
 * hive/references/ lands in an s3-owned file. The residue is asserted to be
 * confined to the known out-of-scope set so a missed s3 target would still fail.
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const REFERENCES_DIR = path.join(REPO_ROOT, 'hive', 'references');
const AGENT_TEAMS_GUIDE = path.join(REFERENCES_DIR, 'agent-teams-guide.md');
const PARALLEL_CALL_SITES = path.join(REFERENCES_DIR, 'parallel-call-sites.md');
const CONTEXT_MD = path.join(REPO_ROOT, '.pHive', 'CONTEXT.md');

function readFile(p) {
  return fs.readFileSync(p, 'utf8');
}

/**
 * Return the lines of a file that contain `needle`, as `{ n, text }` objects
 * (1-based line numbers). Mirrors `grep -n` so the assertion messages read like
 * the story's verification greps.
 */
function grepLines(file, needle) {
  return readFile(file)
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }))
    .filter((l) => l.text.includes(needle));
}

// --- AC1: agent-teams-guide.md no longer instructs the reader to call TeamCreate
//          for the default execution path (and the default path is auto-spawn) ---
test('AC1: agent-teams-guide.md default path describes auto-spawn, never instructs a TeamCreate call', () => {
  const markdown = readFile(AGENT_TEAMS_GUIDE);

  const teamCreateHits = grepLines(AGENT_TEAMS_GUIDE, 'TeamCreate');
  assert.equal(
    teamCreateHits.length,
    0,
    `agent-teams-guide.md must not name the deleted TeamCreate tool; found:\n${teamCreateHits
      .map((l) => `  ${l.n}: ${l.text.trim()}`)
      .join('\n')}`,
  );

  // The default-path mechanics section must positively describe the auto-spawn
  // model (runtime materializes teammates from the lead's prose, no tool call).
  assert.match(
    markdown,
    /auto-spawn/i,
    'agent-teams-guide.md must describe the auto-spawn model for the default path',
  );
  assert.match(
    markdown,
    /no (explicit )?team-creation tool call|no tool call|auto-spawns? the teammates|materializes? (the )?teammates/i,
    'agent-teams-guide.md must state the default path needs no explicit team-creation tool call',
  );
});

// --- AC2: cmux path is labeled a separate variant, not the default model ---
test('AC2: agent-teams-guide.md labels the cmux path as a separate variant, not the default', () => {
  const markdown = readFile(AGENT_TEAMS_GUIDE);

  // cmux must be introduced under an explicitly "alternative / variant" label.
  assert.match(
    markdown,
    /Alternative:[^\n]*cmux|cmux[^\n]*Variant/i,
    'agent-teams-guide.md must label the cmux path as an Alternative / Variant heading',
  );

  // And it must be stated in prose that cmux is NOT the default auto-spawn path.
  assert.match(
    markdown,
    /separate variant, not the default|not the default auto-spawn path/i,
    'agent-teams-guide.md must state explicitly that cmux is not the default auto-spawn path',
  );
});

// --- AC3: post-edit grep for TeamCreate is zero in default-team-creation
//          sections; the env-gate lines (s4 scope) are left intact ---
test('AC3: agent-teams-guide.md has zero TeamCreate hits while env-gate detection lines are untouched', () => {
  // Zero TeamCreate hits in the whole file (env-gate lines reference the env var
  // name, never the TeamCreate tool, so they are not a TeamCreate hit anyway).
  const teamCreateHits = grepLines(AGENT_TEAMS_GUIDE, 'TeamCreate');
  assert.equal(
    teamCreateHits.length,
    0,
    `agent-teams-guide.md default-path sections must contain zero TeamCreate hits; found:\n${teamCreateHits
      .map((l) => `  ${l.n}: ${l.text.trim()}`)
      .join('\n')}`,
  );

  // The env-gate detection lines reserved for s4 must still be present — s3 must
  // not have edited them away. They are identified by the env var name.
  const envGateHits = grepLines(AGENT_TEAMS_GUIDE, 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS');
  assert.ok(
    envGateHits.length >= 1,
    'agent-teams-guide.md must still contain the CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env-gate lines (reserved for s4)',
  );
});

// --- AC4: parallel-call-sites.md trigger IDs are unchanged ---
test('AC4: parallel-call-sites.md preserves the gate-referenced trigger IDs verbatim', () => {
  const markdown = readFile(PARALLEL_CALL_SITES);
  const requiredIds = [
    'execute:team',
    'plan:design-discussion-team',
    'planning-routing:mixed-team',
    'execute:specialist-phases',
  ];
  for (const id of requiredIds) {
    assert.ok(
      markdown.includes(id),
      `parallel-call-sites.md must keep the trigger ID "${id}" verbatim (referenced by gate code)`,
    );
  }
});

// --- AC5: parallel-call-sites.md mechanism descriptions no longer say TeamCreate ---
test('AC5: parallel-call-sites.md mechanism column no longer references TeamCreate', () => {
  const teamCreateHits = grepLines(PARALLEL_CALL_SITES, 'TeamCreate');
  assert.equal(
    teamCreateHits.length,
    0,
    `parallel-call-sites.md must not reference the deleted TeamCreate tool; found:\n${teamCreateHits
      .map((l) => `  ${l.n}: ${l.text.trim()}`)
      .join('\n')}`,
  );

  // The migrated mechanism vocabulary must be present (natural-language spawn).
  assert.match(
    readFile(PARALLEL_CALL_SITES),
    /natural-language teammate spawn|Natural-language teammate spawn/,
    'parallel-call-sites.md must describe mechanisms as natural-language teammate spawn',
  );
});

// --- AC6: CONTEXT.md Backend entry no longer defines 'direct' as Claude via TeamCreate ---
test('AC6: CONTEXT.md Backend glossary entry defines direct as auto-spawn, not TeamCreate', () => {
  const lines = readFile(CONTEXT_MD).split('\n');
  const backendLine = lines.find((l) => /^- \*\*Backend\*\*/.test(l));
  assert.ok(backendLine, 'CONTEXT.md must retain a **Backend** glossary entry');

  assert.ok(
    !/TeamCreate/.test(backendLine),
    `CONTEXT.md Backend entry must not define "direct" via the deleted TeamCreate tool; got: "${backendLine.trim()}"`,
  );
  assert.match(
    backendLine,
    /direct/,
    'CONTEXT.md Backend entry must still name the "direct" backend',
  );
  assert.match(
    backendLine,
    /auto-spawned agent teams|natural-language prompt/i,
    `CONTEXT.md Backend entry must define direct as Claude via auto-spawned agent teams; got: "${backendLine.trim()}"`,
  );
});

// --- AC7: CONTEXT.md Agent(team_name=) warning keeps routing intent, drops the
//          dead team_name field reference ---
test('AC7: CONTEXT.md backend-routing warning preserves intent without the deprecated team_name field', () => {
  const lines = readFile(CONTEXT_MD).split('\n');
  const warningLine = lines.find((l) => /Orchestrator must honor/i.test(l) && /agent_backends/.test(l));
  assert.ok(
    warningLine,
    'CONTEXT.md must retain the "Orchestrator must honor agent_backends" routing warning',
  );

  // The dead field reference must be gone (it was `Agent(team_name=)`).
  assert.ok(
    !/team_name/.test(warningLine),
    `CONTEXT.md routing warning must not reference the deprecated team_name field; got: "${warningLine.trim()}"`,
  );

  // The routing intent — spawn through agent-spawn, not raw Agent, to honor
  // backend routing — must survive.
  assert.match(
    warningLine,
    /agent-spawn pathway/,
    `CONTEXT.md routing warning must preserve the "spawn through the agent-spawn pathway" intent; got: "${warningLine.trim()}"`,
  );
  assert.match(
    warningLine,
    /bypass(es)? Codex routing|ignore the configured backend/i,
    `CONTEXT.md routing warning must preserve the backend-routing concern; got: "${warningLine.trim()}"`,
  );
});

// --- AC8: whole-section grep for TeamCreate under hive/references/ (excluding
//          env-gate lines, CHANGELOG, .pHive historical docs) returns zero hits
//          for the files s3 owns. Remaining hits must be confined to the known
//          out-of-scope reference files (other stories' / sessions-path scope). ---
test('AC8: no TeamCreate hit under hive/references/ lands in an s3-owned reference file', () => {
  // Mirror the story's verification grep across the whole references tree.
  let output = '';
  try {
    output = execFileSync('grep', ['-rn', 'TeamCreate', REFERENCES_DIR], { encoding: 'utf8' });
  } catch (err) {
    if (err.status === 1) {
      output = ''; // exit 1 = no matches = clean tree
    } else {
      throw err;
    }
  }

  const hitFiles = output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(':', 1)[0]);

  // The two s3-owned reference files must NOT appear among the hits.
  const s3OwnedHits = hitFiles.filter(
    (f) => f.endsWith('agent-teams-guide.md') || f.endsWith('parallel-call-sites.md'),
  );
  assert.equal(
    s3OwnedHits.length,
    0,
    `s3-owned reference files must have zero TeamCreate hits; offending hits:\n${output}`,
  );

  // Any residual hit must be confined to the known out-of-scope set. A hit in an
  // unexpected file means a migration target was missed (test should fail loudly).
  const KNOWN_OUT_OF_SCOPE = ['skill-prelude.md', 'configuration.md', 'session-resilience.md'];
  const unexpected = hitFiles.filter(
    (f) => !KNOWN_OUT_OF_SCOPE.some((name) => f.endsWith(name)),
  );
  assert.deepEqual(
    unexpected,
    [],
    `Unexpected TeamCreate hit under hive/references/ outside the known out-of-scope set ` +
      `(${KNOWN_OUT_OF_SCOPE.join(', ')}). These belong to the sessions/respawn execution ` +
      `path documented by other stories, not s3. Offending files:\n${unexpected.join('\n')}`,
  );
});
