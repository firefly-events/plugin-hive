// hive/lib/question_gateway.js
//
// The headless-question-protocol gateway: envelope read/write, resume-consume,
// and renewable-deadline logic described in
// hive/references/question-envelope-schema.md.
//
// This module owns ONLY the headless-path mechanics — writing/reading
// `.pHive/questions/<skill>-<invocation-id>.yaml` envelopes. The interactive
// path (calling AskUserQuestion, or emitting existing prose) is NOT something
// a library function can do — AskUserQuestion is a Claude Code runtime tool,
// invokable only by the model itself. A calling skill is responsible for:
//
//   import { detectInteractiveMode } from './runtime_mode.js';
//   import { askOrEmit } from './question_gateway.js';
//   const mode = detectInteractiveMode();
//   if (mode.mode === 'interactive') {
//     // call AskUserQuestion / emit prose exactly as before this protocol
//   } else {
//     const result = askOrEmit({ skill: 'kickoff', phase: '1a', questions: [...] });
//     if (!result.resolved) {
//       // print AWAITING_ANSWERS status, exit
//     } else {
//       const answers = result.answers; // { qid: answer }
//     }
//   }

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { readConfigFile } from './config.js';

const _require = createRequire(import.meta.url);
const _dirname = path.dirname(fileURLToPath(import.meta.url));

let yaml = null;
try {
  yaml = _require('js-yaml');
} catch {
  yaml = null;
}

const DEFAULT_PROJECT_CONFIG_PATH = path.join(process.cwd(), 'hive.config.yaml');
const DEFAULT_BASELINE_CONFIG_PATH = path.join(_dirname, '..', 'hive.config.yaml');
const DEFAULT_QUESTIONS_DIR = path.join(process.cwd(), '.pHive', 'questions');

const DEFAULT_ANSWER_DEADLINE_SECONDS = 1800;
const DEFAULT_DEADLINE_EXPIRED_ACTION = 're-emit';
const VALID_EXPIRED_ACTIONS = new Set(['re-emit', 'fail']);

export class QuestionDeadlineExpiredError extends Error {
  constructor(skill, phase, envelopePath) {
    super(
      `Question envelope for skill=${skill} phase=${phase} at ${envelopePath} expired ` +
        "with no renewal and no answer (headless.deadline_expired_action=fail).",
    );
    this.name = 'QuestionDeadlineExpiredError';
    this.skill = skill;
    this.phase = phase;
    this.envelopePath = envelopePath;
  }
}

/**
 * Root-first precedence: root hive.config.yaml -> shipped hive/hive.config.yaml
 * baseline -> hardcoded default. No env tier — infra tuning knob, not a
 * per-invocation runtime toggle.
 */
export function resolveHeadlessConfig(rootConfigPath, baselineConfigPath) {
  const rootCfg = readConfigFile(rootConfigPath || DEFAULT_PROJECT_CONFIG_PATH) || {};
  const baselineCfg = readConfigFile(baselineConfigPath || DEFAULT_BASELINE_CONFIG_PATH) || {};

  const rootHeadless = rootCfg.headless && typeof rootCfg.headless === 'object' ? rootCfg.headless : {};
  const baselineHeadless =
    baselineCfg.headless && typeof baselineCfg.headless === 'object' ? baselineCfg.headless : {};

  let deadlineSeconds = rootHeadless.answer_deadline_seconds;
  if (deadlineSeconds === undefined || deadlineSeconds === null) {
    deadlineSeconds = baselineHeadless.answer_deadline_seconds;
  }
  if (deadlineSeconds === undefined || deadlineSeconds === null) {
    deadlineSeconds = DEFAULT_ANSWER_DEADLINE_SECONDS;
  }

  let expiredAction = rootHeadless.deadline_expired_action;
  if (expiredAction === undefined || expiredAction === null) {
    expiredAction = baselineHeadless.deadline_expired_action;
  }
  if (!VALID_EXPIRED_ACTIONS.has(expiredAction)) {
    expiredAction = DEFAULT_DEADLINE_EXPIRED_ACTION;
  }

  return {
    answerDeadlineSeconds: Number(deadlineSeconds),
    deadlineExpiredAction: expiredAction,
  };
}

function slug(value) {
  return String(value).replace(/[^A-Za-z0-9._-]/g, '-');
}

function nowIso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function questionsDir(baseDir) {
  return baseDir || DEFAULT_QUESTIONS_DIR;
}

export function envelopePath(skill, invocationId, baseDir) {
  return path.join(questionsDir(baseDir), `${skill}-${slug(invocationId)}.yaml`);
}

function writeYaml(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const text = yaml
    ? (typeof yaml.dump === 'function' ? yaml.dump(data) : yaml.safeDump(data))
    : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, text, 'utf8');
}

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  let loaded;
  try {
    loaded = JSON.parse(raw);
  } catch {
    if (yaml) {
      const loader = typeof yaml.load === 'function' ? yaml.load : yaml.safeLoad;
      loaded = loader(raw);
    }
  }
  return loaded && typeof loaded === 'object' ? loaded : null;
}

export function writeEnvelope({ skill, phase, questions, baseDir, deadlineSeconds, now }) {
  const at = now || new Date();
  const effectiveDeadlineSeconds =
    deadlineSeconds !== undefined && deadlineSeconds !== null
      ? deadlineSeconds
      : resolveHeadlessConfig().answerDeadlineSeconds;
  const invocationId = nowIso(at).replace(/:/g, '-');
  const filePath = envelopePath(skill, invocationId, baseDir);

  const envelope = {
    id: `${skill}-${invocationId}`,
    skill,
    phase,
    status: 'pending',
    provenance: { raised_by: skill, raised_at: nowIso(at) },
    deadline: nowIso(new Date(at.getTime() + effectiveDeadlineSeconds * 1000)),
    renewal_count: 0,
    questions: questions.map((q) => ({
      qid: q.qid,
      text: q.text,
      kind: q.kind || 'single-select',
      options: q.options ?? null,
      required: q.required ?? true,
      answer: null,
    })),
  };
  writeYaml(filePath, envelope);
  return { envelope, path: filePath };
}

export function findEnvelopeForPhase(skill, phase, baseDir) {
  const dir = questionsDir(baseDir);
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(`${skill}-`) && name.endsWith('.yaml'))
    .sort()
    .reverse()
    .map((name) => path.join(dir, name));
  for (const candidate of candidates) {
    const env = readYaml(candidate);
    if (env && env.phase === phase) {
      return { envelope: env, path: candidate };
    }
  }
  return null;
}

/**
 * Orchestrator-side operation: extend a still-pending envelope's deadline
 * without answering, incrementing renewal_count. Throws if the envelope is
 * missing or already answered.
 */
export function renewEnvelope(filePath, extraSeconds, now) {
  const at = now || new Date();
  const env = readYaml(filePath);
  if (env === null) {
    throw new Error(`No envelope at ${filePath}`);
  }
  if (env.status === 'answered') {
    throw new Error(`Cannot renew an already-answered envelope at ${filePath}`);
  }
  env.deadline = nowIso(new Date(at.getTime() + extraSeconds * 1000));
  env.renewal_count = (env.renewal_count || 0) + 1;
  writeYaml(filePath, env);
  return env;
}

function extractAnswers(envelope) {
  if (envelope.status !== 'answered') return null;
  const answers = {};
  for (const q of envelope.questions || []) {
    const required = q.required ?? true;
    if (required && (q.answer === null || q.answer === undefined)) {
      return null;
    }
    answers[q.qid] = q.answer;
  }
  return answers;
}

/**
 * Headless-path entry point. Returns either:
 *   { resolved: true, answers: { qid: answer, ... } }
 * or:
 *   { resolved: false, status: 'pending', envelopePath, deadline }
 * Throws QuestionDeadlineExpiredError if the matched envelope's deadline
 * lapsed with no renewal and headless.deadline_expired_action === 'fail'.
 */
export function askOrEmit({ skill, phase, questions, baseDir, now, config }) {
  const at = now || new Date();
  const cfg = config || resolveHeadlessConfig();

  const existing = findEnvelopeForPhase(skill, phase, baseDir);
  if (existing) {
    const { envelope: env, path: existingPath } = existing;
    const answers = extractAnswers(env);
    if (answers !== null) {
      return { resolved: true, answers };
    }

    const deadline = new Date(env.deadline);
    if (at < deadline) {
      return { resolved: false, status: 'pending', envelopePath: existingPath, deadline: env.deadline };
    }

    // Expired, no renewal.
    if (cfg.deadlineExpiredAction === 'fail') {
      throw new QuestionDeadlineExpiredError(skill, phase, existingPath);
    }
    // re-emit: fall through to write a fresh envelope below.
  }

  const { envelope: env, path: newPath } = writeEnvelope({
    skill,
    phase,
    questions,
    baseDir,
    deadlineSeconds: cfg.answerDeadlineSeconds,
    now: at,
  });
  return { resolved: false, status: 'pending', envelopePath: newPath, deadline: env.deadline };
}
