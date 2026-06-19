#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveAgentUuidByName,
  resolveSquadUuidByName,
  moveOutOfBacklogIfNeeded,
  dispatchStoryToAgent,
  dispatchStoryToSquad,
} from './index.mjs';

import { pollTaskUntilTerminal, writeMulticaRunEpisode } from './episode-sync.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-story-dispatch-cli/0.1.0';

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

  const { serverUrl, token, workspaceId } = cfg;
  const issueUuid = args.issue;

  // Idempotent: if already assigned + in_progress, no-op.
  const issue = await httpJson(issueUrl(serverUrl, workspaceId, issueUuid), { token });
  if (
    issue?.status === 'in_progress' &&
    issue?.assignee_id &&
    (issue?.assignee_type === 'agent' || issue?.assignee_type === 'squad')
  ) {
    succeed({ status: 'already_dispatched', issue_id: issueUuid });
    return;
  }

  await moveOutOfBacklogIfNeeded(serverUrl, token, workspaceId, issueUuid);

  if (agentName) {
    const agentUuid = await resolveAgentUuidByName(serverUrl, token, workspaceId, agentName);
    await dispatchStoryToAgent(serverUrl, token, workspaceId, issueUuid, agentUuid);
  } else {
    const squadUuid = await resolveSquadUuidByName(serverUrl, token, workspaceId, squadName);
    await dispatchStoryToSquad(serverUrl, token, workspaceId, issueUuid, squadUuid);
  }

  succeed({ status: 'dispatched', issue_id: issueUuid });
}

async function cmdStatus(args, cfg) {
  if (!args.issue) fail('MISSING_ARG', '--issue is required');
  requireUuid('--issue', args.issue);

  const { serverUrl, token, workspaceId } = cfg;
  const snapshot = await readTaskSnapshot(serverUrl, token, workspaceId, args.issue);
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
  succeed(terminal);
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);

  if (!command) {
    fail(
      'MISSING_ARG',
      'Usage: cli.mjs <dispatch|status|poll|episode|cancel> [options]',
    );
  }

  const cfg = await loadConfig();
  requireConfig(cfg);

  try {
    switch (command) {
      case 'dispatch': await cmdDispatch(args, cfg); break;
      case 'status':   await cmdStatus(args, cfg);   break;
      case 'poll':     await cmdPoll(args, cfg);     break;
      case 'episode':  await cmdEpisode(args, cfg);  break;
      case 'cancel':   await cmdCancel(args, cfg);   break;
      default:
        fail(
          'UNKNOWN_COMMAND',
          `Unknown command: ${command}. Expected: dispatch|status|poll|episode|cancel`,
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
