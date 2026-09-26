/**
 * codex-backend.mjs — headless `codex exec` dispatcher
 *
 * Runs `codex exec --json --ephemeral --skip-git-repo-check` as a
 * subprocess and parses the JSONL event stream. Returns a terminal-shaped
 * object compatible with writeMulticaRunEpisode (episode-sync.mjs).
 *
 * This is the non-cmux, non-interactive backend path introduced in DOS-334.
 * It does NOT depend on cmux, tmux, or any visible-pane infrastructure.
 *
 * Invocation contract:
 *   runCodexExec(prompt, opts?) → Promise<CodexTerminal>
 *
 * CodexTerminal shape (matches the episode-record contract):
 *   {
 *     status:       'completed' | 'failed',
 *     notes:        string,
 *     messages:     Array<{type, text, command?}>,  // JSONL items
 *     task_id:      null,           // not applicable for direct exec
 *     agent_id:     null,           // not applicable for direct exec
 *     agent_name:   string,         // persona passed in opts, or 'codex'
 *     work_dir:     string | null,
 *     attempts:     1,
 *     started_at:   string,         // ISO timestamp
 *     completed_at: string,         // ISO timestamp
 *     // codex-specific extras:
 *     thread_id:    string | null,
 *     usage:        object | null,
 *   }
 *
 * Supported codex exec flags (v0.143.0):
 *   --json                              → JSONL event stream (required)
 *   --ephemeral                         → no session persistence
 *   --skip-git-repo-check               → allow running outside a git repo
 *   --sandbox <read-only|workspace-write|danger-full-access>
 *   -C <dir>                            → working directory
 *   -m <model>                          → model override
 *
 * KNOWN NON-INTERACTIVE FORM (do NOT use bare `codex exec` — it hangs ~2min):
 *   codex exec --json --ephemeral --skip-git-repo-check [opts] "<prompt>"
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const CODEX_CMD = process.env.CODEX_CMD || 'codex';

/**
 * Resolve the model id for a codex run. codex exec --json does not report the model
 * in its event stream, so we take it from the explicit opts.model when provided, else
 * the codex CLI's configured default (~/.codex/config.toml `model = "..."`). Returns
 * null when neither is available (best-effort, never throws).
 *
 * @param {{ model?: string|null }} [opts]
 * @returns {string|null}
 */
export function resolveCodexModel(opts = {}) {
  if (opts && opts.model) return String(opts.model);
  try {
    const cfg = readFileSync(join(homedir(), '.codex', 'config.toml'), 'utf8');
    const m = cfg.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Spawn codex exec and return a promise that resolves with the collected
 * JSONL events. Rejects on spawn error, non-zero exit, or timeout.
 *
 * @param {string} prompt
 * @param {{
 *   sandbox?: string,
 *   workDir?: string,
 *   model?: string,
 *   timeoutMs?: number,
 *   _spawn?: typeof spawn,  // injectable for tests
 * }} opts
 * @returns {Promise<{events: object[], exitCode: number}>}
 */
export function spawnCodexExec(prompt, opts = {}) {
  const {
    sandbox = null,
    workDir = null,
    model = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    _spawn = spawn,
  } = opts;

  return new Promise((resolve, reject) => {
    const args = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];
    if (sandbox) args.push('--sandbox', sandbox);
    if (model) args.push('-m', model);
    if (workDir) args.push('-C', workDir);
    args.push(prompt);

    let timedOut = false;
    let stdout = '';
    let stderr = '';

    const child = _spawn(CODEX_CMD, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(Object.assign(new Error(`codex spawn error: ${err.message}`), { code: 'SPAWN_ERROR', stderr }));
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(Object.assign(new Error(`codex exec timed out after ${timeoutMs}ms`), { code: 'TIMEOUT', stderr }));
        return;
      }
      const events = parseJsonl(stdout);
      resolve({ events, exitCode: exitCode ?? 1 });
    });
  });
}

/**
 * Parse JSONL output from `codex exec --json`, filtering stderr noise.
 * Non-JSON lines (e.g. "Reading additional input from stdin...") are skipped.
 *
 * @param {string} text
 * @returns {object[]}
 */
export function parseJsonl(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

/**
 * Extract the final agent message text from JSONL events.
 * The last `item.completed` event with `type: 'agent_message'` is the response.
 *
 * @param {object[]} events
 * @returns {string}
 */
export function extractAgentMessage(events) {
  const agentMessages = events.filter(
    (e) => e?.type === 'item.completed' && e?.item?.type === 'agent_message',
  );
  return agentMessages.at(-1)?.item?.text ?? '';
}

/**
 * Extract thread_id from JSONL events.
 *
 * @param {object[]} events
 * @returns {string|null}
 */
export function extractThreadId(events) {
  const started = events.find((e) => e?.type === 'thread.started');
  return started?.thread_id ?? null;
}

/**
 * Extract usage from the turn.completed event.
 *
 * @param {object[]} events
 * @returns {object|null}
 */
export function extractUsage(events) {
  const turn = events.find((e) => e?.type === 'turn.completed');
  return turn?.usage ?? null;
}

/**
 * Convert JSONL events to the messages[] array shape for episode records.
 * Captures agent messages and command executions.
 *
 * @param {object[]} events
 * @returns {Array<{type: string, text?: string, command?: string, exit_code?: number|null}>}
 */
export function eventsToMessages(events) {
  return events
    .filter((e) => e?.type === 'item.completed')
    .map((e) => {
      const item = e.item ?? {};
      if (item.type === 'agent_message') {
        return { type: 'agent_message', text: item.text ?? '' };
      }
      if (item.type === 'command_execution') {
        return {
          type: 'command_execution',
          command: item.command ?? '',
          exit_code: item.exit_code ?? null,
          output: item.aggregated_output ?? '',
        };
      }
      return null;
    })
    .filter(Boolean);
}

/**
 * Run codex exec headlessly and return a dispatch_result terminal object.
 *
 * @param {string} prompt — the full story brief / prompt to send to codex
 * @param {{
 *   agentName?: string,
 *   sandbox?: string,
 *   workDir?: string,
 *   model?: string,
 *   timeoutMs?: number,
 *   _spawn?: typeof spawn,
 * }} opts
 * @returns {Promise<CodexTerminal>}
 */
export async function runCodexExec(prompt, opts = {}) {
  const { agentName = 'codex' } = opts;
  const startedAt = new Date().toISOString();
  const model = resolveCodexModel(opts);

  let events;
  let exitCode;
  try {
    ({ events, exitCode } = await spawnCodexExec(prompt, opts));
  } catch (err) {
    const completedAt = new Date().toISOString();
    return {
      status: 'failed',
      notes: err?.message ?? String(err),
      messages: [],
      task_id: null,
      agent_id: null,
      agent_name: agentName,
      work_dir: opts.workDir ?? null,
      attempts: 1,
      started_at: startedAt,
      completed_at: completedAt,
      thread_id: null,
      usage: null,
      model,
    };
  }

  const completedAt = new Date().toISOString();
  const threadId = extractThreadId(events);
  const usage = extractUsage(events);
  const messages = eventsToMessages(events);
  const agentText = extractAgentMessage(events);

  const failed = exitCode !== 0 || messages.length === 0;
  const notes = failed && !agentText
    ? `codex exec exited ${exitCode} with no agent message`
    : agentText.slice(0, 200); // keep notes concise

  return {
    status: failed ? 'failed' : 'completed',
    notes,
    messages,
    task_id: null,
    agent_id: null,
    agent_name: agentName,
    work_dir: opts.workDir ?? null,
    attempts: 1,
    started_at: startedAt,
    completed_at: completedAt,
    thread_id: threadId,
    usage,
    model,
  };
}
