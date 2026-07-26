/**
 * question_gateway.test.mjs
 *
 * Fixture-driven coverage for story hqp-2-question-gateway-envelope: envelope
 * write, resume-consume, deadline validity, renewal-before-expiry,
 * expiry-with-reemit, expiry-with-fail, and the closure invariant.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  QuestionDeadlineExpiredError,
  askOrEmit,
  envelopePath,
  findEnvelopeForPhase,
  renewEnvelope,
  resolveHeadlessConfig,
  writeEnvelope,
} from '../question_gateway.js';

const QUESTIONS = [
  {
    qid: 'metrics-opt-in',
    text: 'Enable metrics tracking?',
    kind: 'single-select',
    options: ['yes', 'no'],
    required: true,
  },
];

const DEFAULT_CFG = { answerDeadlineSeconds: 1800, deadlineExpiredAction: 're-emit' };
const FAIL_CFG = { answerDeadlineSeconds: 1800, deadlineExpiredAction: 'fail' };

describe('question_gateway', () => {
  let baseDir;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hqp2-'));
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes one envelope batching all questions for the phase', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    expect(result.resolved).toBe(false);
    expect(result.status).toBe('pending');

    const found = findEnvelopeForPhase('kickoff', '1a', baseDir);
    expect(found).not.toBeNull();
    expect(found.envelope.status).toBe('pending');
    expect(found.envelope.questions).toHaveLength(1);
    expect(found.envelope.questions[0].qid).toBe('metrics-opt-in');
  });

  it('resume consumes an answered envelope without re-prompting', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    const { envelope, path: envPath } = findEnvelopeForPhase('kickoff', '1a', baseDir);

    envelope.questions[0].answer = 'yes';
    envelope.status = 'answered';
    fs.writeFileSync(envPath, JSON.stringify(envelope), 'utf8');

    const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    expect(result.resolved).toBe(true);
    expect(result.answers).toEqual({ 'metrics-opt-in': 'yes' });

    const candidates = fs.readdirSync(baseDir).filter((f) => f.startsWith('kickoff-'));
    expect(candidates).toHaveLength(1);
  });

  it('re-exits on a still-pending, non-expired envelope without mutating it', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    const before = findEnvelopeForPhase('kickoff', '1a', baseDir);
    const mtimeBefore = fs.statSync(before.path).mtimeMs;

    const later = new Date(now.getTime() + 60_000);
    const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now: later, config: DEFAULT_CFG });
    expect(result.resolved).toBe(false);

    const candidates = fs.readdirSync(baseDir).filter((f) => f.startsWith('kickoff-'));
    expect(candidates).toHaveLength(1);
    expect(fs.statSync(before.path).mtimeMs).toBe(mtimeBefore);
  });

  it('re-emits a fresh envelope on expiry with no renewal (default action)', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    writeEnvelope({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, deadlineSeconds: 60, now });
    const pastDeadline = new Date(now.getTime() + 61_000);

    const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now: pastDeadline, config: DEFAULT_CFG });
    expect(result.resolved).toBe(false);

    const candidates = fs.readdirSync(baseDir).filter((f) => f.startsWith('kickoff-'));
    expect(candidates).toHaveLength(2);
  });

  it('throws QuestionDeadlineExpiredError on expiry with no renewal when configured to fail', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    writeEnvelope({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, deadlineSeconds: 60, now });
    const pastDeadline = new Date(now.getTime() + 61_000);

    expect(() =>
      askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now: pastDeadline, config: FAIL_CFG }),
    ).toThrow(QuestionDeadlineExpiredError);
  });

  it('renewal before expiry keeps the envelope valid past the original deadline', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    const { envelope, path: envPath } = writeEnvelope({
      skill: 'kickoff',
      phase: '1a',
      questions: QUESTIONS,
      baseDir,
      deadlineSeconds: 60,
      now,
    });
    expect(envelope.renewal_count).toBe(0);

    const renewTime = new Date(now.getTime() + 30_000);
    const renewed = renewEnvelope(envPath, 3600, renewTime);
    expect(renewed.renewal_count).toBe(1);

    const pastOriginalDeadline = new Date(now.getTime() + 61_000);
    const result = askOrEmit({
      skill: 'kickoff',
      phase: '1a',
      questions: QUESTIONS,
      baseDir,
      now: pastOriginalDeadline,
      config: FAIL_CFG,
    });
    // Would have thrown under FAIL_CFG if renewal hadn't extended the deadline.
    expect(result.resolved).toBe(false);
    expect(result.status).toBe('pending');
  });

  it('falls back to the default when answer_deadline_seconds is non-numeric', () => {
    // Regression for CodeRabbit review (PR #341): a non-numeric configured
    // value must fall back to the default, not produce NaN.
    const rootConfig = path.join(baseDir, '..', 'hive.config.yaml');
    fs.writeFileSync(rootConfig, 'headless:\n  answer_deadline_seconds: not-a-number\n', 'utf8');
    const cfg = resolveHeadlessConfig(rootConfig, '/nonexistent.yaml');
    expect(cfg.answerDeadlineSeconds).toBe(1800);
  });

  it('does not collide envelope filenames within the same wall-clock second', () => {
    // Regression for CodeRabbit review (PR #341): whole-second invocation ids
    // meant two writes in the same second for the same skill (different
    // phases) silently overwrote each other on disk.
    const now = new Date('2026-07-25T22:10:00.100Z');
    const laterSameSecond = new Date('2026-07-25T22:10:00.900Z');
    const a = writeEnvelope({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now });
    const b = writeEnvelope({ skill: 'kickoff', phase: '1b', questions: QUESTIONS, baseDir, now: laterSameSecond });
    expect(a.path).not.toBe(b.path);
    const candidates = fs.readdirSync(baseDir).filter((f) => f.startsWith('kickoff-'));
    expect(candidates).toHaveLength(2);
  });

  it('sanitizes the skill component in the envelope path', () => {
    // Regression for CodeRabbit review (PR #341): only invocationId was
    // slugged, not skill.
    const p = envelopePath('weird/skill name', '2026-07-25T22-10-00-000Z', baseDir);
    expect(path.basename(p)).not.toMatch(/\//);
    expect(path.dirname(p)).toBe(baseDir);
  });

  it('throws on a malformed envelope instead of treating it as missing', () => {
    // Regression for CodeRabbit review (PR #341): a non-object (or
    // unparseable) envelope must surface an error, not be silently treated
    // as "no envelope" — that conflation would let a caller write a
    // duplicate envelope over corrupted state.
    const now = new Date('2026-07-25T22:10:00Z');
    const { path: envPath } = writeEnvelope({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now });
    fs.writeFileSync(envPath, '- just\n- a\n- list\n', 'utf8');
    expect(() => findEnvelopeForPhase('kickoff', '1a', baseDir)).toThrow();
  });

  it('treats status:answered with a missing required answer as still pending (closure invariant)', () => {
    const now = new Date('2026-07-25T22:10:00Z');
    askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    const { envelope, path: envPath } = findEnvelopeForPhase('kickoff', '1a', baseDir);

    envelope.status = 'answered'; // required answer left null — malformed
    fs.writeFileSync(envPath, JSON.stringify(envelope), 'utf8');

    const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: QUESTIONS, baseDir, now, config: DEFAULT_CFG });
    expect(result.resolved).toBe(false);
  });
});
