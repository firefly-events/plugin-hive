import childProcess from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseAgentsConfig, resolveAgentInstructions } from '../multica-agents-config/index.mjs';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8080';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.multica', 'config.json');
const DEFAULT_TOKEN_NAME = 'hive-bootstrap';
const DEFAULT_WORKSPACE_NAME = 'plugin-hive';
const DEFAULT_WORKSPACE_SLUG = 'plugin-hive';
const HTTP_TIMEOUT_MS = 30000;
const USER_AGENT = 'hive-multica-bootstrap/0.1.0';
const RUNTIME_CACHE = new Map();
function bootstrapError(code, message, hint) {
  return { code, message: redact(message), hint: redact(hint) };
}
function redact(value) {
  if (value == null) return value;
  return String(value)
    .replace(/mul_[A-Za-z0-9._~+/=-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/pat_[A-Za-z0-9._~+/=-]+/gi, '[redacted-token]');
}
function trimTrailingSlash(value = DEFAULT_SERVER_URL) {
  return String(value || DEFAULT_SERVER_URL).replace(/\/+$/, '');
}
function assertConsent(consent, message, hint) {
  if (!consent) throw bootstrapError('CONSENT_REQUIRED', message, hint);
}
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}
function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}
function normalizeList(body, key) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  return [];
}
function jsonEqual(a, b) {
  return JSON.stringify(sortValue(a)) === JSON.stringify(sortValue(b));
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}
async function httpJson(serverUrl, apiPath, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`${trimTrailingSlash(serverUrl)}${apiPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw bootstrapError('TRANSPORT', 'Multica request timed out after 30s', `Check that Multica is running at ${trimTrailingSlash(serverUrl)}.`);
    }
    throw bootstrapError('TRANSPORT', error?.message || 'Unable to reach Multica server', `Check that Multica is running at ${trimTrailingSlash(serverUrl)}.`);
  }
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (response.status >= 200 && response.status < 300) return parsed;
  const message =
    typeof parsed?.message === 'string'
      ? parsed.message
      : typeof parsed?.error === 'string'
        ? parsed.error
        : `Multica API returned HTTP ${response.status}`;
  throw bootstrapError(response.status === 401 || response.status === 403 ? 'AUTH_FAILURE' : 'HTTP_ERROR', message, `Request ${method} ${apiPath} failed with HTTP ${response.status}.`);
}
async function ask(promptFn, prompt, fallback = '') {
  if (typeof promptFn !== 'function') return fallback;
  const answer = await promptFn(prompt);
  return String(answer ?? '').trim();
}
async function loadAgentsConfig(agentsConfigPath) {
  const yamlString = fs.readFileSync(agentsConfigPath, 'utf8');
  try {
    const yaml = await import('js-yaml');
    const loaded = yaml.load(yamlString);
    if (Array.isArray(loaded)) return { agents: loaded };
    return loaded;
  } catch {
    return parseAgentsConfig(yamlString);
  }
}
export function resolveEnvPath(value) {
  if (typeof value !== 'string') return value;
  let resolved = value;
  if (resolved.startsWith('~/') || resolved === '~') {
    resolved = resolved.replace(/^~/, os.homedir());
  }
  resolved = resolved.replace(/\$\{HOME\}/g, os.homedir());
  resolved = resolved.replace(/\$HOME(?![A-Za-z0-9_])/g, os.homedir());
  return resolved;
}

export function resolveCustomEnv(customEnv) {
  if (!customEnv || typeof customEnv !== 'object') return customEnv;
  const resolved = {};
  for (const [key, value] of Object.entries(customEnv)) {
    resolved[key] = resolveEnvPath(value);
  }
  return resolved;
}

function buildAgentPayload(agent, runtimeId, instructions) {
  const payload = { name: agent.name, runtime_id: runtimeId };
  for (const key of ['description', 'model', 'thinking_level', 'visibility', 'max_concurrent_tasks', 'custom_env', 'custom_args', 'mcp_config', 'skills']) {
    if (agent[key] !== undefined) {
      payload[key] = key === 'custom_env' ? resolveCustomEnv(agent[key]) : agent[key];
    }
  }
  if (instructions !== undefined) payload.instructions = instructions;
  return payload;
}
function diffAgent(existing, desired) {
  const changed = [];
  for (const [key, value] of Object.entries(desired)) {
    if (!jsonEqual(existing?.[key], value)) changed.push(key);
  }
  return changed;
}
async function getRuntimes(serverUrl, token, workspaceId) {
  const tokenFingerprint = token
    ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)
    : 'anon';
  const cacheKey = `${trimTrailingSlash(serverUrl)}:${workspaceId}:${tokenFingerprint}`;
  if (RUNTIME_CACHE.has(cacheKey)) return RUNTIME_CACHE.get(cacheKey);
  const body = await httpJson(serverUrl, `/api/runtimes?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const runtimes = normalizeList(body, 'runtimes');
  if (runtimes.length === 0) {
    throw bootstrapError('NO_RUNTIMES', 'No Multica runtimes are registered for this workspace.', 'Start the Multica daemon before reconciling agents.');
  }
  RUNTIME_CACHE.set(cacheKey, runtimes);
  return runtimes;
}
async function resolveRuntimeId(serverUrl, token, workspaceId, provider) {
  const runtimes = await getRuntimes(serverUrl, token, workspaceId);
  const runtime = runtimes.find((candidate) => candidate?.provider === provider);
  if (!runtime?.id) {
    throw bootstrapError('RUNTIME_NOT_FOUND', `No runtime with provider "${provider}" found.`, 'Check that the daemon has registered the expected provider for this workspace.');
  }
  return runtime.id;
}
export async function checkHealth({ serverUrl = DEFAULT_SERVER_URL } = {}) {
  const started = Date.now();
  const body = await httpJson(serverUrl, '/healthz');
  const latencyMs = Date.now() - started;
  if (body?.status !== 'ok') {
    throw bootstrapError('SERVER_UNHEALTHY', 'Multica health check did not return status "ok".', 'Check server logs and retry after the service is healthy.');
  }
  return { ok: true, checks: body.checks ?? {}, latencyMs };
}
export async function ensureCli({ consent = false } = {}) {
  try {
    const version = childProcess.execSync('multica --version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { installed: true, version };
  } catch {
    assertConsent(consent, 'multica CLI is not installed.', 'Run with --yes to install via Homebrew, or install multica manually.');
    try {
      childProcess.execSync('brew install multica', { stdio: 'inherit' });
      const version = childProcess.execSync('multica --version', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return { installed: true, version };
    } catch (error) {
      throw bootstrapError('CLI_INSTALL_FAILED', error?.message || 'Failed to install multica CLI.', 'Install multica manually and re-run /hive:multica-init.');
    }
  }
}
export async function ensureAuth({
  serverUrl = DEFAULT_SERVER_URL,
  configPath = DEFAULT_CONFIG_PATH,
  consent = false,
  promptFn,
} = {}) {
  const existingConfig = readJsonFile(configPath);
  if (existingConfig.token) {
    return { tokenSource: 'existing' };
  }
  const email = process.env.MULTICA_EMAIL || (await ask(promptFn, 'Multica account email:'));
  if (!email) throw bootstrapError('AUTH_EMAIL_REQUIRED', 'A Multica account email is required to mint a PAT.', 'Set MULTICA_EMAIL or provide an email when prompted.');
  assertConsent(consent, `Sending a Multica verification code to ${email} requires consent.`, 'Re-run with --yes or approve the auth send-code step.');
  await httpJson(serverUrl, '/auth/send-code', { method: 'POST', body: { email } });
  const code =
    process.env.MULTICA_DEV_VERIFICATION_CODE ||
    (await ask(promptFn, 'Multica verification code:'));
  if (!/^\d{6}$/.test(code)) throw bootstrapError('AUTH_CODE_REQUIRED', 'A six-digit Multica verification code is required.', 'Set MULTICA_DEV_VERIFICATION_CODE in dev mode or enter the emailed code.');
  const login = await httpJson(serverUrl, '/auth/verify-code', { method: 'POST', body: { email, code } });
  const jwt = login?.token;
  if (!jwt) throw bootstrapError('AUTH_FAILURE', 'Multica verify-code response did not include a session token.', 'Retry authentication and check the verification code.');
  const tokenName = process.env.MULTICA_TOKEN_NAME || DEFAULT_TOKEN_NAME;
  assertConsent(consent, `Minting a new Multica PAT named "${tokenName}" requires consent.`, 'Re-run with --yes or approve the PAT mint step.');
  const tokenBody = await httpJson(serverUrl, '/api/tokens', { method: 'POST', token: jwt, body: { name: tokenName } });
  if (!tokenBody?.token) throw bootstrapError('TOKEN_MISSING', 'Multica token creation response did not include a PAT.', 'Check the server response shape before re-running bootstrap.');
  writeJsonFile(configPath, {
    ...existingConfig,
    token: tokenBody.token,
    token_prefix: tokenBody.token_prefix,
    server_url: trimTrailingSlash(serverUrl),
  });
  return { tokenSource: 'minted' };
}
export async function ensureWorkspace({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  slug = DEFAULT_WORKSPACE_SLUG,
  consent = false,
} = {}) {
  if (!token) throw bootstrapError('AUTH_REQUIRED', 'A Multica PAT is required.', 'Call ensureAuth first.');
  if (!/^[a-z0-9-]+$/.test(slug)) {
    throw bootstrapError('INVALID_WORKSPACE_SLUG', `Workspace slug "${slug}" is invalid.`, 'Use only lowercase letters, numbers, and hyphens.');
  }
  const workspaces = normalizeList(await httpJson(serverUrl, '/api/workspaces', { token }), 'workspaces');
  const existing = workspaces.find((workspace) => workspace?.slug === slug);
  if (existing) return { workspaceId: existing.id, issuePrefix: existing.issue_prefix, created: false };
  assertConsent(consent, `Creating Multica workspace "${slug}" requires consent.`, 'Re-run with --yes or create the workspace manually.');
  const created = await httpJson(serverUrl, '/api/workspaces', { method: 'POST', token, body: { name: DEFAULT_WORKSPACE_NAME, slug } });
  return { workspaceId: created.id, issuePrefix: created.issue_prefix, created: true };
}
export async function ensureDaemon({ consent = false } = {}) {
  try {
    const status = childProcess.execSync('multica daemon status', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = status.match(/\bpid[:\s]+(\d+)/i)?.[1] ?? null;
    return { running: true, pid: pid ? Number(pid) : null };
  } catch {
    assertConsent(consent, 'Starting the Multica daemon requires consent.', 'Re-run with --yes or start it manually with `multica daemon start`.');
    try {
      const output = childProcess.execSync('multica daemon start', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const pid = output.match(/\bpid[:\s]+(\d+)/i)?.[1] ?? null;
      return { running: true, pid: pid ? Number(pid) : null };
    } catch (error) {
      throw bootstrapError('DAEMON_START_FAILED', error?.message || 'Failed to start Multica daemon.', 'Start the daemon manually and retry agent reconciliation.');
    }
  }
}
export async function reconcileAgentsWithDeps({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  agentsConfigPath,
  repoRoot = process.cwd(),
  consent = false,
  httpJsonFn = httpJson,
  resolveInstructionsFn = resolveAgentInstructions,
  loadAgentsConfigFn = null,
} = {}) {
  if (!token) throw bootstrapError('AUTH_REQUIRED', 'A Multica PAT is required.', 'Call ensureAuth first.');
  if (!workspaceId) throw bootstrapError('WORKSPACE_REQUIRED', 'A workspace id is required.', 'Call ensureWorkspace first.');
  if (!loadAgentsConfigFn && !agentsConfigPath) {
    throw bootstrapError('AGENTS_CONFIG_REQUIRED', 'An agents config path is required.', 'Pass the path to .pHive/multica/agents.yaml.');
  }
  const config = loadAgentsConfigFn ? await loadAgentsConfigFn(agentsConfigPath) : await loadAgentsConfig(agentsConfigPath);
  const desiredAgents = Array.isArray(config?.agents) ? config.agents : [];

  // Single list call — fetch all existing agents up front
  const existingBody = await httpJsonFn(serverUrl, `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const existingAgents = normalizeList(existingBody, 'agents');
  const existingByName = new Map(existingAgents.map((agent) => [agent.name, agent]));

  // Pre-resolve runtime IDs — one call per unique provider, not per agent
  const uniqueProviders = [...new Set(desiredAgents.map((a) => a.provider).filter(Boolean))];
  const providerToRuntimeId = new Map();
  for (const provider of uniqueProviders) {
    const runtimesBody = await httpJsonFn(serverUrl, `/api/runtimes?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
    const runtimes = normalizeList(runtimesBody, 'runtimes');
    if (runtimes.length === 0) {
      throw bootstrapError('NO_RUNTIMES', 'No Multica runtimes are registered for this workspace.', 'Start the Multica daemon before reconciling agents.');
    }
    const runtime = runtimes.find((candidate) => candidate?.provider === provider);
    if (!runtime?.id) {
      throw bootstrapError('RUNTIME_NOT_FOUND', `No runtime with provider "${provider}" found.`, 'Check that the daemon has registered the expected provider for this workspace.');
    }
    providerToRuntimeId.set(provider, runtime.id);
  }

  // O(1) lookup map for desired agents
  const desiredByName = new Map(desiredAgents.map((a) => [a.name, a]));

  const created = [];
  const patched = [];
  const skipped = [];

  for (const agent of desiredAgents) {
    const runtimeId = providerToRuntimeId.get(agent.provider);
    const instructions = agent.persona_ref ? resolveInstructionsFn(agent, repoRoot) : agent.instructions;
    const payload = buildAgentPayload(agent, runtimeId, instructions);
    const existing = existingByName.get(agent.name);
    if (!existing) {
      assertConsent(consent, `Creating Multica agent "${agent.name}" requires consent.`, 'Re-run with --yes or create the agent manually.');
      await httpJsonFn(serverUrl, `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        token,
        body: payload,
      });
      created.push(agent.name);
      continue;
    }
    const changedFields = diffAgent(existing, payload);
    if (changedFields.length === 0) {
      skipped.push(agent.name);
      continue;
    }
    assertConsent(consent, `Updating Multica agent "${agent.name}" requires consent.`, `Changed fields: ${changedFields.join(', ')}.`);
    await httpJsonFn(serverUrl, `/api/agents/${encodeURIComponent(existing.id)}?workspace_id=${encodeURIComponent(workspaceId)}`, { method: 'PUT', token, body: payload });
    patched.push(agent.name);
  }

  // Detect removed personas — warn but do NOT delete
  const removed = existingAgents.filter((a) => !desiredByName.has(a.name)).map((a) => a.name);
  for (const name of removed) {
    console.warn(`[hive-bootstrap] Agent "${name}" exists in Multica but is not in agents.yaml — skipping deletion for safety.`);
  }

  return { created, patched, skipped, removed };
}

export async function reconcileAgents({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  agentsConfigPath,
  repoRoot = process.cwd(),
  consent = false,
} = {}) {
  return reconcileAgentsWithDeps({ serverUrl, token, workspaceId, agentsConfigPath, repoRoot, consent });
}
