// Runbook (failure modes, manual sweep, WARN escalation): hive/references/multica-issue-closer-runbook.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HTTP_TIMEOUT_MS = 30_000;
const USER_AGENT = 'hive-multica-issue-closer/0.1.0';
const DEFAULT_CONFIG_PATH = path.join(os.homedir(), '.multica', 'config.json');
const TERMINAL_STATUSES = new Set(['done', 'cancelled']);

function sanitize(str, token) {
  if (str == null) return str;
  let safe = String(str)
    .replace(/mul_[A-Za-z0-9._~+/=-]+/g, '[redacted-token]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/pat_[A-Za-z0-9._~+/=-]+/gi, '[redacted-token]');
  if (token) safe = safe.split(String(token)).join('[redacted-token]');
  return safe;
}

function warn(msg, token) {
  console.warn('[multica-issue-closer]', sanitize(msg, token));
}

function trimTrailingSlash(url) {
  return String(url ?? '').replace(/\/+$/, '');
}

function issueUrl(serverUrl, workspaceId, issueId) {
  return `${trimTrailingSlash(serverUrl)}/api/issues/${encodeURIComponent(issueId)}?workspace_id=${encodeURIComponent(workspaceId)}`;
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
      throw new Error('Multica request timed out after 30s');
    }
    throw new Error(error?.message || 'Unable to reach Multica server');
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }

  if (response.status >= 200 && response.status < 300) return parsed;

  const message =
    typeof parsed?.message === 'string'
      ? parsed.message
      : typeof parsed?.error === 'string'
        ? parsed.error
        : `Multica API returned HTTP ${response.status}`;
  throw new Error(message);
}

function loadAuth(configPath = DEFAULT_CONFIG_PATH) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw);
    if (cfg?.token && cfg?.server_url && cfg?.workspace_id) {
      return { token: cfg.token, server_url: cfg.server_url, workspace_id: cfg.workspace_id };
    }
    return null;
  } catch {
    return null;
  }
}

function readMarker(markerPath) {
  try {
    const raw = fs.readFileSync(markerPath, 'utf8');
    // Parse minimal YAML: extract issue_id and assignee_id lines
    const issueMatch = raw.match(/^issue_id:\s*["']?([^\s'"]+)["']?/m);
    const assigneeMatch = raw.match(/^assignee_id:\s*["']?([^\s'"]+)["']?/m);
    return {
      issue_id: issueMatch?.[1] ?? null,
      assignee_id: assigneeMatch?.[1] ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Close a single story's Multica issue.
 *
 * @param {object} opts
 * @param {string} opts.epic_id
 * @param {string} opts.story_id
 * @param {string} [opts.repo_root] - defaults to process.cwd()
 * @param {string} [opts.config_path] - path to ~/.multica/config.json
 * @returns {Promise<object>} result envelope
 */
export async function closeStoryIssue({ epic_id, story_id, repo_root, config_path } = {}) {
  const root = repo_root ?? process.cwd();
  const markerPath = path.join(root, '.pHive', 'episodes', epic_id, story_id, 'multica-run.yaml');

  const marker = readMarker(markerPath);
  if (!marker || !marker.issue_id) {
    return { ok: false, reason: 'no_marker' };
  }

  const auth = loadAuth(config_path);
  if (!auth) {
    warn('No Multica auth config found; skipping issue close.');
    return { ok: false, reason: 'no_auth' };
  }

  const { token, server_url, workspace_id } = auth;
  const url = issueUrl(server_url, workspace_id, marker.issue_id);

  let issue;
  try {
    issue = await httpJson(url, { token });
  } catch (error) {
    warn(`Failed to fetch issue ${marker.issue_id}: ${error?.message}`, token);
    return { ok: false, reason: 'transport_error', error: sanitize(error?.message, token) };
  }

  // Validate assignee hasn't drifted
  if (marker.assignee_id && issue?.assignee_id && issue.assignee_id !== marker.assignee_id) {
    return { ok: false, reason: 'agent_drift' };
  }

  const status = issue?.status;

  if (status === 'done') {
    return { ok: true, was_changed: false, reason: 'already_done' };
  }

  if (status === 'cancelled') {
    return { ok: true, was_changed: false, reason: 'cancelled' };
  }

  try {
    await httpJson(url, { method: 'PUT', token, body: { status: 'done' } });
  } catch (error) {
    warn(`Failed to close issue ${marker.issue_id}: ${error?.message}`, token);
    return { ok: false, reason: 'transport_error', error: sanitize(error?.message, token) };
  }

  return { ok: true, was_changed: true, prior_status: status };
}

/**
 * Close multiple story issues. Best-effort — continues on per-story errors.
 *
 * @param {Array<{epic_id: string, story_id: string, repo_root?: string}>} pairs
 * @returns {Promise<{closed: object[], skipped: object[], errors: object[]}>}
 */
export async function closeStoryIssues(pairs) {
  const closed = [];
  const skipped = [];
  const errors = [];

  for (const pair of pairs) {
    let result;
    try {
      result = await closeStoryIssue(pair);
    } catch (error) {
      errors.push({ ...pair, error: String(error?.message ?? error) });
      continue;
    }

    if (!result.ok) {
      if (result.reason === 'transport_error') {
        errors.push({ ...pair, ...result });
      } else {
        skipped.push({ ...pair, ...result });
      }
    } else if (result.was_changed) {
      closed.push({ ...pair, ...result });
    } else {
      skipped.push({ ...pair, ...result });
    }
  }

  return { closed, skipped, errors };
}
