import fs from 'node:fs/promises';
import path from 'node:path';

import { runMulticaInsightDistill } from './distill.mjs';
import { resolveStateDir } from '../config.js';

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

// Stateless MCP compat guard (PLU-542, epic mcp-stateless-behavior, cutover
// 2026-07-28): this REST+Bearer wire is not MCP transport, but it is audited
// to the same stateless bar — every call below is a fresh per-request fetch.
// Do NOT add an `Mcp-Session-Id` header, a cookie jar, or any sticky-routing
// header/state here. This is a duplicated copy of index.mjs's httpJson — see
// README.md "Stateless MCP compat note" (also mirrored in cli.mjs).
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

// s4: the s1 SubagentStop hook (hooks/notify-agent-complete.sh) writes
// `<state_dir>/agent-complete/<agent_id>/complete.json` the instant a
// dispatched agent's Claude Code session stops. Reading it is a filesystem
// stat, not a 5s-interval HTTP round trip. Scoped to Agent-based bg dispatch
// only — the ONLY kind a Multica task is; Bash `run_in_background` has no
// such hook and is out of scope for this loop entirely (that carve-out lives
// in the DAG executor / cmux dispatch paths that can reach a Bash-bg node,
// not here).
// Critical #2 (PLU-577 revision): `task.agent_id` is a stable persona UUID,
// not a per-run id — the SAME agent_id is reused across every story a given
// persona ever runs. A leftover complete.json from an EARLIER story (never
// deleted after that story consumed it) would otherwise short-circuit a
// LATER story's poll on its very first marker check, returning a stale
// verdict/completed_at while the new task is still running. Guard with a
// freshness check (marker.written_at must be >= the current task's
// started_at) before trusting a marker at all, and delete it once consumed
// so it can never be read twice.
//
// NOTE (flagged, not verified): this assumes the SubagentStop payload's
// `agent_id` and Multica's `task.agent_id` share the same namespace/value.
// No integration probe has confirmed that equivalence for this runtime: if
// they ever diverge, the marker fast path below silently never matches and
// this loop falls back to the (correct, just slower) HTTP poll — it does not
// mis-fire on the wrong agent's marker. Re-verify next time the Multica
// agent-dispatch payload shape changes.
function isMarkerFresh(marker, task) {
  const startedAt = task?.started_at;
  if (!startedAt) return true; // nothing to compare against — accept (legacy behavior)
  const writtenAtMs = Date.parse(marker?.written_at ?? '');
  const startedAtMs = Date.parse(startedAt);
  if (!Number.isFinite(writtenAtMs) || !Number.isFinite(startedAtMs)) return true;
  return writtenAtMs >= startedAtMs;
}

async function readCompletionMarker(markerRoot, agentId) {
  if (!agentId) return null;
  try {
    const raw = await fs.readFile(path.join(markerRoot, agentId, 'complete.json'), 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

async function deleteCompletionMarker(markerRoot, agentId) {
  try {
    await fs.unlink(path.join(markerRoot, agentId, 'complete.json'));
  } catch {
    // best-effort — a failed cleanup must not fail the poll
  }
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
    stateDir,
  } = opts;

  const started = Date.now();
  let consecutiveFailures = 0;
  let previousStatus;
  let currentTask = null;
  const markerRoot = path.join(stateDir ?? resolveStateDir(), 'agent-complete');

  while (Date.now() - started < maxWallClockMs) {
    // Check the marker BEFORE paying for another network poll — this is the
    // event-driven fast path. Only possible once a prior HTTP round trip has
    // told us the task's agent_id, so the very first iteration always falls
    // through to the ordinary fetch below.
    if (currentTask?.agent_id) {
      const marker = await readCompletionMarker(markerRoot, currentTask.agent_id);
      if (marker && !isMarkerFresh(marker, currentTask)) {
        // Stale leftover from an earlier story that reused this persona's
        // agent_id — do not trust it. Delete so it can't confuse a later
        // iteration either, and fall through to the ordinary HTTP poll below.
        await deleteCompletionMarker(markerRoot, currentTask.agent_id);
      } else if (marker) {
        await deleteCompletionMarker(markerRoot, currentTask.agent_id);
        const status = marker.verdict === 'success' ? 'completed' : 'failed';
        if (previousStatus !== undefined && status !== previousStatus) {
          onStateTransition?.(previousStatus, status);
        }
        const id = taskId(currentTask);
        let messages = [];
        if (id) {
          try {
            messages = normalizeMessages(
              await httpJson(taskMessagesUrl(serverUrl, workspaceId, id), { token }),
            ).slice(-messagesCaptureMax);
          } catch {
            // The marker verdict is authoritative, not message capture — a
            // transient fetch failure here must not fail a SUCCEEDED task.
            messages = [];
          }
        }
        return {
          status,
          notes:
            status === 'failed'
              ? `agent-complete marker verdict=${marker.verdict ?? 'unknown'}`
              : taskNotes(currentTask),
          messages,
          task_id: id,
          agent_id: currentTask?.agent_id ?? null,
          agent_name: currentTask?.agent_name ?? currentTask?.agent?.name ?? null,
          work_dir: currentTask?.work_dir ?? null,
          attempts: currentTask?.attempts ?? 1,
          started_at: currentTask?.started_at ?? null,
          completed_at: marker.written_at || new Date().toISOString(),
        };
      }
    }
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
    distill,
    squad_evaluation,
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
  const markerLines = [
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
  ];

  if (squad_evaluation != null) {
    markerLines.push(
      'squad_evaluation:',
      `  actor_type: ${yamlScalar(squad_evaluation.actor_type ?? null)}`,
      `  actor_id: ${yamlScalar(squad_evaluation.actor_id ?? null)}`,
      `  outcome: ${yamlScalar(squad_evaluation.outcome ?? null)}`,
      `  reason: ${yamlScalar(squad_evaluation.reason ?? null)}`,
      `  created_at: ${yamlScalar(squad_evaluation.created_at ?? null)}`,
    );
  }

  markerLines.push('');
  const marker = markerLines.join('\n');

  const jsonl = messages.map((message) => JSON.stringify(message)).join('\n');
  await fs.writeFile(markerPath, marker, 'utf8');
  await fs.writeFile(messagesPath, jsonl ? `${jsonl}\n` : '', 'utf8');

  // Best-effort: the episode marker is the source of truth. A distill failure
  // must never lose the already-written marker/messages, so swallow + record
  // any throw and continue (matches the fire-and-forget, signal-gated design).
  let distillResult = null;
  if (distill) {
    try {
      distillResult = await runMulticaInsightDistill({
        hiveStateDir,
        epicHandle,
        storyId,
        workDir: terminal?.work_dir ?? null,
        messagesPath,
        ...distill,
      });
      // S2-AC4: the Python bridge degrades to a raw-capture write (rather than
      // throwing) when curated distillation is unavailable — surface that as a
      // one-line warning instead of letting it pass silently as a normal result.
      if (distillResult?.degraded) {
        process.stderr.write(
          `[multica-distill] ${storyId}: degraded to raw-capture — ${distillResult.error ?? 'unknown reason'}\n`,
        );
      }
    } catch (error) {
      process.stderr.write(
        `[multica-distill] ${storyId}: distill failed — ${error?.message ?? error}\n`,
      );
      distillResult = { ok: false, error: String(error?.message ?? error) };
    }
  }

  return { markerPath, messagesPath, status, notes, completion, distill: distillResult };
}
