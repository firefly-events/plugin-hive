/**
 * Session Client
 *
 * HTTPS client for the Anthropic Managed Agents API:
 *   POST /v1/sessions                  — create session
 *   POST /v1/sessions/{id}/events      — send events
 *   SSE  /v1/sessions/{id}/events      — stream events (via @anthropic-ai/sdk)
 *
 * All requests include the required managed-agents-2026-04-01 beta header.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getCloudMode } = require('./runtime-mode');
let yaml = null;
try {
  yaml = require('js-yaml');
} catch {
  yaml = null;
}

let Anthropic;
try {
  Anthropic = require('@anthropic-ai/sdk');
} catch {
  throw new Error('@anthropic-ai/sdk not available — run: npm install @anthropic-ai/sdk');
}

const REQUIRED_HEADERS = {
  'anthropic-version': '2023-06-01',
  'anthropic-beta': 'managed-agents-2026-04-01',
  'content-type': 'application/json',
};

const DEFAULT_PROJECT_CONFIG_PATH = path.join(process.cwd(), 'hive.config.yaml');
const DEFAULT_BASELINE_CONFIG_PATH = path.join(__dirname, '..', 'hive.config.yaml');

/**
 * Build an Anthropic SDK client instance.
 * @returns {Object} Anthropic SDK client
 */
function buildClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY not set');
    err.code = 'AUTH_MISSING';
    throw err;
  }
  return new Anthropic({ apiKey, defaultHeaders: REQUIRED_HEADERS });
}

/**
 * Create a new Managed Agent session.
 * @param {string} agentId - pre-registered agent ID
 * @param {string} environmentId - environment ID
 * @returns {Promise<string>} session_id
 */
async function createSession(agentId, environmentId) {
  const client = buildClient();
  let response;
  try {
    response = await client.beta.sessions.create({
      agent: agentId,
      environment_id: environmentId,
    });
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
  if (!response || !response.id) {
    const err = new Error(`createSession: unexpected response shape — ${JSON.stringify(response)}`);
    err.code = 'API_5XX';
    throw err;
  }
  return response.id;
}

/**
 * Send one or more events to an existing session.
 * @param {string} sessionId
 * @param {Array<Object>} events - array of event objects (user.message, user.custom_tool_result, etc.)
 * @returns {Promise<void>}
 */
async function sendEvents(sessionId, events) {
  const client = buildClient();
  try {
    await client.beta.sessions.events.send(sessionId, { events });
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
}

/**
 * Build a Sessions-only custom tool result event when cloud mode is active.
 * Returns null on non-cloud substrates so callers can keep the Messages path
 * free of Sessions-only event shapes.
 *
 * @param {Object} config
 * @param {string} customToolUseId
 * @param {string} result
 * @returns {Object|null}
 */
function buildCustomToolResultEvent(config, customToolUseId, result) {
  if (!getCloudMode(config)) return null;
  const { buildCustomToolResult } = require('./session-turn-builder');
  return buildCustomToolResult(customToolUseId, result);
}

/**
 * Build a Sessions-only tool confirmation event when cloud mode is active.
 * Returns null on non-cloud substrates so callers can keep the Messages path
 * free of Sessions-only event shapes.
 *
 * @param {Object} config
 * @param {string} toolUseId
 * @param {string} result
 * @param {string} [denyMessage]
 * @returns {Object|null}
 */
function buildToolConfirmationEvent(config, toolUseId, result, denyMessage) {
  if (!getCloudMode(config)) return null;
  const { buildToolConfirmation } = require('./session-turn-builder');
  return buildToolConfirmation(toolUseId, result, denyMessage);
}

/**
 * Stream SSE events from a session.
 * Returns an async iterable that yields raw SSE event objects.
 * @param {string} sessionId
 * @returns {AsyncIterable<Object>}
 */
async function* streamEvents(sessionId) {
  const client = buildClient();
  let stream;
  try {
    stream = await client.beta.sessions.events.stream(sessionId);
  } catch (err) {
    err.code = classifyError(err);
    throw err;
  }
  for await (const event of stream) {
    yield event;
  }
}

/**
 * Classify an Anthropic SDK error into one of the defined error codes.
 * @param {Error} err
 * @returns {string} error code
 */
function classifyError(err) {
  const status = err.status || (err.response && err.response.status);
  const msg = (err.message || '').toLowerCase();

  if (status === 401 || msg.includes('auth') || msg.includes('api key')) return 'AUTH_INVALID';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 413 || msg.includes('context') || msg.includes('too long')) return 'CONTEXT_OVERFLOW';
  if (msg.includes('content') && msg.includes('filter')) return 'CONTENT_FILTER';
  if (status >= 500) return 'API_5XX';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network')) return 'NETWORK';
  return 'API_5XX';
}

/**
 * Register a Hive session row in the registry, stamping the Claude Code
 * harness session id (process.env.CLAUDE_CODE_SESSION_ID) onto the row's
 * `cc_session_id` correlation column when present.
 *
 * Env-var pickup is centralized HERE — upstream of substrate selection in
 * runSession() — so the same correlation behavior holds regardless of
 * whether the caller subsequently drives the legacy Sessions-API path or
 * the Messages-API substrate. Per binding decision
 * `claude-code-session-id-precedence`, the Hive `sessionId` argument
 * remains canonical for KG triples; cc_session_id sits alongside as
 * correlation only.
 *
 * Empty-string env var is treated as unset (no key written) so YAML stays
 * clean. Existing registry rows without the column remain valid.
 *
 * @param {string} sessionId - canonical Hive session id (KG-canonical)
 * @param {Object} fields - any subset of the session entry schema
 * @param {string} [registryPath] - override default path (for testing)
 * @returns {Promise<void>}
 */
async function registerSession(sessionId, fields, registryPath) {
  const { upsert } = require('./session-registry');
  const ccId = process.env.CLAUDE_CODE_SESSION_ID;
  const stamped = (typeof ccId === 'string' && ccId.length > 0)
    ? { ...fields, cc_session_id: ccId }
    : { ...fields };
  await upsert(sessionId, stamped, registryPath);
}

/**
 * Delegation entry point — routes by execution.substrate.
 *
 * Default precedence:
 *   explicit call override → env HIVE_EXECUTION_SUBSTRATE → project hive.config.yaml
 *   → shipped baseline hive/hive.config.yaml
 *
 * substrate: 'messages'        → hive/lib/messages-session.js (default path)
 * substrate: 'sessions-cloud'  → cloud adapter bootstrap guard / Sessions-API path
 *
 * @param {Object} opts
 * @param {string} opts.substrate
 * @param {string} opts.system
 * @param {Array<Object>} opts.tools
 * @param {Array<Object>} opts.messages
 * @param {Function} [opts.toolHandler]
 * @param {Object} [opts.budget]
 * @returns {Promise<{messages, stopReason, usage, terminationReason?}>}
 */
async function runSession(opts) {
  const runtime = resolveRuntimeSubstrate(opts || {});
  logRuntimeResolution(runtime);

  if (runtime.cloudAdapterEnabled && !runtime.cloudMode) {
    console.warn('[session-client] cloud-adapter.enabled ignored on non-cloud substrate');
  }

  if (runtime.cloudMode && !runtime.cloudAdapterEnabled) {
    const err = new Error(
      'capability-error: execution.substrate requests the cloud adapter, but cloud-adapter.enabled is false. ' +
      'Enable the adapter before selecting the cloud substrate.',
    );
    err.code = 'CapabilityError';
    throw err;
  }

  const dispatch = {
    messages: async () => {
      const { runMessagesSession } = require('./messages-session');
      return runMessagesSession(opts);
    },
    'sessions-cloud': async () => runSessionsCloudSession(opts),
  };

  if (dispatch[runtime.substrate]) {
    return dispatch[runtime.substrate]();
  }

  const err = new Error(`unsupported execution.substrate: ${runtime.substrate}`);
  err.code = 'UnknownSubstrate';
  throw err;
}

async function runSessionsCloudSession() {
  const err = new Error(
    'sessions-cloud substrate requires cloud bootstrap (agent_id + environment_id provisioning). ' +
    'See hive/references/session-system-prompt-spec.md §7 cloud adapter footnote.',
  );
  err.code = 'CapabilityError';
  throw err;
}

function resolveRuntimeSubstrate(opts) {
  const sources = resolveConfigSources(opts);
  const callValue = typeof opts.substrate === 'string' ? opts.substrate : undefined;
  const baselineConfig = readRuntimeConfig(sources.baselineConfigPath);
  const projectConfig = readRuntimeConfig(sources.projectConfigPath);
  const baselineValue = readNestedValue(baselineConfig, ['execution', 'substrate']);
  const projectValue = readNestedValue(projectConfig, ['execution', 'substrate']);
  const envValue = typeof process.env.HIVE_EXECUTION_SUBSTRATE === 'string' && process.env.HIVE_EXECUTION_SUBSTRATE.length > 0
    ? process.env.HIVE_EXECUTION_SUBSTRATE
    : undefined;

  const resolvedSubstrate = callValue || envValue || projectValue || baselineValue;
  const resolvedFrom = callValue
    ? 'call'
    : envValue
      ? 'env'
      : projectValue
        ? 'project'
        : 'baseline';

  const cloudAdapterEnabled = resolveCloudAdapterEnabled(opts, baselineConfig, projectConfig);
  const valuesForConflict = [baselineValue, projectValue, envValue, callValue].filter(Boolean);
  const conflict = new Set(valuesForConflict).size > 1;
  const cloudMode = getCloudMode({ execution: { substrate: resolvedSubstrate } });

  return {
    substrate: resolvedSubstrate,
    resolvedFrom,
    conflict,
    cloudAdapterEnabled,
    cloudMode,
  };
}

function resolveCloudAdapterEnabled(opts, baselineConfig, projectConfig) {
  if (typeof opts.cloudAdapterEnabled === 'boolean') return opts.cloudAdapterEnabled;

  const baselineValue = readNestedValue(baselineConfig, ['cloud-adapter', 'enabled']);
  const projectValue = readNestedValue(projectConfig, ['cloud-adapter', 'enabled']);
  if (typeof projectValue === 'boolean') return projectValue;
  if (typeof baselineValue === 'boolean') return baselineValue;
  return false;
}

function resolveConfigSources(opts) {
  return {
    baselineConfigPath: opts.baselineConfigPath || DEFAULT_BASELINE_CONFIG_PATH,
    projectConfigPath: opts.projectConfigPath || process.env.HIVE_CONFIG || DEFAULT_PROJECT_CONFIG_PATH,
  };
}

function logRuntimeResolution(runtime) {
  console.info(
    `[session-client] substrate.resolved_from=${runtime.resolvedFrom} substrate.conflict=${runtime.conflict}`,
  );
}

function readRuntimeConfig(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseConfigText(raw);
}

function parseConfigText(raw) {
  if (!raw || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {}

  if (yaml) {
    try {
      const parsed = yaml.load(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {}
  }

  console.info('[session-client] falling back to limited YAML parser; install/use js-yaml for full config support');

  return parseYamlSections(raw);
}

function parseYamlSections(raw) {
  const result = {};
  const lines = raw.split(/\r?\n/);
  let activeSection = null;
  let activeIndent = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^(\s*)([A-Za-z0-9_-]+):\s*(?:#.*)?$/);
    if (sectionMatch) {
      activeSection = sectionMatch[2];
      activeIndent = sectionMatch[1].length;
      if (!result[activeSection]) result[activeSection] = {};
      continue;
    }

    if (!activeSection) continue;
    const lineIndent = (line.match(/^(\s*)/) || ['',''])[1].length;
    if (lineIndent <= activeIndent && line.trim()) {
      activeSection = null;
      activeIndent = null;
      continue;
    }

    const match = line.match(/^\s*([A-Za-z0-9_-]+):\s*(.+?)\s*(?:#.*)?$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[activeSection][key] = coerceConfigValue(rawValue);
  }

  return result;
}

function coerceConfigValue(value) {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (normalized === 'null') return null;
  return normalized;
}

function readNestedValue(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object' || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

module.exports = {
  buildCustomToolResultEvent,
  buildToolConfirmationEvent,
  createSession,
  sendEvents,
  streamEvents,
  classifyError,
  runSession,
  registerSession,
};
