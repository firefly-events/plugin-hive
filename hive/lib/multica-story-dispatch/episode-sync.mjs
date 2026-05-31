import fs from 'node:fs/promises';
import path from 'node:path';

const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-episode-sync/0.1.0';
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
const EPISODE_TERMINAL_STATUSES = new Set(['passed', 'failed', 'cancelled']);
const DOC_VERDICT_COMPLETION_KINDS = new Set(['doc', 'docs', 'verdict', 'doc-verdict']);

function sanitize(str, token) {
  if (str == null) return str;
  let safe = String(str)
    .replace(/mul_[A-Za-z0-9._~+/=-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/pat_[A-Za-z0-9._~+/=-]+/gi, '[redacted-token]');
  if (token) safe = safe.split(String(token)).join('[redacted-token]');
  return safe;
}

function syncError(code, message, token) {
  return { code, message: sanitize(message, token) };
}

function trimTrailingSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
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
      throw syncError('TRANSPORT', 'Multica request timed out after 30s', token);
    }
    throw syncError('TRANSPORT', error?.message || 'Unable to reach Multica server', token);
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
  throw syncError(`HTTP_${response.status}`, message, token);
}

function issueTaskUrl(serverUrl, workspaceId, issueUuid, suffix) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueUuid)}${suffix}?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function taskMessagesUrl(serverUrl, workspaceId, taskId) {
  return `${trimTrailingSlash(serverUrl)}/api/tasks/${encodeURIComponent(taskId)}/messages?workspace_id=${encodeURIComponent(workspaceId)}`;
}

function unwrapTask(body) {
  if (!body) return null;
  if (body.task) return body.task;
  if (body.active_task) return body.active_task;
  if (body.activeTask) return body.activeTask;
  if (body.id || body.task_id || body.status) return body;
  return null;
}

function taskTime(task) {
  const value = task?.completed_at ?? task?.updated_at ?? task?.started_at ?? task?.created_at;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : 0;
}

function latestTaskRun(body) {
  const runs = normalizeList(body, 'task_runs');
  if (runs.length === 0) return null;
  return runs.reduce((latest, run) => (taskTime(run) >= taskTime(latest) ? run : latest), runs[0]);
}

function taskId(task) {
  return task?.task_id ?? task?.id ?? task?.uuid ?? null;
}

function taskStatus(task) {
  return String(task?.status ?? task?.state ?? '').toLowerCase();
}

function taskNotes(task) {
  return String(task?.notes ?? task?.error ?? task?.error_message ?? task?.message ?? '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeMessages(body) {
  return normalizeList(body, 'messages');
}

export async function pollTaskUntilTerminal(opts) {
  const {
    serverUrl,
    token,
    workspaceId,
    issueUuid,
    maxWallClockMs = 1_800_000,
    pollIntervalMs = 5_000,
    messagesCaptureMax = 200,
    onStateTransition,
  } = opts;

  const started = Date.now();
  let consecutiveFailures = 0;
  let previousStatus;
  let currentTask = null;

  while (Date.now() - started < maxWallClockMs) {
    try {
      const [activeBody, runsBody] = await Promise.all([
        httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/active-task'), { token }),
        httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, '/task-runs'), { token }),
      ]);
      consecutiveFailures = 0;
      currentTask = unwrapTask(activeBody) ?? latestTaskRun(runsBody) ?? currentTask;

      const status = taskStatus(currentTask);
      if (status && previousStatus !== undefined && status !== previousStatus) {
        onStateTransition?.(previousStatus, status);
      }
      if (status) previousStatus = status;

      if (TERMINAL_STATUSES.has(status)) {
        const id = taskId(currentTask);
        const messages = id
          ? normalizeMessages(
              await httpJson(taskMessagesUrl(serverUrl, workspaceId, id), { token }),
            ).slice(-messagesCaptureMax)
          : [];
        return {
          status,
          notes: taskNotes(currentTask),
          messages,
          task_id: id,
          agent_id: currentTask?.agent_id ?? null,
          agent_name: currentTask?.agent_name ?? currentTask?.agent?.name ?? null,
          work_dir: currentTask?.work_dir ?? null,
          attempts: currentTask?.attempts ?? 1,
          started_at: currentTask?.started_at ?? null,
          completed_at: currentTask?.completed_at ?? null,
        };
      }
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        throw syncError('TRANSPORT', error?.message || String(error), token);
      }
    }

    const elapsed = Date.now() - started;
    if (elapsed >= maxWallClockMs) break;
    await sleep(Math.min(pollIntervalMs, maxWallClockMs - elapsed));
  }

  const id = taskId(currentTask);
  if (id) {
    await httpJson(issueTaskUrl(serverUrl, workspaceId, issueUuid, `/tasks/${id}/cancel`), {
      method: 'POST',
      token,
    });
  }
  return {
    status: 'cancelled',
    notes: `timeout after ${maxWallClockMs / 1000}s`,
    messages: [],
    task_id: id,
    agent_id: currentTask?.agent_id ?? null,
    agent_name: currentTask?.agent_name ?? currentTask?.agent?.name ?? null,
    work_dir: currentTask?.work_dir ?? null,
    attempts: currentTask?.attempts ?? 1,
    started_at: currentTask?.started_at ?? null,
    completed_at: new Date().toISOString(),
  };
}

function markerStatus(status) {
  if (status === 'completed') return 'passed';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'failed';
}

function normalizeCompletionKind(terminal) {
  const raw =
    terminal?.completion_kind ?? terminal?.completionKind ?? terminal?.task_kind ?? terminal?.taskKind;
  const normalized = String(raw ?? '').trim().toLowerCase();
  if (DOC_VERDICT_COMPLETION_KINDS.has(normalized)) return 'doc-verdict';
  return 'code-push';
}

function booleanFrom(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  return String(value).toLowerCase() === 'true';
}

function oneLine(value) {
  return String(value ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  return JSON.stringify(String(value));
}

function repoRelative(filePath) {
  const relative = path.relative(process.cwd(), filePath);
  return relative || path.basename(filePath);
}

function artifactRelative(filePath) {
  if (!filePath) return null;
  const normalized = path.normalize(String(filePath));
  if (path.isAbsolute(normalized)) return repoRelative(normalized);
  return normalized.replace(/^\.[/\\]/, '');
}

function normalizeArtifactPaths(terminal, messagesPath) {
  const paths = Array.isArray(terminal?.artifacts) ? terminal.artifacts : [];
  const seen = new Set();
  const normalized = [];
  for (const artifact of [...paths, messagesPath]) {
    const candidate = artifactRelative(artifact);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    normalized.push(candidate);
  }
  return normalized;
}

function deriveCompletion(terminal, status) {
  const completionKind = normalizeCompletionKind(terminal);
  const episodeTerminal = EPISODE_TERMINAL_STATUSES.has(status);
  const requiresCodePushSha = completionKind !== 'doc-verdict';
  const codePushSha = terminal?.code_push_sha ?? terminal?.codePushSha ?? null;
  const artifactsCommitted = booleanFrom(
    terminal?.artifacts_committed ?? terminal?.artifactsCommitted,
    completionKind === 'doc-verdict' ? false : Boolean(codePushSha),
  );
  const terminalByDialect =
    completionKind === 'doc-verdict'
      ? artifactsCommitted && episodeTerminal
      : Boolean(codePushSha) && episodeTerminal;

  return {
    completionKind,
    artifactsCommitted,
    episodeTerminal,
    requiresCodePushSha,
    codePushSha,
    terminalByDialect,
  };
}

export async function writeMulticaRunEpisode(opts) {
  const {
    hiveStateDir,
    epicHandle,
    storyId,
    issueUuid,
    identifier,
    terminal,
    messagesCaptureMax,
  } = opts;

  const dir = path.join(hiveStateDir, 'episodes', epicHandle, storyId);
  const markerPath = path.join(dir, 'multica-run.yaml');
  const messagesPath = path.join(dir, 'multica-run.messages.jsonl');
  await fs.mkdir(dir, { recursive: true });

  const allMessages = Array.isArray(terminal?.messages) ? terminal.messages : [];
  const messages =
    Number.isFinite(messagesCaptureMax) && messagesCaptureMax >= 0
      ? allMessages.slice(-messagesCaptureMax)
      : allMessages;
  const status = markerStatus(terminal?.status);
  const now = new Date().toISOString();
  let notes = oneLine(terminal?.notes ?? terminal?.error ?? '');
  if (messages.length < allMessages.length) {
    const indicator = `truncated to ${messages.length} of ${allMessages.length}`;
    notes = notes ? `${notes}; ${indicator}` : indicator;
  }

  const artifacts = normalizeArtifactPaths(terminal, messagesPath);
  const completion = deriveCompletion(terminal, status);
  const marker = [
    'step: multica-run',
    `story: ${yamlScalar(storyId)}`,
    `epic: ${yamlScalar(epicHandle)}`,
    `agent: ${yamlScalar(terminal?.agent_name || 'developer')}`,
    `status: ${status}`,
    `completion_kind: ${yamlScalar(completion.completionKind)}`,
    `artifacts_committed: ${completion.artifactsCommitted}`,
    `episode_terminal: ${completion.episodeTerminal}`,
    `requires_code_push_sha: ${completion.requiresCodePushSha}`,
    `code_push_sha: ${yamlScalar(completion.codePushSha)}`,
    `terminal_by_dialect: ${completion.terminalByDialect}`,
    `started_at: ${yamlScalar(terminal?.started_at || now)}`,
    `completed_at: ${yamlScalar(terminal?.completed_at || now)}`,
    'artifacts:',
    ...artifacts.map((artifactPath) => `  - ${yamlScalar(artifactPath)}`),
    'multica:',
    `  issue_id: ${yamlScalar(identifier)}`,
    `  issue_uuid: ${yamlScalar(issueUuid)}`,
    `  task_id: ${yamlScalar(terminal?.task_id ?? null)}`,
    `  agent_id: ${yamlScalar(terminal?.agent_id ?? null)}`,
    `  work_dir: ${yamlScalar(terminal?.work_dir ?? null)}`,
    `  attempts: ${Number.isFinite(terminal?.attempts) ? terminal.attempts : 1}`,
    `notes: ${yamlScalar(notes)}`,
    '',
  ].join('\n');

  const jsonl = messages.map((message) => JSON.stringify(message)).join('\n');
  await fs.writeFile(markerPath, marker, 'utf8');
  await fs.writeFile(messagesPath, jsonl ? `${jsonl}\n` : '', 'utf8');
  return { markerPath, messagesPath, status, notes, completion };
}
