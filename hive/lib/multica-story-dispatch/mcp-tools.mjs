#!/usr/bin/env node
/**
 * hermes-multica MCP server — thin JSON-RPC 2.0 stdio wrapper over cli.mjs.
 *
 * No business logic lives here. Every tool delegates to the matching
 * cli.mjs subcommand and returns its stdout verbatim as the text content,
 * guaranteeing byte-equivalent parity with direct cli.mjs invocations.
 *
 * Registered in .mcp.json as "hermes-multica". Configure the cli.mjs path
 * via CLI_MJS_PATH env var (default: <this-dir>/cli.mjs).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SERVER_NAME = 'hermes-multica';
const SERVER_VERSION = '0.1.0';

// CLI_MJS_PATH lets deployments override the cli.mjs location without
// changing this file — essential when plugin-hive is checked out at
// a non-standard path (e.g. ~/Code/plugin-hive vs /opt/hive).
const CLI_PATH = process.env.CLI_MJS_PATH ?? path.join(__dirname, 'cli.mjs');

// ── Tool ABI ────────────────────────────────────────────────────────────────
// This is the pinned contract h-04/h-05/h-07 bind to.

const TOOL_DEFINITIONS = [
  {
    name: 'multica_dispatch_story',
    description:
      'Dispatch a story issue to an agent or squad. Returns {status, issue_id, task_id}. ' +
      'status is "dispatched" on a new dispatch or "already_dispatched" on an idempotent call.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: {
          type: 'string',
          description: 'UUID of the Multica issue to dispatch.',
        },
        agent_name: {
          type: 'string',
          description: 'Name of the agent to assign. Mutually exclusive with squad_name.',
        },
        squad_name: {
          type: 'string',
          description: 'Name of the squad to assign. Mutually exclusive with agent_name.',
        },
      },
      required: ['issue_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_poll_task',
    description:
      'Poll a dispatched issue task until it reaches a terminal status (completed/failed/cancelled). ' +
      'Returns the terminal task object: {status, notes, task_id, agent_id, agent_name, work_dir, attempts, started_at, completed_at, ...}.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: {
          type: 'string',
          description: 'UUID of the Multica issue to poll.',
        },
        timeout_ms: {
          type: 'integer',
          minimum: 1,
          description: 'Max wall-clock milliseconds to wait before giving up (default 1800000 = 30 min).',
        },
      },
      required: ['issue_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_epic_status',
    description:
      'Read the hermes_reconciler cycle-state for an epic from .pHive/cycle-state/<epic>.yaml. ' +
      'Returns {epic, gate_state, current_phase, in_flight_story_id, in_flight_task_id, dispatched_at, stories}. ' +
      'A missing file returns safe defaults (gate_state: null, stories: []).',
    inputSchema: {
      type: 'object',
      properties: {
        epic_handle: {
          type: 'string',
          description: 'Epic identifier, used as the cycle-state file name stem.',
        },
        cycle_state_path: {
          type: 'string',
          description: 'Override path to the cycle-state YAML (optional; default: .pHive/cycle-state/<epic>.yaml).',
        },
      },
      required: ['epic_handle'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_write_state',
    description:
      'Write a partial patch to the hermes_reconciler block in .pHive/cycle-state/<epic>.yaml. ' +
      'Valid top-level patch keys: gate_state, in_flight_story_id, in_flight_task_id, dispatched_at, current_phase, stuck_after_seconds, stories. ' +
      'Returns the full updated state object.',
    inputSchema: {
      type: 'object',
      properties: {
        epic_handle: {
          type: 'string',
          description: 'Epic identifier.',
        },
        patch: {
          description:
            'JSON object (or JSON-serialized string) with hermes_reconciler top-level fields to merge in.',
          oneOf: [{ type: 'object' }, { type: 'string' }],
        },
        cycle_state_path: {
          type: 'string',
          description: 'Override path to the cycle-state YAML (optional).',
        },
      },
      required: ['epic_handle', 'patch'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_post_comment',
    description: 'Post a comment to a Multica issue. Returns {comment_id}.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: {
          type: 'string',
          description: 'UUID of the Multica issue.',
        },
        body: {
          type: 'string',
          description: 'Comment text (plain text or Markdown).',
        },
      },
      required: ['issue_id', 'body'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_episode',
    description:
      'Write a Hive episode marker for a completed story task into .pHive/episodes/. Returns {written, status}.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: {
          type: 'string',
          description: 'UUID of the Multica issue.',
        },
        epic: {
          type: 'string',
          description: 'Epic handle.',
        },
        story: {
          type: 'string',
          description: 'Story ID.',
        },
      },
      required: ['issue_id', 'epic', 'story'],
      additionalProperties: false,
    },
  },
  {
    name: 'multica_cancel',
    description: 'Cancel the active task on a Multica issue. Returns {cancelled, task_id}.',
    inputSchema: {
      type: 'object',
      properties: {
        issue_id: {
          type: 'string',
          description: 'UUID of the Multica issue.',
        },
      },
      required: ['issue_id'],
      additionalProperties: false,
    },
  },
];

// ── CLI bridge ──────────────────────────────────────────────────────────────

/**
 * Invoke `node <CLI_PATH> <subcommand> [...cliArgs]` and return:
 *   { raw: string, parsed: unknown }
 * where `raw` is the verbatim stdout from cli.mjs (the parity guarantee)
 * and `parsed` is the JSON-parsed form for structuredContent.
 *
 * On non-zero exit, throws an Error whose message carries the {code, message}
 * payload from cli.mjs stderr — never swallows error details.
 */
async function callCli(subcommand, cliArgs, { timeoutMs = 300_000 } = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      process.execPath,
      [CLI_PATH, subcommand, ...cliArgs],
      { timeout: timeoutMs },
    ));
  } catch (err) {
    // Command failure: non-zero exit, timeout, or spawn error. cli.mjs emits a
    // {code, message} JSON payload on stderr — surface it; never swallow.
    const stderrText = (err.stderr ? String(err.stderr) : '').trim();
    let errPayload = null;
    try { errPayload = JSON.parse(stderrText); } catch { /* fall through */ }
    const message = (errPayload?.message ?? stderrText) || err.message || String(err);
    const code = errPayload?.code ?? `CLI_${subcommand.replace(/-/g, '_').toUpperCase()}_FAILED`;
    throw Object.assign(new Error(message), { code });
  }
  // Zero-exit but non-JSON stdout is its own failure mode — distinguish it from a
  // command failure so callers get a clear, typed error instead of a generic one.
  const raw = stdout.replace(/\n$/, '');
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch (parseErr) {
    throw Object.assign(
      new Error(`cli.mjs ${subcommand} exited 0 but returned non-JSON stdout: ${raw.slice(0, 200)}`),
      { code: 'CLI_NON_JSON_OUTPUT' },
    );
  }
}

// ── Tool dispatch ───────────────────────────────────────────────────────────

// Required-arg guard: a thin MCP server must not coerce null/undefined into
// "null"/undefined CLI flags (which corrupt comments/episode metadata or cause
// spawn-level errors). Reject malformed calls with a typed error up front.
function requireArgs(toolName, a, fields) {
  for (const f of fields) {
    const v = a[f];
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) {
      throw Object.assign(
        new Error(`${toolName}: required argument "${f}" is missing or empty`),
        { code: 'INVALID_ARGS' },
      );
    }
  }
}

// `poll` waits up to 30 min CLI-side by default; the execFile wrapper must outlast
// that (plus a buffer) or the MCP poll is killed early regardless of timeout_ms.
const POLL_DEFAULT_TIMEOUT_MS = 1_800_000;
const EXEC_TIMEOUT_BUFFER_MS = 60_000;

async function invokeTool(name, args) {
  const a = args ?? {};
  switch (name) {
    case 'multica_dispatch_story': {
      requireArgs(name, a, ['issue_id']);
      if (!a.agent_name && !a.squad_name) {
        throw Object.assign(
          new Error(`${name}: one of "agent_name" or "squad_name" is required`),
          { code: 'INVALID_ARGS' },
        );
      }
      if (a.agent_name && a.squad_name) {
        throw Object.assign(
          new Error(`${name}: "agent_name" and "squad_name" are mutually exclusive`),
          { code: 'INVALID_ARGS' },
        );
      }
      const flags = ['--issue', String(a.issue_id)];
      if (a.agent_name) flags.push('--agent', String(a.agent_name));
      if (a.squad_name) flags.push('--squad', String(a.squad_name));
      return callCli('dispatch', flags);
    }

    case 'multica_poll_task': {
      requireArgs(name, a, ['issue_id']);
      const flags = ['--issue', String(a.issue_id)];
      let requested = POLL_DEFAULT_TIMEOUT_MS;
      if (a.timeout_ms != null) {
        const n = Number(a.timeout_ms);
        if (!Number.isFinite(n) || n <= 0) {
          throw Object.assign(
            new Error(`${name}: "timeout_ms" must be a positive number`),
            { code: 'INVALID_ARGS' },
          );
        }
        requested = n;
        flags.push('--timeout-ms', String(n));
      }
      return callCli('poll', flags, { timeoutMs: requested + EXEC_TIMEOUT_BUFFER_MS });
    }

    case 'multica_epic_status': {
      requireArgs(name, a, ['epic_handle']);
      const flags = ['--epic', String(a.epic_handle)];
      if (a.cycle_state_path) flags.push('--cycle-state', String(a.cycle_state_path));
      return callCli('epic-status', flags);
    }

    case 'multica_write_state': {
      requireArgs(name, a, ['epic_handle', 'patch']);
      const patch = typeof a.patch === 'string' ? a.patch : JSON.stringify(a.patch);
      const flags = ['--epic', String(a.epic_handle), '--patch', patch];
      if (a.cycle_state_path) flags.push('--cycle-state', String(a.cycle_state_path));
      return callCli('write-state', flags);
    }

    case 'multica_post_comment':
      requireArgs(name, a, ['issue_id', 'body']);
      return callCli('comment', ['--issue', String(a.issue_id), '--body', String(a.body)]);

    case 'multica_episode':
      requireArgs(name, a, ['issue_id', 'epic', 'story']);
      return callCli('episode', [
        '--issue', String(a.issue_id),
        '--epic', String(a.epic),
        '--story', String(a.story),
      ]);

    case 'multica_cancel':
      requireArgs(name, a, ['issue_id']);
      return callCli('cancel', ['--issue', String(a.issue_id)]);

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'UNKNOWN_TOOL' });
  }
}

// ── MCP JSON-RPC 2.0 transport ──────────────────────────────────────────────

function writeMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function makeToolResponse({ raw, parsed }) {
  // text is the verbatim cli.mjs stdout — ensures byte-equivalent parity.
  return {
    content: [{ type: 'text', text: raw }],
    structuredContent: parsed,
  };
}

async function handleRpcMessage(message) {
  if (!message || typeof message !== 'object') return;
  // Notifications have no id; ignore silently (e.g. notifications/initialized).
  if (!Object.prototype.hasOwnProperty.call(message, 'id')) return;

  try {
    if (message.method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        },
      });
      return;
    }

    if (message.method === 'tools/list') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: { tools: TOOL_DEFINITIONS },
      });
      return;
    }

    if (message.method === 'tools/call') {
      const result = await invokeTool(
        message.params?.name,
        message.params?.arguments,
      );
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: makeToolResponse(result),
      });
      return;
    }

    if (message.method === 'ping') {
      writeMessage({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }

    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32000, message: error?.message ?? String(error) },
    });
  }
}

function startServer() {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      try {
        handleRpcMessage(JSON.parse(line)).catch((err) => {
          process.stderr.write(`${err?.stack ?? String(err)}\n`);
        });
      } catch (err) {
        process.stderr.write(`Failed to parse JSON-RPC line: ${err?.message ?? String(err)}\n`);
      }
    }
  });
  process.stdin.resume();
}

startServer();
