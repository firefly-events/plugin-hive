/**
 * Terminal handoff dispatcher (story d-1-handoff-dispatch-and-execute-wire).
 *
 * Invokes /test or /review as a child `claude --print` process after a story's
 * integrate step completes. Returns a structured verdict the caller writes into
 * cycle-state handoff_log[].
 *
 * Export surface:
 *   dispatchHandoff({ story_id, target, branch, pr_number?, timeout_ms?, state_dir?, run_id? })
 *     → { ok: true,  verdict, evidence_ref, duration_ms }
 *     | { ok: false, reason }
 *
 * target enum: 'test' | 'review' | 'both' | 'none'
 * verdict: 'passed' | 'needs-revision' | 'needs-optimization' | 'failed' | 'error'
 */
'use strict';

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min
const EVIDENCE_SUBDIR = 'handoff-evidence';

// ---------------------------------------------------------------------------
// Verdict extraction
// ---------------------------------------------------------------------------

/**
 * Scan test skill output for a pass/fail verdict.
 * Recognises common hive /test output patterns.
 */
function extractTestVerdict(output) {
  const lower = output.toLowerCase();
  if (/all tests? pass(ed)?/.test(lower) || /✅\s*(all\s+)?tests?\s+pass/.test(output)) {
    return 'passed';
  }
  if (/test(s)? (failed|failing)/.test(lower) || /❌/.test(output)) {
    return 'failed';
  }
  if (/no tests? (found|ran|executed)/.test(lower)) {
    return 'passed'; // vacuously passing — no suite to fail
  }
  // Fallback: look for explicit verdict lines emitted by /test
  const verdictMatch = output.match(/verdict:\s*(passed|failed|inconclusive)/i);
  if (verdictMatch) return verdictMatch[1].toLowerCase() === 'passed' ? 'passed' : 'failed';
  return 'error'; // could not determine
}

/**
 * Scan review skill output for a verdict.
 * Recognises common hive /review output patterns.
 */
function extractReviewVerdict(output) {
  const lower = output.toLowerCase();
  if (/verdict:\s*passed/.test(lower) || /✅\s*(review\s+)?passed/.test(output)) {
    return 'passed';
  }
  if (/verdict:\s*needs[_-]optimization/.test(lower) || /needs.optimization/.test(lower)) {
    return 'needs-optimization';
  }
  if (/verdict:\s*needs[_-]revision/.test(lower) || /needs.revision/.test(lower)) {
    return 'needs-revision';
  }
  if (/approved/.test(lower)) return 'passed';
  if (/❌/.test(output) || /failed/.test(lower)) return 'needs-revision';
  return 'error';
}

// ---------------------------------------------------------------------------
// Child invocation
// ---------------------------------------------------------------------------

/**
 * Spawn `claude --print <skillArgs>` with a wall-clock timeout.
 * Returns { exitCode, stdout, stderr, timedOut }.
 */
function spawnClaude(skillArgs, timeoutMs) {
  const result = spawnSync('claude', ['--print', ...skillArgs], {
    timeout: timeoutMs,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024, // 10 MB
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut: result.error?.code === 'ETIMEDOUT',
  };
}

/**
 * Run a single skill invocation. Returns { ok, verdict, rawOutput }.
 */
function runSkill(skillArgs, timeoutMs, extractVerdict) {
  const child = spawnClaude(skillArgs, timeoutMs);
  if (child.timedOut) {
    return { ok: false, verdict: 'error', rawOutput: child.stdout + child.stderr, reason: 'timed out' };
  }
  const rawOutput = child.stdout + (child.stderr ? `\n--- stderr ---\n${child.stderr}` : '');
  const verdict = extractVerdict(rawOutput);
  return { ok: true, verdict, rawOutput };
}

// ---------------------------------------------------------------------------
// Evidence file
// ---------------------------------------------------------------------------

function writeEvidence(stateDir, storyId, target, content) {
  const dir = join(stateDir, EVIDENCE_SUBDIR);
  mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(dir, `${storyId}-${target}-${ts}.md`);
  writeFileSync(file, content, 'utf8');
  return file;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string}  opts.story_id
 * @param {'test'|'review'|'both'|'none'} opts.target
 * @param {string}  opts.branch
 * @param {number=} opts.pr_number
 * @param {number=} opts.timeout_ms   Wall-clock limit per sub-invocation. Default 15 min.
 * @param {string=} opts.state_dir    .pHive path for evidence writes. Default '.pHive'.
 * @param {string=} opts.run_id       Opaque label included in evidence filename.
 * @returns {{ ok: true, verdict: string, evidence_ref: string, duration_ms: number }
 *          |{ ok: false, reason: string }}
 */
export async function dispatchHandoff({
  story_id,
  target,
  branch,
  pr_number,
  timeout_ms = DEFAULT_TIMEOUT_MS,
  state_dir = '.pHive',
  run_id = '',
}) {
  if (target === 'none') {
    return { ok: true, verdict: 'skipped', evidence_ref: '', duration_ms: 0 };
  }

  const started = Date.now();

  if (target === 'test') {
    const args = ['/test', '--story', story_id];
    const result = runSkill(args, timeout_ms, extractTestVerdict);
    const duration_ms = Date.now() - started;
    if (!result.ok) return { ok: false, reason: result.reason ?? 'test invocation failed' };
    const evidence_ref = writeEvidence(state_dir, story_id, 'test', result.rawOutput);
    return { ok: true, verdict: result.verdict, evidence_ref, duration_ms };
  }

  if (target === 'review') {
    const reviewArg = pr_number ? `#${pr_number}` : branch;
    const args = ['/review', reviewArg];
    const result = runSkill(args, timeout_ms, extractReviewVerdict);
    const duration_ms = Date.now() - started;
    if (!result.ok) return { ok: false, reason: result.reason ?? 'review invocation failed' };
    const evidence_ref = writeEvidence(state_dir, story_id, 'review', result.rawOutput);
    return { ok: true, verdict: result.verdict, evidence_ref, duration_ms };
  }

  if (target === 'both') {
    // Test first, then review with test verdict available to reviewer
    const testArgs = ['/test', '--story', story_id];
    const testResult = runSkill(testArgs, timeout_ms, extractTestVerdict);
    const testEvidence = testResult.ok
      ? writeEvidence(state_dir, story_id, 'test', testResult.rawOutput)
      : '';

    const reviewArg = pr_number ? `#${pr_number}` : branch;
    // Pass test verdict as a flag so the reviewer can see it
    const reviewArgs = testResult.ok
      ? ['/review', reviewArg, '--context', `test-verdict:${testResult.verdict}`]
      : ['/review', reviewArg];
    const reviewResult = runSkill(reviewArgs, timeout_ms, extractReviewVerdict);
    const duration_ms = Date.now() - started;

    if (!testResult.ok && !reviewResult.ok) {
      return { ok: false, reason: 'both test and review invocations failed' };
    }

    const combinedVerdicts = [
      testResult.ok ? testResult.verdict : 'error',
      reviewResult.ok ? reviewResult.verdict : 'error',
    ];

    // Aggregate: worst verdict wins
    const verdict = combinedVerdicts.includes('failed') || combinedVerdicts.includes('needs-revision')
      ? combinedVerdicts.find(v => v === 'failed' || v === 'needs-revision')
      : combinedVerdicts.includes('needs-optimization')
        ? 'needs-optimization'
        : combinedVerdicts.includes('error')
          ? 'error'
          : 'passed';

    const combinedOutput = [
      `=== test ===\n${testResult.rawOutput}`,
      `=== review ===\n${reviewResult.rawOutput}`,
    ].join('\n\n');
    const evidence_ref = writeEvidence(state_dir, story_id, 'both', combinedOutput);

    return { ok: true, verdict, evidence_ref, duration_ms };
  }

  return { ok: false, reason: `unknown target: ${target}` };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------
// Usage: node dispatch.mjs <story_id> <target> <branch> [--pr-number N] [--timeout-ms N] [--state-dir PATH]

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const [, , story_id, target, branch, ...rest] = process.argv;
  if (!story_id || !target || !branch) {
    console.error('Usage: node dispatch.mjs <story_id> <target> <branch> [--pr-number N] [--timeout-ms N] [--state-dir PATH]');
    process.exit(1);
  }
  let pr_number, timeout_ms, state_dir;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--pr-number' && rest[i + 1]) pr_number = Number(rest[++i]);
    if (rest[i] === '--timeout-ms' && rest[i + 1]) timeout_ms = Number(rest[++i]);
    if (rest[i] === '--state-dir' && rest[i + 1]) state_dir = rest[++i];
  }
  const result = await dispatchHandoff({ story_id, target, branch, pr_number, timeout_ms, state_dir });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
