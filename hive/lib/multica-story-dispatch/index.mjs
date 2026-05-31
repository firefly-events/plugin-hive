import crypto from 'node:crypto';

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

function resolveCodexInstruction(options) {
  const { codexInstruction = false, dispatchingPersona, agents, agentBackends } = options;
  if (dispatchingPersona !== undefined && dispatchingPersona !== null) {
    const entry = Array.isArray(agents)
      ? agents.find((a) => a?.name === dispatchingPersona)
      : null;
    const effectiveProvider = entry?.provider ?? 'claude';
    if (effectiveProvider === 'codex') return false;
    return agentBackends?.[dispatchingPersona] === 'codex';
  }
  return codexInstruction;
}

// Single-quote a git ref for safe interpolation into the rendered shell snippets.
// Git refs may legally contain shell metacharacters (e.g. `$`, `;`, `(`), so quote
// once and escape embedded single quotes the POSIX way ('\'').
function shQuoteRef(ref) {
  return `'${String(ref).replace(/'/g, "'\\''")}'`;
}

export function serializeStoryBrief(story, options = {}) {
  const { integrationBranch = null } = options;
  const showCodexInstruction = resolveCodexInstruction(options);
  const sections = [];

  if (story?.description) {
    sections.push(`## Goal\n${cleanText(story.description)}`);
  }

  if (showCodexInstruction) {
    sections.push(
      `## Use /codex:rescue\nThis story is routed through the Codex backend. For implementation work, invoke the /codex:rescue skill with the story spec from this brief rather than writing code directly. Return changes for the orchestrator to commit.`,
    );
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

  if (integrationBranch) {
    const qBranch = shQuoteRef(integrationBranch);
    sections.push(
      [
        `## Integration Contract — single shared branch`,
        ``,
        `Work directly on \`${integrationBranch}\` (the epic branch). Do NOT use the daemon's auto-created \`agent/developer/<task>\` worktree branch as your commit target.`,
        ``,
        `**First action (overrides daemon checkout):**`,
        '```sh',
        `git fetch origin ${qBranch}`,
        `git checkout ${qBranch}`,
        `git reset --hard origin/${qBranch}`,
        '```',
        ``,
        `**After completing all acceptance criteria:**`,
        '```sh',
        `git add <specific files for this story>`,
        `git commit -m "[${story?.id ?? '<story-id>'}] <type>(<scope>): <description>"`,
        `# fetch + rebase to handle peer dispatches landing concurrently`,
        `git fetch origin ${qBranch}`,
        `git rebase origin/${qBranch}`,
        `git push origin HEAD:${qBranch}`,
        '```',
        ``,
        `**If push rejected (non-fast-forward):** re-run \`git fetch + git rebase + git push\`. Retry up to 3 times. If conflict on rebase, STOP and post the conflict diff as a comment — this means the parallel-dispatch gate let an overlapping story through and orchestrator must adjudicate.`,
        ``,
        `**Final comment on this issue MUST include:** commit SHA(s) you pushed.`,
      ].join('\n'),
    );
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

function normalizePersonaDispatches(personaIssues) {
  if (Array.isArray(personaIssues)) {
    return personaIssues.map((entry) => ({
      persona: entry?.persona ?? entry?.agent ?? entry?.name,
      issueUuid: entry?.issueUuid ?? entry?.issue_uuid ?? entry?.issueId ?? entry?.issue_id,
    }));
  }

  return Object.entries(personaIssues ?? {}).map(([persona, issueUuid]) => ({
    persona,
    issueUuid,
  }));
}

export async function dispatchStoryToPersonas(
  serverUrl,
  token,
  workspaceId,
  story,
  personaIssues,
  options = {},
) {
  const {
    agents = [],
    agentBackends = options.agent_backends ?? {},
    integrationBranch = null,
    moveOutOfBacklog = true,
  } = options;
  // Routing-contract rendering must reflect the actual agent the issue is assigned to.
  // Fall back to the populated AGENT_CACHE when the caller omits options.agents so the
  // rendered /codex:rescue (or absence thereof) matches the resolved agent's provider.
  const resolvedAgents =
    agents.length > 0 ? agents : AGENT_CACHE.get(cacheKey(serverUrl, workspaceId, token)) ?? [];
  const dispatches = [];

  for (const entry of normalizePersonaDispatches(personaIssues)) {
    const { persona, issueUuid } = entry;
    if (!persona) {
      throw dispatchError('INVALID_PERSONA_DISPATCH', 'persona dispatch is missing persona', undefined, token);
    }
    if (!issueUuid) {
      throw dispatchError(
        'INVALID_PERSONA_DISPATCH',
        `persona dispatch for '${persona}' is missing issue UUID`,
        undefined,
        token,
      );
    }

    const agentUuid = await resolveAgentUuidByName(serverUrl, token, workspaceId, persona);
    const briefAgents =
      resolvedAgents.length > 0
        ? resolvedAgents
        : AGENT_CACHE.get(cacheKey(serverUrl, workspaceId, token)) ?? [];
    const brief = serializeStoryBrief(story, {
      dispatchingPersona: persona,
      agents: briefAgents,
      agentBackends,
      integrationBranch,
    });
    const briefResult = await ensureIssueBriefMatches(serverUrl, token, workspaceId, issueUuid, brief);
    const issue = await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid);
    const backlogResult = moveOutOfBacklog
      ? await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid)
      : { was_moved: false };

    dispatches.push({
      persona,
      issue_uuid: issueUuid,
      agent_uuid: agentUuid,
      was_updated: briefResult.was_updated,
      was_moved: backlogResult.was_moved,
      issue,
    });
  }

  return {
    carrier: 'per-persona-fan-out',
    dispatches,
  };
}

export async function moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid) {
  const url = issueUrl(serverUrl, workspaceId, issueUuid);
  const issue = await httpJson(url, { token });
  if (issue?.status !== 'backlog') return { was_moved: false };

  await httpJson(url, { method: 'PUT', token, body: { status: 'todo' } });
  return { was_moved: true };
}
