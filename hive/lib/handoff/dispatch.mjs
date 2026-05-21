/**
 * Terminal handoff dispatcher (story d-1-handoff-dispatch-and-execute-wire,
 * hardened in d-2-handoff-edge-cases).
 *
 * Invokes /test or /review as a child `claude --print` process after a story's
 * integrate step completes. Returns a structured verdict the caller writes into
 * cycle-state handoff_log[].
 *
 * Export surface:
 *   dispatchHandoff({ story_id, target, branch, pr_number?, timeout_ms?, state_dir?, run_id? })
 *     → { ok: true,  verdict, evidence_ref, duration_ms }
 *     | { ok: false, reason, duration_ms, timeout_at? }
 *
 * target enum: 'test' | 'review' | 'both' | 'none'
 * verdict: 'passed' | 'needs-revision' | 'needs-optimization' | 'failed' | 'error'
 */
'use strict';

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const _require = createRequire(import.meta.url);

// Default 1800 s per d-2 AC; overridden by execution.terminal_handoff.timeout_seconds in hive.config.yaml
const DEFAULT_TIMEOUT_MS = 1800 * 1000;
const EVIDENCE_SUBDIR = 'handoff-evidence';

// ---------------------------------------------------------------------------
// Config reader — reads execution.terminal_handoff.timeout_seconds
// ---------------------------------------------------------------------------

function getDefaultTimeoutMs() {
  try {
    const { readConfigFile } = _require('../config.js');
    const configPath = join(process.cwd(), 'hive.config.yaml');
    const cfg = readConfigFile(configPath);
    const secs = cfg?.execution?.terminal_handoff?.timeout_seconds;
    if (typeof secs === 'number' && secs > 0) return secs * 1000;
  } catch {
    // fall through to hardcoded default
  }
  return DEFAULT_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// JSONL event emit (best-effort)
// ---------------------------------------------------------------------------

function emitTimeoutEvent(stateDir, story_id, target, duration_ms, timeout_at) {
  try {
    const dir = join(stateDir, 'metrics', 'events');
    mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(dir, `phase-handoff-timeout-${story_id}-${ts}.jsonl`);
    const event = {
      event_type: 'phase_handoff_timeout',
      story_id,
      target,
      duration_ms,
      timeout_at,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  } catch {
    // best-effort — never throw
  }
}

// ---------------------------------------------------------------------------
// KG triple emit (fire-and-forget)
// ---------------------------------------------------------------------------

// Maps dispatch verdicts to the KG phase_handoff object vocab: pass|fail|inconclusive|timeout
function mapToKgVerdict(verdict) {
  if (verdict === 'passed') return 'pass';
  if (verdict === 'failed' || verdict === 'needs-revision') return 'fail';
  if (verdict === 'timeout') return 'timeout';
  return 'inconclusive'; // needs-optimization, error, skipped, unknown
}

async function emitPhaseHandoffTriple(story_id, target, verdict) {
  try {
    const mod = await import('../kg-emit.js').catch(() => ({}));
    const emitKgEvent = mod.emitKgEvent;
    if (typeof emitKgEvent === 'function') {
      await emitKgEvent({
        subject: story_id,
        predicate: 'phase_handoff',
        object: `${target}:${mapToKgVerdict(verdict)}`,
        sourceEpic: '',
        sourceAgent: 'handoff-dispatch',
      });
    }
  } catch {
    // fire-and-forget — CLI swallows missing-sqlite
  }
}

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
 * Run a single skill invocation. Returns { ok, verdict, rawOutput, timedOut? }.
 */
function runSkill(skillArgs, timeoutMs, extractVerdict) {
  const child = spawnClaude(skillArgs, timeoutMs);
  if (child.timedOut) {
    return { ok: false, verdict: 'timeout', rawOutput: child.stdout + child.stderr, reason: 'timeout', timedOut: true };
  }
  const rawOutput = child.stdout + (child.stderr ? `\n--- stderr ---\n${child.stderr}` : '');
  if (child.exitCode !== 0) {
    return {
      ok: false,
      verdict: 'error',
      rawOutput,
      reason: `claude exited with code ${child.exitCode}`,
    };
  }
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
 * @param {number=} opts.timeout_ms   Wall-clock limit per sub-invocation. Default: execution.terminal_handoff.timeout_seconds from hive.config.yaml, or 1800 s.
 * @param {string=} opts.state_dir    .pHive path for evidence writes. Default '.pHive'.
 * @param {string=} opts.run_id       Opaque label included in evidence filename.
 * @returns {{ ok: true, verdict: string, evidence_ref: string, duration_ms: number }
 *          |{ ok: false, reason: string, duration_ms: number, timeout_at?: string }}
 */
export async function dispatchHandoff({
  story_id,
  target,
  branch,
  pr_number,
  timeout_ms,
  state_dir = '.pHive',
  run_id = '',
}) {
  // Resolve timeout: caller override → config file → hardcoded default (1800 s)
  const resolvedTimeout = (typeof timeout_ms === 'number' && timeout_ms > 0)
    ? timeout_ms
    : getDefaultTimeoutMs();

  if (target === 'none') {
    return { ok: true, verdict: 'skipped', evidence_ref: '', duration_ms: 0 };
  }

  const started = Date.now();

  if (target === 'test') {
    const args = ['/test', '--story', story_id];
    const result = runSkill(args, resolvedTimeout, extractTestVerdict);
    const duration_ms = Date.now() - started;
    if (result.timedOut) {
      const timeout_at = new Date().toISOString();
      emitTimeoutEvent(state_dir, story_id, 'test', duration_ms, timeout_at);
      void emitPhaseHandoffTriple(story_id, 'test', 'timeout');
      return { ok: false, reason: 'timeout', duration_ms, timeout_at };
    }
    if (!result.ok) return { ok: false, reason: result.reason ?? 'test invocation failed', duration_ms };
    void emitPhaseHandoffTriple(story_id, 'test', result.verdict);
    const evidence_ref = writeEvidence(state_dir, story_id, 'test', result.rawOutput);
    return { ok: true, verdict: result.verdict, evidence_ref, duration_ms };
  }

  if (target === 'review') {
    let reviewArg;
    if (pr_number) {
      reviewArg = `#${pr_number}`;
    } else {
      reviewArg = branch;
      console.warn(`[handoff] no PR found for branch ${branch} — falling back to /review ${branch} (git diff main..${branch})`);
    }
    const args = ['/review', reviewArg];
    const result = runSkill(args, resolvedTimeout, extractReviewVerdict);
    const duration_ms = Date.now() - started;
    if (result.timedOut) {
      const timeout_at = new Date().toISOString();
      emitTimeoutEvent(state_dir, story_id, 'review', duration_ms, timeout_at);
      void emitPhaseHandoffTriple(story_id, 'review', 'timeout');
      return { ok: false, reason: 'timeout', duration_ms, timeout_at };
    }
    if (!result.ok) return { ok: false, reason: result.reason ?? 'review invocation failed', duration_ms };
    void emitPhaseHandoffTriple(story_id, 'review', result.verdict);
    const evidence_ref = writeEvidence(state_dir, story_id, 'review', result.rawOutput);
    return { ok: true, verdict: result.verdict, evidence_ref, duration_ms };
  }

  if (target === 'both') {
    // Test first, then review with test verdict available to reviewer
    const testArgs = ['/test', '--story', story_id];
    const testResult = runSkill(testArgs, resolvedTimeout, extractTestVerdict);
    if (testResult.timedOut) {
      const duration_ms = Date.now() - started;
      const timeout_at = new Date().toISOString();
      emitTimeoutEvent(state_dir, story_id, 'test', duration_ms, timeout_at);
      void emitPhaseHandoffTriple(story_id, 'test', 'timeout');
      return { ok: false, reason: 'timeout', duration_ms, timeout_at };
    }
    const testEvidence = testResult.ok
      ? writeEvidence(state_dir, story_id, 'test', testResult.rawOutput)
      : '';

    let reviewArg;
    if (pr_number) {
      reviewArg = `#${pr_number}`;
    } else {
      reviewArg = branch;
      console.warn(`[handoff] no PR found for branch ${branch} — falling back to /review ${branch} (git diff main..${branch})`);
    }
    // Pass test verdict as a flag so the reviewer can see it
    const reviewArgs = testResult.ok
      ? ['/review', reviewArg, '--context', `test-verdict:${testResult.verdict}`]
      : ['/review', reviewArg];
    const reviewResult = runSkill(reviewArgs, resolvedTimeout, extractReviewVerdict);
    const duration_ms = Date.now() - started;

    if (reviewResult.timedOut) {
      const timeout_at = new Date().toISOString();
      emitTimeoutEvent(state_dir, story_id, 'review', duration_ms, timeout_at);
      void emitPhaseHandoffTriple(story_id, 'review', 'timeout');
      return { ok: false, reason: 'timeout', duration_ms, timeout_at };
    }

    if (!testResult.ok && !reviewResult.ok) {
      void emitPhaseHandoffTriple(story_id, 'both', 'error');
      return { ok: false, reason: 'both test and review invocations failed', duration_ms };
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

    void emitPhaseHandoffTriple(story_id, 'both', verdict);
    return { ok: true, verdict, evidence_ref, duration_ms };
  }

  return { ok: false, reason: `unknown target: ${target}`, duration_ms: 0 };
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
