/**
 * Approval HTTP API server.
 *
 * Exposes the ApprovalEngine over a local HTTP interface so the Multica
 * dashboard micro-frontend can list pending approvals, submit decisions, and
 * read audit records without depending on the Multica server itself. Also
 * serves the plain web dashboard fallback (DOS-221, ./web/) at "/" for
 * platforms without the Multica micro-frontend — same API, no build step.
 *
 * Runs on 127.0.0.1:7841 by default (override via APPROVAL_PORT env var).
 *
 * CORS is same-origin only: the only allowed Access-Control-Allow-Origin
 * values are this server's own 127.0.0.1/localhost origin (the shipped
 * dashboard is served from — and calls back into — that same origin). A
 * request that carries a foreign Origin header is rejected outright rather
 * than answered with a wildcard, so a browser tab open to any other website
 * cannot drive-by submit approval verdicts just because the API happens to
 * be reachable on localhost (DOS-221 round 2).
 *
 * Usage:
 *   node hive/lib/approval/server.mjs           # standalone
 *   import { startApprovalServer } from './server.mjs'  # programmatic
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createEngine } from './engine.mjs';

const PORT = Number(process.env.APPROVAL_PORT ?? 7841);
const HOST = '127.0.0.1';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, 'web');
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
};

// Only this server's own origin is ever allowed to read or mutate approval
// state cross-context. No wildcard: an Origin header that doesn't match one
// of these is rejected, not just left unanswered by CORS. Built from the
// actual bound port rather than the APPROVAL_PORT constant, since APPROVAL_PORT=0
// (used by tests, for an OS-assigned free port) means the real listening port
// isn't known until listen() resolves.
function allowedOriginsFor(port) {
  return new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
}

function isOriginAllowed(allowedOrigins, origin) {
  return !origin || allowedOrigins.has(origin);
}

function corsHeaders(allowedOrigins, origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data, headers) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

export function startApprovalServer(dbPath) {
  const engine = createEngine(dbPath);
  // Finalized once listen() resolves — see the PORT=0 note on allowedOriginsFor().
  let allowedOrigins = allowedOriginsFor(PORT);

  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const headers = corsHeaders(allowedOrigins, origin);

    if (req.method === 'OPTIONS') {
      if (!isOriginAllowed(allowedOrigins, origin)) return send(res, 403, { error: 'origin_not_allowed' }, headers);
      res.writeHead(204, headers);
      return res.end();
    }

    // Same-origin gate: a request carrying a foreign Origin header is
    // rejected before it ever reaches the engine, so a browser tab open to
    // any other website can't drive-by read or submit approval verdicts
    // (DOS-221 round 2). Requests with no Origin header (curl, the MCP
    // server, same-origin non-fetch navigation) are unaffected.
    if (!isOriginAllowed(allowedOrigins, origin)) {
      return send(res, 403, { error: 'origin_not_allowed' }, headers);
    }

    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const { pathname } = url;

    try {
      // GET /api/approvals/pending
      if (req.method === 'GET' && pathname === '/api/approvals/pending') {
        const status = url.searchParams.get('status') ?? 'pending';
        const actionType = url.searchParams.get('actionType') ?? undefined;
        return send(res, 200, engine.listPending({ status, actionType }), headers);
      }

      // GET /api/approvals/pending/:id
      const pendingIdMatch = pathname.match(/^\/api\/approvals\/pending\/([^/]+)$/);
      if (req.method === 'GET' && pendingIdMatch) {
        const pending = engine.getPending(pendingIdMatch[1]);
        if (!pending) return send(res, 404, { error: 'not_found' }, headers);
        return send(res, 200, pending, headers);
      }

      // POST /api/approvals/submit  — human-gate: { approvalId, approve, note?, approverIdentity }
      if (req.method === 'POST' && pathname === '/api/approvals/submit') {
        const body = await readBody(req);
        const { approvalId, approve, note, approverIdentity } = body;
        if (!approvalId || typeof approve !== 'boolean' || !approverIdentity) {
          return send(res, 400, { error: 'missing_fields', required: ['approvalId', 'approve (bool)', 'approverIdentity'] }, headers);
        }
        const timestamp = new Date().toISOString();
        const verdict = { approve, note: note ?? '', approverIdentity };
        const result = engine.submit(approvalId, verdict, timestamp);
        if ('error' in result) return send(res, 400, result, headers);
        return send(res, 200, result.auditRecord, headers);
      }

      // POST /api/approvals/submit-verdicts — agent-quorum / multi-agent-vote:
      // { approvalId, verdicts: VerdictEntry[] } (the complete set, one per
      // configured quorum member / panel lens).
      if (req.method === 'POST' && pathname === '/api/approvals/submit-verdicts') {
        const body = await readBody(req);
        const { approvalId, verdicts } = body;
        if (!approvalId || !Array.isArray(verdicts)) {
          return send(res, 400, { error: 'missing_fields', required: ['approvalId', 'verdicts (array)'] }, headers);
        }
        const timestamp = new Date().toISOString();
        const result = engine.submit(approvalId, verdicts, timestamp);
        if ('error' in result) return send(res, 400, result, headers);
        return send(res, 200, result.auditRecord, headers);
      }

      // GET /api/approvals/audit-records
      if (req.method === 'GET' && pathname === '/api/approvals/audit-records') {
        const actionType = url.searchParams.get('actionType') ?? undefined;
        return send(res, 200, engine.listAuditRecords({ actionType }), headers);
      }

      // GET /api/approvals/audit-records/:id  (looks up by approvalId)
      const auditIdMatch = pathname.match(/^\/api\/approvals\/audit-records\/([^/]+)$/);
      if (req.method === 'GET' && auditIdMatch) {
        const record = engine.getAuditRecord(auditIdMatch[1]);
        if (!record) return send(res, 404, { error: 'not_found' }, headers);
        return send(res, 200, record, headers);
      }

      // GET /health
      if (req.method === 'GET' && pathname === '/health') {
        return send(res, 200, { ok: true }, headers);
      }

      // GET / , /index.html , /app.js — plain web dashboard fallback (DOS-221)
      if (req.method === 'GET' && STATIC_FILES[pathname]) {
        const { file, type } = STATIC_FILES[pathname];
        try {
          const contents = await readFile(path.join(WEB_DIR, file));
          res.writeHead(200, { 'Content-Type': type, ...headers });
          return res.end(contents);
        } catch {
          return send(res, 404, { error: 'not_found' }, headers);
        }
      }

      send(res, 404, { error: 'not_found' }, headers);
    } catch (err) {
      console.error('[approval-server] error:', err);
      send(res, 500, { error: 'internal_error', message: err?.message }, headers);
    }
  });

  server.listen(PORT, HOST, () => {
    allowedOrigins = allowedOriginsFor(server.address().port);
    console.log(`[approval-server] listening at http://${HOST}:${PORT}`);
  });

  return server;
}

// Run standalone when executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  startApprovalServer();
}
