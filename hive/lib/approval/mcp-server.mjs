#!/usr/bin/env node
/**
 * Approval Actions MCP server — the non-Multica fallback surface (DOS-221).
 *
 * Exposes the Stage 1 ApprovalEngine (hive/lib/approval/engine.mjs) directly
 * over MCP stdio JSON-RPC 2.0 for platforms without the Multica dashboard
 * micro-frontend. Reads/writes the same SQLite-backed store as server.mjs
 * (WAL mode; see engine.mjs's double-resolution guard for the cross-process
 * contract both consumers share).
 *
 * Tools:
 *   list_pending_approvals — filter by status/actionType
 *   get_pending_approval   — fetch one pending approval by id
 *   submit_verdict         — resolve an approval (human-gate: single verdict;
 *                             agent-quorum/multi-agent-vote: full verdict array)
 *   list_decision_records   — list resolved audit records
 *   get_decision_record     — fetch one audit record by approval id
 *
 * Registered in .mcp.json as "approval-actions". Configure the SQLite path
 * via APPROVAL_DB_PATH env var (default: .pHive/approval-audit.db, matching
 * server.mjs).
 *
 * Non-goal (by design — see docs/approval-plugin.md): there is no tool here
 * that accepts or stores a raw secret/credential from chat. This surface only
 * ever reads/writes approval decisions; it is not a secrets-entry path.
 */

import { createEngine } from './engine.mjs';

const SERVER_NAME = 'approval-actions';
const SERVER_VERSION = '0.1.0';

const engine = createEngine(process.env.APPROVAL_DB_PATH);

const TOOL_DEFINITIONS = [
  {
    name: 'list_pending_approvals',
    description:
      'List pending (or resolved) approvals, optionally filtered by action type. ' +
      'Defaults to status="pending".',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'resolved'], description: 'Defaults to "pending".' },
        actionType: { type: 'string', description: 'Filter to a single action type (e.g. "repo-creation").' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_pending_approval',
    description: 'Fetch a single pending approval by id, including its action context and mode.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string', description: 'The pending approval id.' },
      },
      required: ['approvalId'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_verdict',
    description:
      'Resolve a pending approval by submitting a verdict. For human-gate, pass "verdict" ' +
      '(a single { approve, approverIdentity, note? } object). For agent-quorum and ' +
      'multi-agent-vote, pass "verdicts" (the complete array of { identity, approve, reasoning, ' +
      'hardVeto? } entries — one per configured quorum member / panel lens; partial submissions ' +
      'are rejected so a missing hard-veto lens can never be silently skipped). Writes the durable ' +
      'audit record on success.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string', description: 'The pending approval id to resolve.' },
        verdict: {
          type: 'object',
          description: 'human-gate only: a single verdict.',
          properties: {
            approve: { type: 'boolean' },
            approverIdentity: { type: 'string' },
            note: { type: 'string' },
          },
          required: ['approve', 'approverIdentity'],
          additionalProperties: false,
        },
        verdicts: {
          type: 'array',
          description: 'agent-quorum / multi-agent-vote only: the complete set of verdict entries.',
          items: {
            type: 'object',
            properties: {
              identity: { type: 'string' },
              approve: { type: 'boolean' },
              reasoning: { type: 'string' },
              hardVeto: { type: 'boolean' },
            },
            required: ['identity', 'approve'],
            additionalProperties: false,
          },
        },
      },
      required: ['approvalId'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_decision_records',
    description: 'List resolved audit/decision records, optionally filtered by action type.',
    inputSchema: {
      type: 'object',
      properties: {
        actionType: { type: 'string', description: 'Filter to a single action type.' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: 'get_decision_record',
    description: 'Fetch the durable audit record (who/when/how/reasoning/pass-check) for a resolved approval.',
    inputSchema: {
      type: 'object',
      properties: {
        approvalId: { type: 'string', description: 'The approval id the record was resolved for.' },
      },
      required: ['approvalId'],
      additionalProperties: false,
    },
  },
];

function requireArgs(name, args, required) {
  const missing = required.filter((k) => args?.[k] === undefined || args?.[k] === null);
  if (missing.length > 0) {
    throw Object.assign(
      new Error(`${name}: missing required argument(s): ${missing.join(', ')}`),
      { code: 'MISSING_ARGS' },
    );
  }
}

async function invokeTool(name, args) {
  const a = args ?? {};
  switch (name) {
    case 'list_pending_approvals':
      return engine.listPending({ status: a.status ?? 'pending', actionType: a.actionType });

    case 'get_pending_approval': {
      requireArgs(name, a, ['approvalId']);
      const pending = engine.getPending(a.approvalId);
      if (!pending) throw Object.assign(new Error(`No pending approval found: ${a.approvalId}`), { code: 'NOT_FOUND' });
      return pending;
    }

    case 'submit_verdict': {
      requireArgs(name, a, ['approvalId']);
      if (a.verdict === undefined && a.verdicts === undefined) {
        throw Object.assign(new Error('submit_verdict: pass either "verdict" (human-gate) or "verdicts" (quorum/vote)'), { code: 'MISSING_ARGS' });
      }
      const verdicts = a.verdicts !== undefined ? a.verdicts : a.verdict;
      const timestamp = new Date().toISOString();
      const result = engine.submit(a.approvalId, verdicts, timestamp);
      if ('error' in result) {
        throw Object.assign(new Error(result.error.message || result.error.reason), { code: result.error.reason });
      }
      return result.auditRecord;
    }

    case 'list_decision_records':
      return engine.listAuditRecords({ actionType: a.actionType });

    case 'get_decision_record': {
      requireArgs(name, a, ['approvalId']);
      const record = engine.getAuditRecord(a.approvalId);
      if (!record) throw Object.assign(new Error(`No decision record found for approval: ${a.approvalId}`), { code: 'NOT_FOUND' });
      return record;
    }

    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: 'UNKNOWN_TOOL' });
  }
}

// ── MCP JSON-RPC 2.0 transport ──────────────────────────────────────────────
// Newline-delimited JSON-RPC over stdio (matches hive/lib/multica-story-
// dispatch/mcp-tools.mjs — the current canonical framing in this repo).
// Stateless: tools/list and tools/call work identically whether or not
// `initialize` was received; no session state is kept.

function writeMessage(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function makeToolResponse(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

async function handleRpcMessage(message) {
  if (!message || typeof message !== 'object') return;
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
      writeMessage({ jsonrpc: '2.0', id: message.id, result: { tools: TOOL_DEFINITIONS } });
      return;
    }

    if (message.method === 'tools/call') {
      const result = await invokeTool(message.params?.name, message.params?.arguments);
      writeMessage({ jsonrpc: '2.0', id: message.id, result: makeToolResponse(result) });
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
      error: {
        code: -32000,
        message: error?.message ?? String(error),
        // `data.reason` carries the engine/tool error code (e.g. 'not_found',
        // 'incomplete_panel', 'MISSING_ARGS') so callers can branch on it
        // without string-matching `message`.
        data: error?.code ? { reason: error.code } : undefined,
      },
    });
  }
}

export function startMcpServer() {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  startMcpServer();
}
