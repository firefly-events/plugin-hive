import crypto from 'node:crypto';

const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-story-dispatch/0.1.0';
const SQUAD_OUTCOME_VALUES = new Set(['action', 'no_action', 'failed']);
// Safety bound on timeline pagination so a misbehaving/looping API can never
// spin forever. 50 pages is far beyond any realistic issue timeline length.
const MAX_TIMELINE_PAGES = 50;
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

function issuesCreateUrl(serverUrl, workspaceId) {
  return `${trimTrailingSlash(serverUrl)}/api/issues?workspace_id=${encodeURIComponent(workspaceId)}`;
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

// Render the "single shared branch" integration contract that tells a dispatched
// agent to check out the epic branch (instead of the daemon's throwaway
// agent/<task> branch) and push its commits back so the next story in the
// dependency chain builds on real prior work. Exported so the dispatch CLI can
// inject it into an existing issue body that predates the contract (e.g. issues
// filed by /plan Phase D before integrationBranch was known).
export function renderIntegrationContract(branch, storyId = null) {
  const qBranch = shQuoteRef(branch);
  const sid = storyId ?? '<story-id>';
  return [
    `## Integration Contract — single shared branch`,
    ``,
    `Work directly on \`${branch}\` (the epic branch). Do NOT use the daemon's auto-created \`agent/developer/<task>\` worktree branch as your commit target.`,
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
    `git commit -m "[${sid}] <type>(<scope>): <description>"`,
    `# fetch + rebase to handle peer dispatches landing concurrently`,
    `git fetch origin ${qBranch}`,
    `git rebase origin/${qBranch}`,
    `git push origin HEAD:${qBranch}`,
    '```',
    ``,
    `**If push rejected (non-fast-forward):** re-run \`git fetch + git rebase + git push\`. Retry up to 3 times. If conflict on rebase, STOP and post the conflict diff as a comment — this means the parallel-dispatch gate let an overlapping story through and orchestrator must adjudicate.`,
    ``,
    `**Final comment on this issue MUST include:** commit SHA(s) you pushed.`,
  ].join('\n');
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

  sections.push(
    [
      `## Insight Capture`,
      `Before finishing, write any distilled implementation insights to \`.hive/insights/${story?.id ?? '<story-id>'}.md\` inside your repo checkout work_dir.`,
      ``,
      `Capture only non-obvious, reusable learning: surprises, gotchas, decisions and why, or things the next agent should know. Do not write a task recap or routine completion summary.`,
    ].join('\n'),
  );

  if (integrationBranch) {
    sections.push(renderIntegrationContract(integrationBranch, story?.id ?? null));
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

// Reset a spent issue (one whose only task is terminal) back to a clean,
// dispatchable state so the daemon spawns a FRESH run on the next assignment.
// Without this, re-PUTting the same assignee on a done issue is a no-op: the
// daemon sees no actionable transition and `readTaskSnapshot` keeps returning
// the stale terminal task — a silent "already done" that masquerades as success.
// We clear the assignee AND move the issue to `todo`, producing a clear
// unassign→reassign transition the daemon can act on.
export async function resetIssueForRerun(serverUrl, token, workspaceId, issueUuid) {
  return httpJson(issueUrl(serverUrl, workspaceId, issueUuid), {
    method: 'PUT',
    token,
    body: { assignee_type: null, assignee_id: null, status: 'todo' },
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

function squadsUrl(serverUrl, workspaceId) {
  return `${trimTrailingSlash(serverUrl)}/api/squads?workspace_id=${encodeURIComponent(workspaceId)}`;
}

export async function resolveSquadUuidByName(serverUrl, token, workspaceId, squadName) {
  const body = await httpJson(squadsUrl(serverUrl, workspaceId), { token });
  const squads = normalizeList(body, 'squads');
  if (squads.length === 0) {
    throw dispatchError('BOOTSTRAP_REQUIRED', 'no Multica squads in workspace; create the squad before running squad mode', undefined, token);
  }
  const match = squads.find((squad) => squad?.name === squadName);
  if (match?.id) return String(match.id);
  const available = squads.map((squad) => squad?.name).filter(Boolean).join(', ');
  throw dispatchError('BOOTSTRAP_REQUIRED', `squad '${squadName}' not found in workspace; available: [${available}]`, undefined, token);
}

export async function dispatchStoryToSquad(serverUrl, token, workspaceId, issueUuid, squadUuid) {
  return httpJson(issueUrl(serverUrl, workspaceId, issueUuid), {
    method: 'PUT', token, body: { assignee_type: 'squad', assignee_id: squadUuid },
  });
}

// ── Orchestrator-driven TDD phase loop (X / floor-manager) ────────────────────
// The /execute orchestrator is the long-lived stateful leader. It runs the TDD
// loop itself and hands the work tree between phases via a shared remote story
// branch (each phase clones + checks out the branch, commits, pushes). No leader
// agent; workers are stateless, one clone per task.

// Build the per-story branch name, e.g. fir/embers-rename/s1-convex-module.
export function resolveStoryBranch(epicId, storyId, prefix = 'fir') {
  const clean = (s) => String(s ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, '-')
    .replace(/\.{2,}/g, '.')          // collapse `..` (git rejects)
    .replace(/\.lock$/i, '')          // refs may not end in `.lock`
    .replace(/^[-.]+|[-.]+$/g, '')    // trim leading/trailing `-` and `.`
    || 'untitled';                    // never emit an empty segment
  return `${clean(prefix)}/${clean(epicId)}/${clean(storyId)}`;
}

const PHASE_DIRECTIVES = {
  red: 'PHASE RED — write failing test(s) that encode the story acceptance criteria. Do NOT implement production code. Run the tests and CONFIRM they fail. Commit message: `test(<story>): red`.',
  green: 'PHASE GREEN — implement the minimum production code to make the red test(s) pass. Do not over-build. Run the tests and confirm they pass. Commit message: `feat(<story>): green`.',
  review: 'PHASE REVIEW — review the accumulated diff against the acceptance criteria AND any "do NOT change" / decision-lock guards in this brief. Write findings to a REVIEW.md (or note "REVIEW: clean"). Do not change production code; only record findings. Commit if REVIEW.md changed.',
  refactor: 'PHASE REFACTOR — apply the REVIEW.md notes, dedupe, and tidy. Tests MUST stay green. Commit message: `refactor(<story>): cleanup`.',
};

// Produce one phase's brief: story context + phase directive + git protocol.
// opts: { storyBranch, baseBranch, repoUrl, isFirst, priorSummaries, cloneDepth, sparsePaths }
//   cloneDepth  — shallow clone depth (default 20: covers the story's phase commits +
//                 base for diff-vs-base, while skipping the monorepo's full history).
//   sparsePaths — optional array of paths for cone sparse-checkout (cuts working-tree
//                 size on large monorepos). Omit when phases run package-wide build/test
//                 that needs the whole package tree.
export function serializePhaseBrief(story, phase, opts = {}) {
  const {
    storyBranch, baseBranch = 'development', repoUrl, isFirst = false,
    priorSummaries = [], cloneDepth = 20, sparsePaths = [],
  } = opts;
  const directive = PHASE_DIRECTIVES[phase] ?? `PHASE ${String(phase).toUpperCase()}`;
  const ac = Array.isArray(story?.acceptance_criteria) ? story.acceptance_criteria : [];
  const url = repoUrl ?? '<repoUrl>';
  // First phase clones the BASE branch (story branch doesn't exist yet) then forks it;
  // later phases clone the story branch directly. Shallow + single-branch keeps it fast.
  const cloneBranch = isFirst ? baseBranch : storyBranch;
  const git = [
    `git clone --depth ${cloneDepth} --single-branch --branch ${cloneBranch} ${url}`,
    `cd "$(basename ${url} .git)"`,
  ];
  if (Array.isArray(sparsePaths) && sparsePaths.length) {
    git.push(`git sparse-checkout set --cone ${sparsePaths.join(' ')}`);
  }
  if (isFirst) git.push(`git checkout -b ${storyBranch}`);
  git.push(
    '# ... perform ONLY this phase\'s work ...',
    'git add -A && git commit -m "<phase-scoped message>"',
    `git push -u origin ${storyBranch}`,
  );
  const sections = [
    `# Story ${story?.id ?? ''}: ${story?.title ?? ''} — ${directive.split(' — ')[0]}`,
    `## Directive\n${directive}`,
    story?.description ? `## Story context\n${String(story.description).trim()}` : '',
    ac.length ? `## Acceptance criteria (whole story)\n${ac.map((c) => `- ${c}`).join('\n')}` : '',
    priorSummaries.length ? `## Prior phases delivered\n${priorSummaries.map((s) => `- ${s}`).join('\n')}` : '',
    [
      '## Git protocol — REQUIRED',
      'Work in your task work_dir. The work tree travels via the remote branch — you MUST clone (shallow), do ONLY this phase, then commit and push. A shallow clone can still push new commits.',
      '```sh',
      ...git,
      '```',
      'If the clone/branch is missing expected prior-phase files, STOP and report — do not improvise.',
    ].join('\n'),
  ].filter(Boolean);
  return sections.join('\n\n');
}

export async function moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid) {
  const url = issueUrl(serverUrl, workspaceId, issueUuid);
  const issue = await httpJson(url, { token });
  if (issue?.status !== 'backlog') return { was_moved: false };

  await httpJson(url, { method: 'PUT', token, body: { status: 'todo' } });
  return { was_moved: true };
}

function timelineUrl(serverUrl, workspaceId, issueUuid) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}/timeline?workspace_id=${encodeURIComponent(workspaceId)}`;
}

// Append the pagination cursor to a timeline URL.
// ASSUMPTION: the Multica timeline endpoint accepts a `cursor` query param and
// returns the next page's token as `next_cursor` (camelCase `nextCursor` also
// tolerated) on the response body. No cursor param name was already established
// in the lib/adapter, so `cursor` is the documented convention here. If the API
// uses a different param, change CURSOR_PARAM and the body keys in one place.
const CURSOR_PARAM = 'cursor';

function withCursor(baseUrl, cursor) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}${CURSOR_PARAM}=${encodeURIComponent(cursor)}`;
}

function extractEntries(body) {
  return Array.isArray(body) ? body : (body?.entries ?? body?.data ?? []);
}

function extractNextCursor(body) {
  if (Array.isArray(body) || body == null) return null;
  const next = body.next_cursor ?? body.nextCursor ?? null;
  // Treat empty string / falsy values as "no more pages".
  return typeof next === 'string' && next.length > 0 ? next : null;
}

// Shared paginated timeline reader. Follows `next_cursor` across pages and
// accumulates entries so the most-recent entry is found regardless of page.
// `fetchPage(url)` must return the already-parsed response body (the caller
// owns auth/transport error mapping). Reused by BOTH timeline call sites
// (readSquadEvaluation here and getSquadActivity in the multica adapter) so
// pagination lives in exactly one place — mirrors the shared
// parseSquadActivityFromEntries factoring from plu-341.
export async function fetchTimelineEntries(baseUrl, fetchPage) {
  const entries = [];
  let cursor = null;
  for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
    const url = cursor ? withCursor(baseUrl, cursor) : baseUrl;
    const body = await fetchPage(url);
    entries.push(...extractEntries(body));
    cursor = extractNextCursor(body);
    if (!cursor) return entries;
  }
  // Hit the safety bound: return what we have rather than loop forever. This is
  // advisory read-side data, so a truncated read must never throw/gate.
  return entries;
}

export function parseSquadActivityFromEntries(entries) {
  const evals = entries.filter(
    (e) => e?.type === 'activity' && e?.action === 'squad_leader_evaluated',
  );
  if (evals.length === 0) return null;
  evals.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const latest = evals[0];
  const details = latest?.details ?? {};
  const outcomeRaw = details?.outcome;
  if (typeof outcomeRaw !== 'string' || !SQUAD_OUTCOME_VALUES.has(outcomeRaw)) {
    throw new Error(`Unexpected squad_leader_evaluated outcome value: '${String(outcomeRaw)}'`);
  }
  return {
    actor_type: latest?.actor_type ?? null,
    actor_id: latest?.actor_id ?? null,
    outcome: outcomeRaw,
    reason: details?.reason ?? null,
    created_at: latest?.created_at ?? null,
  };
}

// List existing issues and return the first whose title exactly matches `titleKey`,
// or null if none found. Used for server-side idempotency dedup before issue creation.
async function findIssueByTitle(serverUrl, token, workspaceId, titleKey) {
  const body = await httpJson(issuesCreateUrl(serverUrl, workspaceId), { token });
  const issues = normalizeList(body, 'issues');
  return issues.find((i) => i?.title === titleKey) ?? null;
}

// POST /api/issues — mint a new issue carrying the provided brief as its description.
// When `dedupTitle` is provided, lists existing issues first and returns any matching
// one instead of creating a duplicate (server-side idempotency guard for cross-machine
// resume). Returns {id, url, ...} from the API response.
export async function createIssue(serverUrl, token, workspaceId, title, description, { dedupTitle = null, integrationBranch = null } = {}) {
  if (dedupTitle) {
    const existing = await findIssueByTitle(serverUrl, token, workspaceId, dedupTitle);
    if (existing?.id) return existing;
  }
  const body = { title, description };
  // Bind the issue to the epic's shared integration branch (structured field the
  // daemon reads to key branch-shared worktree reuse — NOT just the body contract).
  if (integrationBranch) body.integration_branch = String(integrationBranch);
  const created = await httpJson(issuesCreateUrl(serverUrl, workspaceId), {
    method: 'POST',
    token,
    body,
  });
  return created;
}

// Fetch the agent branch from the remote repo and fast-forward-merge the target sha
// into the working tree at workDir. Fails with code NON_FF if the merge would not be
// a fast-forward. repoUrl may be a bare repo path or a remote URL.
export async function reconcileBranch(repoUrl, branch, sha, workDir) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execAsync = promisify(execFile);

  const run = (cmd, args, cwd) =>
    execAsync(cmd, args, { cwd: cwd ?? workDir }).then((r) => r.stdout.trim());

  // Fetch the branch from the remote so FETCH_HEAD resolves to the tip.
  await run('git', ['fetch', repoUrl, branch]);

  // Verify the target sha is reachable from FETCH_HEAD (not just present as an object).
  // `cat-file -e` only proves the object exists locally (could be a stale fetch); it does
  // NOT prove the sha is an ancestor of the branch tip we just fetched. Using
  // `merge-base --is-ancestor` catches the case where the sha was downloaded by a prior
  // fetch of a different branch but is not reachable from the current FETCH_HEAD.
  try {
    await run('git', ['merge-base', '--is-ancestor', sha, 'FETCH_HEAD']);
  } catch {
    throw dispatchError(
      'SHA_NOT_FOUND',
      `sha ${sha} is not reachable from FETCH_HEAD of branch ${branch} from ${repoUrl}`,
    );
  }

  // Attempt ff-only merge. If it fails it is a non-ff situation — bail loudly.
  try {
    const out = await run('git', ['merge', '--ff-only', sha]);
    return { merged: true, sha, output: out };
  } catch (err) {
    throw dispatchError(
      'NON_FF',
      `fast-forward merge of ${sha} into working tree failed (non-ff): ${err?.message ?? String(err)}`,
      `Run 'git log --oneline HEAD..${sha}' in ${workDir} to inspect the divergence.`,
    );
  }
}

export async function readSquadEvaluation(issueId, options = {}) {
  const { serverUrl, token, workspaceId } = options;
  const baseUrl = timelineUrl(serverUrl, workspaceId, issueId);

  let entries;
  try {
    entries = await fetchTimelineEntries(baseUrl, (url) => httpJson(url, { token }));
  } catch (err) {
    if (err?.code === 'HTTP_401' || err?.code === 'HTTP_403') {
      throw dispatchError(
        'AUTH_FAILURE',
        err.message ?? 'Multica auth failed',
        'Run /hive:multica-init to configure credentials',
        token,
      );
    }
    throw err;
  }

  try {
    const evaluation = parseSquadActivityFromEntries(entries);
    return { evaluation };
  } catch (err) {
    throw dispatchError('TRANSPORT', err.message, undefined, token);
  }
}
