#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
  resolveAgentUuidByName,
  resolveSquadUuidByName,
  moveOutOfBacklogIfNeeded,
  dispatchStoryToAgent,
  dispatchStoryToSquad,
  createIssue,
  reconcileBranch,
  renderIntegrationContract,
  resetIssueForRerun,
  fetchPriorExperienceSection,
} from './index.mjs';

import { pollTaskUntilTerminal, writeMulticaRunEpisode } from './episode-sync.mjs';
import {
  readHermesReconcilerState,
  writeHermesReconcilerState,
  VALID_GATE_STATES,
} from '../hermes-reconciler/state.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-story-dispatch-cli/0.1.0';
const BRIEF_PROVENANCE_RE =
  /<!--\s*hive-dispatch-provenance:\s*brief-sha256=([0-9a-f]{64});\s*task-id=([^\s]+)\s*-->\n*/i;

function stripBriefProvenance(description) {
  return String(description ?? '').replace(BRIEF_PROVENANCE_RE, '');
}

function briefDigest(description) {
  return createHash('sha256').update(stripBriefProvenance(description), 'utf8').digest('hex');
}

function readBriefProvenance(description) {
  const match = BRIEF_PROVENANCE_RE.exec(String(description ?? ''));
  return match ? { digest: match[1].toLowerCase(), taskId: match[2] } : null;
}

function writeBriefProvenance(description, digest, taskId) {
  const marker =
    `<!-- hive-dispatch-provenance: brief-sha256=${digest}; task-id=${taskId} -->`;
  return `${marker}\n${stripBriefProvenance(description)}`;
}

// ── Config ────────────────────────────────────────────────────────────────────

async function loadConfig() {
  let fileConfig = {};
  try {
    const configPath = path.join(os.homedir(), '.multica', 'config.json');
    const raw = await fs.readFile(configPath, 'utf8');
    fileConfig = JSON.parse(raw);
  } catch {
    // config file is optional; env vars may supply everything
  }

  return {
    serverUrl:
      process.env.MULTICA_SERVER_URL ||
      fileConfig.server_url ||
      fileConfig.serverUrl ||
      fileConfig.url,
    token: process.env.MULTICA_TOKEN || fileConfig.token,
    workspaceId:
      process.env.MULTICA_WORKSPACE_ID ||
      fileConfig.workspace_id ||
      fileConfig.workspaceId,
  };
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

function trimTrailingSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

// Stateless MCP compat guard (PLU-542, epic mcp-stateless-behavior, cutover
// 2026-07-28): this REST+Bearer wire is not MCP transport, but it is audited
// to the same stateless bar — every call below is a fresh per-request fetch.
// Do NOT add an `Mcp-Session-Id` header, a cookie jar, or any sticky-routing
// header/state here. This is a duplicated copy of index.mjs's httpJson — see
// README.md "Stateless MCP compat note" (also mirrored in episode-sync.mjs).
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
    const msg =
      error?.name === 'AbortError' || error?.name === 'TimeoutError'
        ? 'Request timed out after 30s'
        : error?.message || 'Unable to reach Multica server';
    throw { code: 'TRANSPORT', message: msg };
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
  throw { code: `HTTP_${response.status}`, message };
}

function issueUrl(serverUrl, workspaceId, issueUuid) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function issueTaskUrl(serverUrl, workspaceId, issueUuid, suffix) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}${suffix}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function taskMessagesUrl(serverUrl, workspaceId, taskId) {
  return `${trimTrailingSlash(serverUrl)}/api/tasks/${encodeURIComponent(taskId)}/messages?workspace_id=${encodeURIComponent(workspaceId)}`;
}

// Issue comments are keyed by the globally-unique issue UUID, but the server
// still requires workspace_id scoping on the request (POST /api/issues/<id>/comments
// rejects with "workspace_id or workspace_slug is required" otherwise).
function issueCommentsUrl(serverUrl, workspaceId, issueUuid) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}/comments?workspace_id=${encodeURIComponent(workspaceId)}`;
}

// Resolve the cycle-state YAML for an epic. `--cycle-state <path>` overrides the
// default `<cwd>/.pHive/cycle-state/<epic>.yaml` (used by tests + non-cwd callers).
function resolveCycleStatePath(args, epic) {
  if (typeof args['cycle-state'] === 'string') return args['cycle-state'];
  return path.join(process.cwd(), '.pHive', 'cycle-state', `${epic}.yaml`);
}

// ── Task helpers ──────────────────────────────────────────────────────────────

function normalizeList(body, key) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.[key])) return body[key];
  if (Array.isArray(body?.data)) return body.data;
  return [];
}

function unwrapTask(body) {
  if (!body) return null;
  if (body.task) return body.task;
  if (body.active_task) return body.active_task;
  if (body.activeTask) return body.activeTask;
  if (body.id || body.task_id || body.status) return body;
  return null;
}

function latestTaskRun(body) {
  const runs = normalizeList(body, 'task_runs');
  if (runs.length === 0) return null;
  const time = (r) => {
    const v = r?.completed_at ?? r?.updated_at ?? r?.started_at ?? r?.created_at;
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : 0;
  };
  return runs.reduce((best, run) => (time(run) >= time(best) ? run : best), runs[0]);
}

function resolveTaskId(task) {
  return task?.task_id ?? task?.id ?? task?.uuid ?? null;
}

function resolveTaskStatus(task) {
  return String(task?.status ?? task?.state ?? '').toLowerCase();
}

// A task in one of these states will never produce more work. Re-dispatching an
// issue whose latest task is terminal must spawn a NEW run, not return this one.
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled', 'canceled']);

function isTerminalStatus(status) {
  return TERMINAL_TASK_STATUSES.has(String(status ?? '').toLowerCase());
}

// Non-blocking snapshot: two GETs, returns immediately (<5s).
async function readTaskSnapshot(serverUrl, token, workspaceId, issueUuid) {
  const [activeBody, runsBody] = await Promise.all([
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/active-task'), { token }),
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/task-runs'), { token }),
  ]);

  const task = unwrapTask(activeBody) ?? latestTaskRun(runsBody);
  if (!task) {
    return { status: 'idle', started_at: null, task_id: null };
  }

  return {
    status: resolveTaskStatus(task) || 'idle',
    started_at: task.started_at ?? null,
    task_id: resolveTaskId(task),
  };
}

// s4: same two non-blocking GETs as readTaskSnapshot, but shaped like
// readTaskWithMessages minus the messages fetch — cmdStatus's `status`
// subcommand is the only NON-CANCELLING way to learn a task's agent_id and
// work_dir (pollTaskUntilTerminal cancels the task when its timeout-ms
// elapses, so it cannot be used as a cheap probe). Currently unconsumed:
// no caller (agent.py or otherwise) invokes the `status` subcommand today —
// this is exposed for a future non-cancelling probe consumer, not an
// existing poll loop.
async function readTaskSnapshotFull(serverUrl, token, workspaceId, issueUuid) {
  const [activeBody, runsBody] = await Promise.all([
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/active-task'), { token }),
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/task-runs'), { token }),
  ]);

  const task = unwrapTask(activeBody) ?? latestTaskRun(runsBody);
  if (!task) {
    return {
      status: 'idle',
      started_at: null,
      task_id: null,
      agent_id: null,
      agent_name: null,
      work_dir: null,
      notes: '',
      attempts: 1,
      completed_at: null,
    };
  }

  return {
    status: resolveTaskStatus(task) || 'idle',
    started_at: task.started_at ?? null,
    task_id: resolveTaskId(task),
    agent_id: task?.agent_id ?? null,
    agent_name: task?.agent_name ?? task?.agent?.name ?? null,
    work_dir: task?.work_dir ?? null,
    notes: String(task?.notes ?? task?.error ?? task?.error_message ?? task?.message ?? ''),
    attempts: task?.attempts ?? 1,
    completed_at: task?.completed_at ?? null,
  };
}

// After a rerun reset+reassign, the daemon needs a moment to spawn the new task.
// Poll briefly for a snapshot whose task_id differs from the stale terminal one
// (priorTaskId) so we report the FRESH run, not the old one. Bounded + best-effort:
// if nothing fresh appears in the window, return whatever the latest snapshot is.
async function waitForFreshTask(serverUrl, token, workspaceId, issueUuid, priorTaskId, maxWaitMs = 15_000) {
  const deadline = Date.now() + maxWaitMs;
  let snapshot = await readTaskSnapshot(serverUrl, token, workspaceId, issueUuid);
  while (Date.now() < deadline) {
    if (snapshot.task_id && snapshot.task_id !== priorTaskId) return snapshot;
    await new Promise((r) => setTimeout(r, 1000));
    snapshot = await readTaskSnapshot(serverUrl, token, workspaceId, issueUuid);
  }
  return snapshot;
}

// Reads the latest task run and fetches its messages, building a terminal-shaped object.
async function readTaskWithMessages(serverUrl, token, workspaceId, issueUuid) {
  const [activeBody, runsBody] = await Promise.all([
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/active-task'), { token }),
    httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/task-runs'), { token }),
  ]);

  const task = unwrapTask(activeBody) ?? latestTaskRun(runsBody);
  const id = resolveTaskId(task);
  const messages = id
    ? normalizeList(
        await httpJson(taskMessagesUrl(serverUrl, workspaceId, id), { token }),
        'messages',
      )
    : [];

  return {
    status: task ? resolveTaskStatus(task) : 'idle',
    notes: String(task?.notes ?? task?.error ?? task?.error_message ?? task?.message ?? ''),
    messages,
    task_id: id,
    agent_id: task?.agent_id ?? null,
    agent_name: task?.agent_name ?? task?.agent?.name ?? null,
    work_dir: task?.work_dir ?? null,
    attempts: task?.attempts ?? 1,
    started_at: task?.started_at ?? null,
    completed_at: task?.completed_at ?? null,
  };
}

// ── Output ────────────────────────────────────────────────────────────────────

function succeed(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
  process.exit(0);
}

function fail(code, message) {
  process.stderr.write(JSON.stringify({ code, message }) + '\n');
  process.exit(1);
}

function requireConfig({ serverUrl, token, workspaceId }) {
  if (!serverUrl) fail('MISSING_CONFIG', 'MULTICA_SERVER_URL or config.server_url is required');
  if (!token) fail('MISSING_CONFIG', 'MULTICA_TOKEN or config.token is required');
  if (!workspaceId)
    fail('MISSING_CONFIG', 'MULTICA_WORKSPACE_ID or config.workspace_id is required');
}

function requireUuid(flag, value) {
  if (!value) fail('MISSING_ARG', `${flag} is required`);
  if (!UUID_RE.test(value)) fail('INVALID_ARG', `${flag} must be a valid UUID, got: ${value}`);
}

// ── Subcommands ───────────────────────────────────────────────────────────────

async function cmdDispatch(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);

  const agentName = args.agent ?? null;
  const squadName = args.squad ?? null;
  if (!agentName && !squadName) fail('MISSING_ARG', '--agent or --squad is required');
  if (agentName && squadName) fail('INVALID_ARG', '--agent and --squad are mutually exclusive — pass exactly one');

  const { serverUrl, token, workspaceId } = cfg;
  const issueUuid = args.issue;

  // Resolve the requested assignee (name → UUID) up front so the idempotency
  // check can compare against what the caller actually asked for. Without this,
  // an issue already assigned to assignee A would short-circuit a request to
  // reassign it to B — a false `already_dispatched` no-op (CodeRabbit #303).
  const requestedType = agentName ? 'agent' : 'squad';
  const requestedUuid = agentName
    ? await resolveAgentUuidByName(serverUrl, token, workspaceId, agentName)
    : await resolveSquadUuidByName(serverUrl, token, workspaceId, squadName);

  // Read the issue and its latest task snapshot up front so the spent-issue guard
  // runs BEFORE the idempotency short-circuit. A finished run can leave the issue
  // `in_progress` with the same assignee; if the guard ran after the idempotency
  // return, that case would falsely report `already_dispatched` and `--rerun` could
  // never force a fresh run (Codex review). Snapshot read is best-effort.
  const issue = await httpJson(issueUrl(serverUrl, workspaceId, issueUuid), { token });
  let snapshot0 = null;
  try {
    snapshot0 = await readTaskSnapshot(serverUrl, token, workspaceId, issueUuid);
  } catch { /* best-effort; treat as no snapshot */ }

  // Spent-issue guard: an issue whose latest task is terminal (completed/failed/
  // cancelled) will NOT spawn a fresh run on a plain re-PUT of the same assignee —
  // the daemon sees no actionable transition, so the dispatch silently no-ops and
  // the snapshot returns the stale terminal task as if it were new. Refuse to report
  // a false success. `--rerun` opts into a real fresh run by resetting the issue to a
  // clean dispatchable state first. Checked BEFORE idempotency so a terminal-but-
  // still-in_progress issue cannot slip through as `already_dispatched`.
  let didReset = false;
  let priorTaskId = null;
  if (snapshot0 && isTerminalStatus(snapshot0.status)) {
    if (!args.rerun) {
      fail(
        'STALE_TERMINAL_TASK',
        `issue ${issueUuid} already has a terminal task ${snapshot0.task_id ?? '(unknown)'} ` +
          `(status=${snapshot0.status}); re-dispatch would be a no-op. Pass --rerun to force a fresh run.`,
      );
    }
    priorTaskId = snapshot0.task_id ?? null;
    await resetIssueForRerun(serverUrl, token, workspaceId, issueUuid);
    didReset = true;
  }

  // Assignee identity alone cannot prove idempotency: a cached issue may point at
  // an older, still-running task whose brief predates the caller's current body.
  // Delay the no-op decision until the complete desired brief has been rendered so
  // it can be checked against task-bound provenance stored before dispatch.
  const sameActiveAssignee =
    !didReset &&
    issue?.status === 'in_progress' &&
    issue?.assignee_type === requestedType &&
    issue?.assignee_id === requestedUuid;

  // Integration contract injection: when --integration-branch is passed, ensure the
  // issue body carries the single-shared-branch contract before dispatch. Issues filed
  // by /plan Phase D predate the contract, so the agent would otherwise clone the daemon
  // default base (main) and commit to a throwaway agent/<task> branch that never pushes —
  // breaking the dependency chain. Append idempotently (skip if already present).
  const integrationBranch = args['integration-branch'] ?? null;
  const existingDesc = String(issue?.description ?? '');
  // DAG Python owns brief construction and sends --body on every dispatch.
  // Refresh reused issues before adding bridge-owned integration/persona
  // sections; otherwise an issue created by an older executor permanently
  // misses the current declared-output contract.
  const suppliedBody = typeof args.body === 'string' ? String(args.body) : null;
  let currentDesc = suppliedBody ?? stripBriefProvenance(existingDesc);
  let descChanged = suppliedBody !== null && suppliedBody !== stripBriefProvenance(existingDesc);

  if (integrationBranch) {
    const contractHeading = '## Integration Contract — single shared branch';
    if (!currentDesc.includes(contractHeading)) {
      const contract = renderIntegrationContract(integrationBranch, args['story-id'] ?? null);
      currentDesc = `${currentDesc.trimEnd()}\n\n${contract}\n`;
      descChanged = true;
    }
  }

  // Persona stamp + Prior Experience injection (rev1-multica-learning-loop FIX 1):
  // this is the production dispatch route (multica_dispatch_story → cmdDispatch),
  // which previously sent the existing issue body unchanged. Without the stamp,
  // S2 harvest can't attribute a memory to the dispatched persona; without the
  // Prior Experience section, a later story dispatched via this route never sees
  // an earlier story's learning. Only applies to agent dispatch — the persona
  // concept is the assigned agent's name; squad dispatch has no single persona.
  if (requestedType === 'agent') {
    const persona = agentName;
    const stampRe = /<!--\s*persona:\s*.+?\s*-->\n*/;
    const desiredStamp = `<!-- persona: ${persona} -->`;
    if (!currentDesc.includes(desiredStamp)) {
      currentDesc = `${desiredStamp}\n\n${currentDesc.replace(stampRe, '').trimStart()}`;
      descChanged = true;
    }

    const priorSection = await fetchPriorExperienceSection(
      persona,
      typeof args.epic === 'string' ? args.epic : null,
      typeof args['story-id'] === 'string' ? args['story-id'] : null,
      { pythonBin: typeof args['python-bin'] === 'string' ? args['python-bin'] : undefined },
    );
    const sectionRe = /\n*## Prior Experience\n[\s\S]*?(?=\n## |\n---\n|$)/;
    const hasExistingSection = /## Prior Experience\n/.test(currentDesc);

    if (priorSection && !currentDesc.includes(priorSection.trim())) {
      currentDesc = currentDesc.replace(sectionRe, '');
      const insightIdx = currentDesc.indexOf('## Insight Capture');
      currentDesc =
        insightIdx >= 0
          ? `${currentDesc.slice(0, insightIdx)}${priorSection.trim()}\n\n${currentDesc.slice(insightIdx)}`
          : `${currentDesc.trimEnd()}\n\n${priorSection.trim()}\n`;
      descChanged = true;
    } else if (!priorSection && hasExistingSection) {
      currentDesc = currentDesc.replace(sectionRe, '');
      descChanged = true;
    }
  }

  const desiredDigest = briefDigest(currentDesc);
  if (sameActiveAssignee) {
    const provenance = readBriefProvenance(existingDesc);
    const activeTaskId = snapshot0?.task_id ?? null;
    if (
      !provenance ||
      !activeTaskId ||
      provenance.taskId !== activeTaskId ||
      provenance.digest !== desiredDigest
    ) {
      fail(
        'STALE_ACTIVE_BRIEF',
        `issue ${issueUuid} already has active task ${activeTaskId ?? '(unknown)'}, but its ` +
          `brief provenance does not match the requested dispatch. Refusing to report ` +
          `already_dispatched; pass --rerun after the active task is stopped to start a fresh run.`,
      );
    }
    succeed({
      status: 'already_dispatched',
      issue_id: issueUuid,
      task_id: activeTaskId,
    });
    return;
  }

  // Stage the exact rendered brief identity before assignment. The task id is bound
  // after Multica creates the run; until then a concurrent retry sees `pending` and
  // conservatively refuses reuse instead of attaching to an unproven task.
  currentDesc = writeBriefProvenance(currentDesc, desiredDigest, 'pending');
  descChanged = currentDesc !== existingDesc;

  if (descChanged) {
    await httpJson(issueUrl(serverUrl, workspaceId, issueUuid), {
      method: 'PUT',
      token,
      body: { description: currentDesc },
    });
  }

  await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid);

  if (requestedType === 'agent') {
    await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, requestedUuid);
  } else {
    await dispatchStoryToSquad(serverUrl, token, workspaceId, issueUuid, requestedUuid);
  }

  let task_id = null;
  try {
    // On a rerun, wait for the daemon to spawn the NEW task so we don't report the
    // stale terminal one. On a first dispatch, a single snapshot is enough.
    const snapshot = didReset
      ? await waitForFreshTask(serverUrl, token, workspaceId, issueUuid, priorTaskId)
      : await readTaskSnapshot(serverUrl, token, workspaceId, issueUuid);
    task_id = snapshot.task_id ?? null;
  } catch { /* best-effort */ }

  // On a rerun, a missing or unchanged task_id means the fresh run never appeared in
  // the wait window. Do NOT report `redispatched` with the stale id — that would be
  // the exact false-success this fix exists to prevent. Fail typed so callers can
  // retry or poll. The reset itself already succeeded.
  if (didReset && (!task_id || task_id === priorTaskId)) {
    fail(
      'FRESH_TASK_TIMEOUT',
      `issue ${issueUuid} was reset for rerun but no fresh task appeared before the deadline ` +
        `(last task_id=${task_id ?? '(none)'}, prior=${priorTaskId ?? '(none)'}). ` +
        `Reset succeeded — re-run \`dispatch --rerun\` or poll the issue.`,
    );
  }

  if (task_id) {
    // Complete the durable association only after the daemon exposes the task id.
    // A later cached dispatch must match both this id and the rendered brief hash;
    // issue description equality by itself is not evidence that the active task
    // consumed that description.
    await httpJson(issueUrl(serverUrl, workspaceId, issueUuid), {
      method: 'PUT',
      token,
      body: { description: writeBriefProvenance(currentDesc, desiredDigest, task_id) },
    });
  }

  succeed({
    status: didReset ? 'redispatched' : 'dispatched',
    issue_id: issueUuid,
    task_id,
  });
}

async function cmdStatus(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);

  const { serverUrl, token, workspaceId } = cfg;
  const snapshot = await readTaskSnapshotFull(serverUrl, token, workspaceId, args.issue);
  succeed(snapshot);
}

async function cmdPoll(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);

  const rawTimeout = args['timeout-ms'];
  const maxWallClockMs =
    rawTimeout !== undefined ? Number(rawTimeout) : 1_800_000;

  if (!Number.isFinite(maxWallClockMs) || maxWallClockMs <= 0) {
    fail('INVALID_ARG', '--timeout-ms must be a positive number');
  }

  const { serverUrl, token, workspaceId } = cfg;
  const terminal = await pollTaskUntilTerminal({
    serverUrl,
    token,
    workspaceId,
    issueUuid: args.issue,
    maxWallClockMs,
  });
  // The DAG AgentSpawn binding consumes only the terminal status + commit
  // metadata (code_push_sha / branch / repo / work_dir / ids). The full
  // `messages` array (up to messagesCaptureMax) can be megabytes for a task
  // with many tool calls and bloats — sometimes truncates/breaks — the JSON
  // the Python binding parses from stdout. Drop it from the poll payload;
  // message capture for episodes is owned by the episode command.
  const { messages: _messages, ...lean } = terminal;
  succeed(lean);
}

async function cmdEpisode(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  if (!args.epic) fail('MISSING_ARG', '--epic is required');
  if (!args.story) fail('MISSING_ARG', '--story is required');
  requireUuid('--issue', args.issue);

  const { serverUrl, token, workspaceId } = cfg;
  const issueUuid = args.issue;

  const issue = await httpJson(issueUrl(serverUrl, workspaceId, issueUuid), { token });
  const identifier = String(issue?.identifier ?? issue?.number ?? issueUuid);
  // Persona stamp (locked decision #1, s1-brief-memory-injection): the issue
  // description carries `<!-- persona: <name> -->` from serializeStoryBrief.
  // Harvest keys the curated team-memory by this same persona. Match to the
  // closing `-->` (not `\S+`) so a multi-word persona name isn't truncated.
  const personaMatch = /<!--\s*persona:\s*(.+?)\s*-->/.exec(String(issue?.description ?? ''));
  const distillPersona = personaMatch ? personaMatch[1] : null;

  const terminal = await readTaskWithMessages(serverUrl, token, workspaceId, issueUuid);

  const hiveStateDir = path.join(process.cwd(), '.pHive');
  const result = await writeMulticaRunEpisode({
    hiveStateDir,
    epicHandle: args.epic,
    storyId: args.story,
    issueUuid,
    identifier,
    terminal,
    messagesCaptureMax: 200,
    // Enabled by default (no flag needed) — harvest runs before the caller's
    // worktree cleanup; a failed/unavailable distill degrades gracefully and
    // never fails this episode write (see writeMulticaRunEpisode).
    distill: { persona: distillPersona },
  });

  succeed({ written: result.markerPath, status: result.status });
}

async function cmdCancel(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);

  const { serverUrl, token, workspaceId } = cfg;
  const issueUuid = args.issue;

  const activeBody = await httpJson(
    issueTaskUrl(serverUrl, workspaceId, issueUuid, '/active-task'),
    { token },
  );
  const task = unwrapTask(activeBody);
  const id = resolveTaskId(task);

  if (!id) {
    fail('NO_ACTIVE_TASK', `No active task found for issue ${issueUuid}`);
  }

  await httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, `/tasks/${id}/cancel`), {
    method: 'POST',
    token,
  });

  succeed({ cancelled: true, task_id: id });
}

// Read-only rollup of the hermes_reconciler: block for an epic's cycle-state.
// Backs the hermes-multica plugin's multica_list_tasks + multica_epic_status tools.
// Local-only (no Multica creds needed) — see NO_CONFIG in main().
async function cmdEpicStatus(args, cfg) {
  if (!args.epic || args.epic === true) fail('MISSING_ARG', '--epic is required');
  const epic = String(args.epic);
  const cycleStatePath = resolveCycleStatePath(args, epic);

  let state;
  try {
    state = readHermesReconcilerState(cycleStatePath);
  } catch (error) {
    // js-yaml absent or unreadable structure → surface as a typed failure.
    fail('CYCLE_STATE_READ', error?.message || String(error));
    return;
  }

  const stories = Object.entries(state.stories || {}).map(([storyId, s]) => ({
    story_id: storyId,
    phase_position: s?.phase_position ?? null,
    attempt: s?.attempt ?? null,
    verdict: s?.verdict ?? null,
  }));

  succeed({
    epic,
    gate_state: state.gate_state,
    epic_of_record: state.epic_of_record,
    current_phase: state.current_phase,
    in_flight_story_id: state.in_flight_story_id,
    in_flight_task_id: state.in_flight_task_id,
    dispatched_at: state.dispatched_at,
    stories,
  });
}

// Valid top-level keys for the hermes_reconciler patch.
const VALID_PATCH_KEYS = new Set([
  'gate_state',
  'epic_of_record',
  'in_flight_story_id',
  'in_flight_task_id',
  'dispatched_at',
  'current_phase',
  'stuck_after_seconds',
  'stories',
]);

// Write a partial update to the hermes_reconciler: block of a cycle-state YAML.
// Local-only (no Multica creds) — in the NO_CONFIG set.
async function cmdWriteState(args) {
  if (!args.epic || args.epic === true) fail('MISSING_ARG', '--epic is required');
  if (!args.patch || args.patch === true) fail('MISSING_ARG', '--patch is required');

  const epic = String(args.epic);
  const cycleStatePath = resolveCycleStatePath(args, epic);

  let patch;
  try {
    patch = JSON.parse(args.patch);
  } catch {
    fail('INVALID_ARG', '--patch must be valid JSON');
    return;
  }

  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('INVALID_ARG', '--patch must be a JSON object');
    return;
  }

  const unknownKeys = Object.keys(patch).filter((k) => !VALID_PATCH_KEYS.has(k));
  if (unknownKeys.length > 0) {
    fail('INVALID_ARG', `Unknown top-level patch fields: ${unknownKeys.join(', ')}. Expected: ${[...VALID_PATCH_KEYS].join(', ')}`);
    return;
  }

  // Validate gate_state value — must be null or one of the allowed string values.
  if ('gate_state' in patch) {
    const gs = patch.gate_state;
    if (gs !== null && !VALID_GATE_STATES.has(gs)) {
      fail(
        'INVALID_ARG',
        `--patch "gate_state" must be null or one of: ${[...VALID_GATE_STATES].join(', ')}. Got: ${JSON.stringify(gs)}`,
      );
      return;
    }
  }

  // Validate epic_of_record at the same boundary as gate_state — the ownership
  // pin must be null or a non-empty string; anything else weakens the tick-preflight
  // contract that reads it.
  if ('epic_of_record' in patch) {
    const eor = patch.epic_of_record;
    if (eor !== null && (typeof eor !== 'string' || eor.trim() === '')) {
      fail('INVALID_ARG', '--patch "epic_of_record" must be null or a non-empty string');
      return;
    }
  }

  // Validate `stories` value types so a shape like {"stories":["x"]} or
  // {"stories":{"s1":"oops"}} is rejected cleanly here instead of corrupting
  // (or throwing deep inside) the write. Keys are validated above; this guards values.
  if ('stories' in patch) {
    const s = patch.stories;
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      fail('INVALID_ARG', '--patch "stories" must be an object mapping story IDs to objects');
      return;
    }
    for (const [storyId, storyPatch] of Object.entries(s)) {
      if (storyPatch === null || typeof storyPatch !== 'object' || Array.isArray(storyPatch)) {
        fail('INVALID_ARG', `--patch "stories.${storyId}" must be an object`);
        return;
      }
    }
  }

  try {
    writeHermesReconcilerState(cycleStatePath, patch);
  } catch (error) {
    fail('CYCLE_STATE_WRITE', error?.message || String(error));
    return;
  }

  let state;
  try {
    state = readHermesReconcilerState(cycleStatePath);
  } catch (error) {
    fail('CYCLE_STATE_READ', error?.message || String(error));
    return;
  }

  const stories = Object.entries(state.stories || {}).map(([storyId, s]) => ({
    story_id: storyId,
    phase_position: s?.phase_position ?? null,
    attempt: s?.attempt ?? null,
    verdict: s?.verdict ?? null,
  }));

  succeed({
    epic,
    gate_state: state.gate_state,
    epic_of_record: state.epic_of_record,
    current_phase: state.current_phase,
    in_flight_story_id: state.in_flight_story_id,
    in_flight_task_id: state.in_flight_task_id,
    dispatched_at: state.dispatched_at,
    stories,
  });
}

// Post a comment to a Multica issue. Backs the multica_post_comment tool.
async function cmdComment(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);
  if (!args.body || args.body === true) fail('MISSING_ARG', '--body is required');

  // workspaceId is guaranteed present: `comment` is not in NO_CONFIG, so
  // requireConfig() has already enforced it before we reach here.
  const { serverUrl, token, workspaceId } = cfg;
  const created = await httpJson(issueCommentsUrl(serverUrl, workspaceId, args.issue), {
    method: 'POST',
    token,
    body: { content: String(args.body) },
  });

  const commentId = created?.id ?? created?.comment_id ?? null;
  succeed({ comment_id: commentId });
}

// POST /api/issues — mint a new issue (or return existing one when --dedup-title matches).
// --title <string>       — required
// --body <string>        — required; passed verbatim as the issue description (step_file_content)
// --dedup-title <string> — optional; when set, lists existing issues first and returns any
//                          whose title exactly matches this key instead of creating a duplicate.
//                          Primary idempotency guard for DAG-on-Multica cross-machine resume.
async function cmdCreateIssue(args, cfg) {
  if (!args.title || args.title === true) fail('MISSING_ARG', '--title is required');
  if (!args.body || args.body === true) fail('MISSING_ARG', '--body is required');

  const { serverUrl, token, workspaceId } = cfg;
  const dedupTitle = typeof args['dedup-title'] === 'string' ? String(args['dedup-title']) : null;
  const integrationBranch = typeof args['integration-branch'] === 'string' ? String(args['integration-branch']) : null;
  const created = await createIssue(
    serverUrl, token, workspaceId,
    String(args.title), String(args.body),
    { dedupTitle, integrationBranch },
  );

  const id = created?.id ?? null;
  const url = created?.url ?? null;
  succeed({ id, url, ...created });
}

// Fetch an agent branch from the remote bare repo and ff-merge a specific sha.
// --repo <url|path>  — remote repo URL or bare repo path (required)
// --branch <ref>     — agent branch to fetch, e.g. agent/developer/<run> (required)
// --sha <sha>        — code_push_sha to ff-merge into work_dir (required)
// --work-dir <path>  — working tree directory (default: cwd)
async function cmdReconcile(args, _cfg) {
  if (!args.repo || args.repo === true) fail('MISSING_ARG', '--repo is required');
  if (!args.branch || args.branch === true) fail('MISSING_ARG', '--branch is required');
  if (!args.sha || args.sha === true) fail('MISSING_ARG', '--sha is required');

  const workDir = typeof args['work-dir'] === 'string' ? args['work-dir'] : process.cwd();
  const result = await reconcileBranch(String(args.repo), String(args.branch), String(args.sha), workDir);
  succeed(result);
}

// ── Main ──────────────────────────────────────────────────────────────────────

// Commands that read only local state and need no Multica server credentials.
const NO_CONFIG = new Set(['epic-status', 'write-state', 'reconcile']);

const USAGE = 'cli.mjs <dispatch|status|poll|episode|cancel|epic-status|comment|write-state|create-issue|reconcile> [options]';

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!command) {
    fail('MISSING_ARG', `Usage: ${USAGE}`);
  }

  const cfg = await loadConfig();
  if (!NO_CONFIG.has(command)) requireConfig(cfg);

  try {
    switch (command) {
      case 'dispatch':    await cmdDispatch(args, cfg);   break;
      case 'status':      await cmdStatus(args, cfg);     break;
      case 'poll':        await cmdPoll(args, cfg);       break;
      case 'episode':     await cmdEpisode(args, cfg);    break;
      case 'cancel':      await cmdCancel(args, cfg);     break;
      case 'epic-status':  await cmdEpicStatus(args, cfg); break;
      case 'comment':      await cmdComment(args, cfg);    break;
      case 'write-state':   await cmdWriteState(args);         break;
      case 'create-issue':  await cmdCreateIssue(args, cfg);  break;
      case 'reconcile':     await cmdReconcile(args, cfg);     break;
      default:
        fail(
          'UNKNOWN_COMMAND',
          `Unknown command: ${command}. Expected: dispatch|status|poll|episode|cancel|epic-status|comment|write-state|create-issue|reconcile`,
        );
    }
  } catch (error) {
    if (error?.code) {
      fail(String(error.code), error.message || String(error));
    }
    fail('INTERNAL', error?.message || String(error));
  }
}

main();
