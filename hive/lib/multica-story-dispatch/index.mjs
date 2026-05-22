import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-story-dispatch/0.1.0';
const AGENT_CACHE = new Map();

function sanitize(str, token) {
  if (str == null) return str;
  let safe = String(str)
    .replace(/mul_[A-Za-z0-9._~+/=-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/pat_[A-Za-z0-9._~+/=-]+/gi, '[redacted-token]');
  if (token) safe = safe.split(String(token)).join('[redacted-token]');
  return safe;
}

function dispatchError(code, message, hint, token) {
  const envelope = { code, message: sanitize(message, token) };
  if (hint !== undefined) envelope.hint = sanitize(hint, token);
  return envelope;
}

function trimTrailingSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

function tokenFingerprint(token) {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex').slice(0, 16);
}

function cacheKey(serverUrl, workspaceId, token) {
  return `${trimTrailingSlash(serverUrl)}:${workspaceId}:${tokenFingerprint(token)}`;
}

function normalizeList(body, key) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

async function httpJson(url, opts = {}) {
  const { method = 'GET', token, body } = opts;
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw dispatchError('TRANSPORT', 'Multica request timed out after 30s', undefined, token);
    }
    throw dispatchError(
      'TRANSPORT',
      error?.message || 'Unable to reach Multica server',
      undefined,
      token,
    );
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
  throw dispatchError(
    `HTTP_${response.status}`,
    message,
    `Request ${method} ${url} failed with HTTP ${response.status}.`,
    token,
  );
}

function issueUrl(serverUrl, workspaceId, issueUuid) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function agentsUrl(serverUrl, workspaceId) {
  return `${trimTrailingSlash(serverUrl)}/api/agents?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function cleanText(value) {
  return String(value ?? '').replace(/^\s+/, '');
}

function formatBullet(value) {
  return `- ${String(value ?? '')}`;
}

function formatFileEntry(entry) {
  if (typeof entry === 'string') return `- \`${entry}\``;
  const file = entry?.file ?? entry?.path ?? entry?.name ?? '';
  const change = entry?.change ?? entry?.description ?? entry?.reason ?? 'touch';
  return `- \`${file}\` — ${change}`;
}

function formatCodeExample(example) {
  const title = example?.title ? `### ${example.title}\n` : '';
  const file = example?.file || example?.path ? `\`${example.file ?? example.path}\`\n` : '';
  const language = example?.language ?? example?.lang ?? '';
  const snippet = example?.snippet ?? example?.code ?? '';
  return `${title}${file}\`\`\`${language}\n${snippet}\n\`\`\``;
}

function formatReference(reference) {
  if (typeof reference === 'string') return `- \`${reference}\` — see file`;
  const path = reference?.path ?? reference?.file ?? reference?.url ?? '';
  const excerpt = reference?.relevant_excerpt ?? reference?.excerpt ?? 'see file';
  return `- \`${path}\` — ${excerpt || 'see file'}`;
}

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
}

export function __resetCache() {
  AGENT_CACHE.clear();
}

export function serializeStoryBrief(story) {
  const sections = [];

  if (story?.description) {
    sections.push(`## Goal\n${cleanText(story.description)}`);
  }

  if (hasItems(story?.acceptance_criteria)) {
    sections.push(`## Acceptance Criteria\n${story.acceptance_criteria.map(formatBullet).join('\n')}`);
  }

  if (hasItems(story?.files_to_modify)) {
    sections.push(`## Files to Touch\n${story.files_to_modify.map(formatFileEntry).join('\n')}`);
  }

  if (hasItems(story?.code_examples)) {
    sections.push(`## Code Examples\n${story.code_examples.map(formatCodeExample).join('\n\n')}`);
  }

  if (hasItems(story?.references)) {
    sections.push(`## References\n${story.references.map(formatReference).join('\n')}`);
  }

  sections.push(
    `---\n_Generated by hive multica-story-dispatch — story ${story?.id ?? ''} in epic ${story?.epic ?? ''}_`,
  );

  return `${sections.join('\n\n')}\n`;
}

export async function resolveAgentUuidByName(serverUrl, token, workspaceId, agentName) {
  const key = cacheKey(serverUrl, workspaceId, token);
  let agents = AGENT_CACHE.get(key);
  if (!agents) {
    const body = await httpJson(agentsUrl(serverUrl, workspaceId), { token });
    agents = normalizeList(body, 'agents');
    AGENT_CACHE.set(key, agents);
  }

  if (agents.length === 0) {
    throw dispatchError(
      'BOOTSTRAP_REQUIRED',
      'no Multica agents in workspace; run /hive:multica-init to bootstrap',
      undefined,
      token,
    );
  }

  const match = agents.find((agent) => agent?.name === agentName);
  if (match?.id) return String(match.id);

  const available = agents.map((agent) => agent?.name).filter(Boolean).join(', ');
  throw dispatchError(
    'BOOTSTRAP_REQUIRED',
    `agent '${agentName}' not found in workspace; available: [${available}]; run /hive:multica-init to bootstrap`,
    undefined,
    token,
  );
}

export async function ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief) {
  const url = issueUrl(serverUrl, workspaceId, issueUuid);
  const current = await httpJson(url, { token });
  if (current?.description === brief) {
    return { was_updated: false, current_brief: current.description };
  }

  await httpJson(url, { method: 'PUT', token, body: { description: brief } });
  return { was_updated: true, current_brief: brief };
}

export async function dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid) {
  return httpJson(issueUrl(serverUrl, workspaceId, issueUuid), {
    method: 'PUT',
    token,
    body: { assignee_type: 'agent', assignee_id: agentUuid },
  });
}

export async function moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid) {
  const url = issueUrl(serverUrl, workspaceId, issueUuid);
  const issue = await httpJson(url, { token });
  if (issue?.status !== 'backlog') return { was_moved: false };

  await httpJson(url, { method: 'PUT', token, body: { status: 'todo' } });
  return { was_moved: true };
}

/**
 * H3 enforcement: verify the agent did NOT push to its orphan branch.
 *
 * Runs `git ls-remote origin agent/developer/{taskId}` against the firefly
 * remote. If the ref exists, the agent pushed to the wrong branch.
 *
 * @returns {{ orphanPushExists: boolean, taskId: string, epicId: string }}
 */
export async function verifyPushTarget(taskId, epicId) {
  try {
    const { stdout } = await execFileAsync('git', [
      'ls-remote',
      'origin',
      `agent/developer/${taskId}`,
    ]);
    const orphanPushExists = stdout.trim().length > 0;
    return { orphanPushExists, taskId, epicId };
  } catch (err) {
    throw Object.assign(
      new Error(
        `verifyPushTarget: git ls-remote failed for task ${taskId}: ${err?.message}`,
      ),
      { code: 'TRANSPORT' },
    );
  }
}
