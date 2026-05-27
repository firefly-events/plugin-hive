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

async function loadSquadsConfig(squadsConfigPath) {
  const yamlString = fs.readFileSync(squadsConfigPath, 'utf8');
  const yaml = await import('js-yaml');
  return yaml.load(yamlString);
}

export async function reconcileSquadsWithDeps({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  squadsConfigPath,
  consent = false,
  httpJsonFn = httpJson,
  loadSquadsConfigFn = null,
} = {}) {
  if (!token) throw bootstrapError('AUTH_REQUIRED', 'A Multica PAT is required.', 'Call ensureAuth first.');
  if (!workspaceId) throw bootstrapError('WORKSPACE_REQUIRED', 'A workspace id is required.', 'Call ensureWorkspace first.');
  if (!loadSquadsConfigFn && !squadsConfigPath) {
    throw bootstrapError('SQUADS_CONFIG_REQUIRED', 'A squads config path is required.', 'Pass the path to .pHive/multica/squads.yaml.');
  }

  const config = loadSquadsConfigFn
    ? await loadSquadsConfigFn(squadsConfigPath)
    : await loadSquadsConfig(squadsConfigPath);
  const desiredSquads = Array.isArray(config?.squads) ? config.squads : [];

  // Resolve agent names → IDs
  const agentsBody = await httpJsonFn(serverUrl, `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const existingAgents = normalizeList(agentsBody, 'agents');
  const agentIdByName = new Map(existingAgents.map((a) => [a.name, a.id]));
  const agentNameById = new Map(existingAgents.map((a) => [a.id, a.name]));

  // Fetch existing squads
  const squadsBody = await httpJsonFn(serverUrl, `/api/squads?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const existingSquads = normalizeList(squadsBody, 'squads');
  const existingByName = new Map(existingSquads.map((s) => [s.name, s]));
  const desiredByName = new Map(desiredSquads.map((s) => [s.name, s]));

  const created = [];
  const patched = [];
  const skipped = [];
  const membersAdded = [];
  const membersRemoved = [];

  for (const squad of desiredSquads) {
    const leaderId = agentIdByName.get(squad.leader);
    if (!leaderId) {
      console.warn(`[hive-bootstrap] Squad "${squad.name}" leader "${squad.leader}" not found in agents — skipping squad.`);
      continue;
    }

    // Non-leader members from YAML
    const desiredMemberNames = (squad.members || []).filter((m) => m !== squad.leader);

    const existing = existingByName.get(squad.name);

    if (!existing) {
      assertConsent(consent, `Creating Multica squad "${squad.name}" requires consent.`, 'Re-run with --yes or create the squad manually.');
      const createdSquad = await httpJsonFn(serverUrl, `/api/squads?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        token,
        body: { name: squad.name, description: squad.description || '', leader_id: leaderId },
      });
      created.push(squad.name);

      for (const memberName of desiredMemberNames) {
        const memberId = agentIdByName.get(memberName);
        if (!memberId) {
          console.warn(`[hive-bootstrap] Squad "${squad.name}" member "${memberName}" not found in agents — skipping.`);
          continue;
        }
        assertConsent(consent, `Adding member "${memberName}" to squad "${squad.name}" requires consent.`, 'Re-run with --yes.');
        await httpJsonFn(serverUrl, `/api/squads/${encodeURIComponent(createdSquad.id)}/members?workspace_id=${encodeURIComponent(workspaceId)}`, {
          method: 'POST',
          token,
          body: { member_id: memberId, member_type: 'agent', role: 'member' },
        });
        membersAdded.push(`${squad.name}:${memberName}`);
      }
      continue;
    }

    // Squad exists — check metadata drift
    const descriptionDrifted = squad.description !== undefined && existing.description !== squad.description;
    const leaderDrifted = existing.leader_id !== leaderId;
    if (leaderDrifted || descriptionDrifted) {
      assertConsent(consent, `Updating Multica squad "${squad.name}" requires consent.`, 'Re-run with --yes.');
      await httpJsonFn(serverUrl, `/api/squads/${encodeURIComponent(existing.id)}?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'PUT',
        token,
        body: {
          name: squad.name,
          description: squad.description ?? existing.description ?? '',
          leader_id: leaderId,
        },
      });
      patched.push(squad.name);
    } else {
      skipped.push(squad.name);
    }

    // Reconcile members for existing squad
    const membersBody = await httpJsonFn(serverUrl, `/api/squads/${encodeURIComponent(existing.id)}/members?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
    const currentMembers = normalizeList(membersBody, 'members');
    const regularMembers = currentMembers.filter((m) => m.role !== 'leader');
    const currentMemberIds = new Set(regularMembers.map((m) => m.member_id));

    const desiredMemberIds = new Set(
      desiredMemberNames.map((n) => agentIdByName.get(n)).filter(Boolean),
    );

    for (const memberName of desiredMemberNames) {
      const memberId = agentIdByName.get(memberName);
      if (!memberId) {
        console.warn(`[hive-bootstrap] Squad "${squad.name}" member "${memberName}" not found in agents — skipping.`);
        continue;
      }
      if (currentMemberIds.has(memberId)) continue;
      assertConsent(consent, `Adding member "${memberName}" to squad "${squad.name}" requires consent.`, 'Re-run with --yes.');
      await httpJsonFn(serverUrl, `/api/squads/${encodeURIComponent(existing.id)}/members?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        token,
        body: { member_id: memberId, member_type: 'agent', role: 'member' },
      });
      membersAdded.push(`${squad.name}:${memberName}`);
    }

    for (const member of regularMembers) {
      if (desiredMemberIds.has(member.member_id)) continue;
      const memberName = agentNameById.get(member.member_id) ?? member.member_id;
      assertConsent(consent, `Removing member "${memberName}" from squad "${squad.name}" requires consent.`, 'Re-run with --yes.');
      await httpJsonFn(
        serverUrl,
        `/api/squads/${encodeURIComponent(existing.id)}/members/${encodeURIComponent(member.member_id)}?workspace_id=${encodeURIComponent(workspaceId)}&type=agent`,
        { method: 'DELETE', token },
      );
      membersRemoved.push(`${squad.name}:${memberName}`);
    }
  }

  // Removed squads — warn, never delete
  const removed = existingSquads.filter((s) => !desiredByName.has(s.name)).map((s) => s.name);
  for (const name of removed) {
    console.warn(`[hive-bootstrap] Squad "${name}" exists in Multica but is not in squads.yaml — skipping deletion for safety.`);
  }

  return { created, patched, skipped, removed, membersAdded, membersRemoved };
}

export async function reconcileSquads({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  squadsConfigPath,
  consent = false,
} = {}) {
  return reconcileSquadsWithDeps({ serverUrl, token, workspaceId, squadsConfigPath, consent });
}

async function loadAutopilotsConfig(autopilotsConfigPath) {
  const yamlString = fs.readFileSync(autopilotsConfigPath, 'utf8');
  const yaml = await import('js-yaml');
  return yaml.load(yamlString);
}

/**
 * Reconcile autopilots from a YAML config against the Multica server.
 *
 * NOTE: Autopilot identity on the server side is matched by `title` (since
 * the `name` field in the YAML is not stored server-side). If two YAML
 * entries share the same title, behavior is undefined.
 *
 * Returns: { created, patched, skipped, removed, triggersAdded, triggersRemoved, triggersUpdated, webhookUrlsCaptured }
 */
export async function reconcileAutopilotsWithDeps({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  autopilotsConfigPath,
  consent = false,
  httpJsonFn = httpJson,
  loadAutopilotsConfigFn = null,
} = {}) {
  if (!token) throw bootstrapError('AUTH_REQUIRED', 'A Multica PAT is required.', 'Call ensureAuth first.');
  if (!workspaceId) throw bootstrapError('WORKSPACE_REQUIRED', 'A workspace id is required.', 'Call ensureWorkspace first.');
  if (!loadAutopilotsConfigFn && !autopilotsConfigPath) {
    throw bootstrapError('AUTOPILOTS_CONFIG_REQUIRED', 'An autopilots config path is required.', 'Pass the path to .pHive/multica/autopilots.yaml.');
  }

  const config = loadAutopilotsConfigFn
    ? await loadAutopilotsConfigFn(autopilotsConfigPath)
    : await loadAutopilotsConfig(autopilotsConfigPath);
  const desiredAutopilots = Array.isArray(config?.autopilots) ? config.autopilots : [];

  // Resolve agent names → IDs
  const agentsBody = await httpJsonFn(serverUrl, `/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const existingAgents = normalizeList(agentsBody, 'agents');
  const agentIdByName = new Map(existingAgents.map((a) => [a.name, a.id]));

  // Fetch existing autopilots
  const autopilotsBody = await httpJsonFn(serverUrl, `/api/autopilots?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
  const existingAutopilots = normalizeList(autopilotsBody, 'autopilots');
  // Match by title (server-side unique key)
  const existingByTitle = new Map(existingAutopilots.map((ap) => [ap.title, ap]));
  const desiredTitles = new Set(desiredAutopilots.map((ap) => ap.title));

  const created = [];
  const patched = [];
  const skipped = [];
  const triggersAdded = [];
  const triggersRemoved = [];
  const triggersUpdated = [];
  // Map from autopilot name (YAML) → captured webhook URL
  const webhookUrlsCaptured = {};

  // Helper: build autopilot payload from YAML entry + resolved agent_id
  function buildAutopilotPayload(ap, agentId) {
    const payload = {
      title: ap.title,
      description: ap.description ?? '',
      agent_id: agentId,
      mode: ap.mode ?? 'run_only',
      priority: ap.priority ?? 'none',
      status: ap.status ?? 'active',
    };
    if (ap.issue_title_template != null && ap.issue_title_template !== '') {
      payload.issue_title_template = ap.issue_title_template;
    }
    if (ap.project != null && ap.project !== '') {
      payload.project_id = ap.project;
    }
    return payload;
  }

  // Helper: trigger identity key for matching
  function triggerKey(trigger) {
    if (trigger.kind === 'schedule') return `schedule::${trigger.cron ?? ''}`;
    if (trigger.kind === 'webhook') return `webhook::${trigger.label ?? ''}`;
    return `${trigger.kind}::${trigger.label ?? ''}`;
  }

  // Helper: check if a server trigger matches a desired trigger (beyond identity)
  function triggerDrifted(serverTrigger, desiredTrigger) {
    if (desiredTrigger.kind === 'schedule') {
      return serverTrigger.cron !== desiredTrigger.cron || serverTrigger.timezone !== desiredTrigger.timezone || serverTrigger.label !== desiredTrigger.label;
    }
    if (desiredTrigger.kind === 'webhook') {
      return serverTrigger.label !== desiredTrigger.label;
    }
    return false;
  }

  // Helper: build trigger payload
  function buildTriggerPayload(trigger) {
    if (trigger.kind === 'schedule') {
      return { kind: 'schedule', cron: trigger.cron, timezone: trigger.timezone ?? 'UTC', label: trigger.label ?? '' };
    }
    if (trigger.kind === 'webhook') {
      return { kind: 'webhook', label: trigger.label ?? '' };
    }
    return { kind: trigger.kind, label: trigger.label ?? '' };
  }

  // Helper: reconcile triggers for an autopilot ID
  async function reconcileTriggers(autopilotId, desiredTriggers, autopilotName) {
    const triggersBody = await httpJsonFn(serverUrl, `/api/autopilots/${encodeURIComponent(autopilotId)}/triggers?workspace_id=${encodeURIComponent(workspaceId)}`, { token });
    const serverTriggers = normalizeList(triggersBody, 'triggers');

    const serverByKey = new Map(serverTriggers.map((t) => [triggerKey(t), t]));
    const desiredByKey = new Map((desiredTriggers || []).map((t) => [triggerKey(t), t]));

    // Add or update
    for (const [key, desiredTrigger] of desiredByKey) {
      const serverTrigger = serverByKey.get(key);
      if (!serverTrigger) {
        // Add trigger
        const payload = buildTriggerPayload(desiredTrigger);
        const triggerResponse = await httpJsonFn(
          serverUrl,
          `/api/autopilots/${encodeURIComponent(autopilotId)}/triggers?workspace_id=${encodeURIComponent(workspaceId)}`,
          { method: 'POST', token, body: payload },
        );
        triggersAdded.push(`${autopilotName}:${key}`);
        // Capture webhook URL if present
        if (desiredTrigger.kind === 'webhook' && triggerResponse?.webhook_url && !webhookUrlsCaptured[autopilotName]) {
          webhookUrlsCaptured[autopilotName] = triggerResponse.webhook_url;
        }
      } else if (triggerDrifted(serverTrigger, desiredTrigger)) {
        // Update trigger
        const payload = buildTriggerPayload(desiredTrigger);
        const triggerResponse = await httpJsonFn(
          serverUrl,
          `/api/autopilots/${encodeURIComponent(autopilotId)}/triggers/${encodeURIComponent(serverTrigger.id)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          { method: 'PUT', token, body: payload },
        );
        triggersUpdated.push(`${autopilotName}:${key}`);
        // Capture webhook URL if updated
        if (desiredTrigger.kind === 'webhook' && triggerResponse?.webhook_url && !webhookUrlsCaptured[autopilotName]) {
          webhookUrlsCaptured[autopilotName] = triggerResponse.webhook_url;
        }
      }
    }

    // Delete triggers in server but not in desired
    for (const [key, serverTrigger] of serverByKey) {
      if (!desiredByKey.has(key)) {
        await httpJsonFn(
          serverUrl,
          `/api/autopilots/${encodeURIComponent(autopilotId)}/triggers/${encodeURIComponent(serverTrigger.id)}?workspace_id=${encodeURIComponent(workspaceId)}`,
          { method: 'DELETE', token },
        );
        triggersRemoved.push(`${autopilotName}:${key}`);
      }
    }
  }

  for (const ap of desiredAutopilots) {
    const agentId = agentIdByName.get(ap.agent);
    if (!agentId) {
      console.warn(`[hive-bootstrap] Autopilot "${ap.name}" agent "${ap.agent}" not found in agents — skipping autopilot.`);
      continue;
    }

    const payload = buildAutopilotPayload(ap, agentId);
    const existing = existingByTitle.get(ap.title);

    if (!existing) {
      assertConsent(consent, `Creating Multica autopilot "${ap.name}" (title: "${ap.title}") requires consent.`, 'Re-run with --yes or create the autopilot manually.');
      const createdAp = await httpJsonFn(serverUrl, `/api/autopilots?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'POST',
        token,
        body: payload,
      });
      created.push(ap.name);

      // Add triggers for the newly created autopilot
      if (ap.triggers && ap.triggers.length > 0) {
        await reconcileTriggers(createdAp.id, ap.triggers, ap.name);
      }
      continue;
    }

    // Check metadata drift
    const drifted =
      existing.description !== payload.description ||
      existing.agent_id !== payload.agent_id ||
      existing.mode !== payload.mode ||
      existing.priority !== payload.priority ||
      existing.status !== payload.status ||
      (payload.issue_title_template !== undefined && existing.issue_title_template !== payload.issue_title_template) ||
      (payload.project_id !== undefined && existing.project_id !== payload.project_id);

    if (drifted) {
      assertConsent(consent, `Updating Multica autopilot "${ap.name}" (title: "${ap.title}") requires consent.`, 'Re-run with --yes.');
      await httpJsonFn(serverUrl, `/api/autopilots/${encodeURIComponent(existing.id)}?workspace_id=${encodeURIComponent(workspaceId)}`, {
        method: 'PUT',
        token,
        body: payload,
      });
      patched.push(ap.name);
    } else {
      skipped.push(ap.name);
    }

    // Always reconcile triggers for existing autopilots
    await reconcileTriggers(existing.id, ap.triggers || [], ap.name);
  }

  // Orphan safety — warn but never delete
  const removed = existingAutopilots.filter((ap) => !desiredTitles.has(ap.title)).map((ap) => ap.title);
  for (const title of removed) {
    console.warn(`[hive-bootstrap] Autopilot with title "${title}" exists in Multica but is not in autopilots.yaml — skipping deletion for safety.`);
  }

  // Write back webhook URLs to the config file if any were captured
  if (Object.keys(webhookUrlsCaptured).length > 0 && autopilotsConfigPath) {
    try {
      const yaml = await import('js-yaml');
      const rawYaml = fs.readFileSync(autopilotsConfigPath, 'utf8');
      const configData = yaml.load(rawYaml);
      let modified = false;
      for (const ap of configData?.autopilots ?? []) {
        if (webhookUrlsCaptured[ap.name]) {
          ap.webhook_url = webhookUrlsCaptured[ap.name];
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(autopilotsConfigPath, yaml.dump(configData), 'utf8');
      }
    } catch (err) {
      console.warn(`[hive-bootstrap] Failed to write back webhook URLs to ${autopilotsConfigPath}: ${err?.message}`);
    }
  }

  return { created, patched, skipped, removed, triggersAdded, triggersRemoved, triggersUpdated, webhookUrlsCaptured };
}

export async function reconcileAutopilots({
  serverUrl = DEFAULT_SERVER_URL,
  token,
  workspaceId,
  autopilotsConfigPath,
  consent = false,
} = {}) {
  return reconcileAutopilotsWithDeps({ serverUrl, token, workspaceId, autopilotsConfigPath, consent });
}
