/**
 * ChromaDB JSON-RPC Wrapper
 *
 * Communicates with a long-lived ChromaDB sidecar process over JSON-RPC.
 * Design decision D2: ChromaDB runs as a persistent process (not spawned per-query)
 * to avoid Python cold-start latency (~2s). The sidecar must be started separately
 * (see kickoff-protocol.md Phase 5 for the nudge).
 *
 * All methods degrade gracefully — callers receive null/false/[] rather than errors
 * when the sidecar is unavailable.
 */

// ESM module: hive/lib/package.json declares `"type": "module"`, so plain
// `.js` files in this package scope are ES modules (the previous CJS form was
// un-loadable here — same conversion as config.js). Named exports unchanged;
// on Node >= 20.19 `require()` of this file works via require(esm).
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8000;  // ChromaDB default HTTP port
const AVAILABILITY_TIMEOUT_MS = 500;
const QUERY_TIMEOUT_MS = 5000;
const DECISIONS_COLLECTION = 'decisions';

function readDynamicPort() {
  try {
    const portFile = path.join(os.homedir(), '.claude', 'hive', 'chromadb.port');
    const port = Number.parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10);
    return Number.isInteger(port) ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}

const RESOLVED_PORT = readDynamicPort();
let bootstrapDone = false;

async function ensureDecisionsCollection(host = DEFAULT_HOST, port = RESOLVED_PORT) {
  const body = JSON.stringify({
    name: DECISIONS_COLLECTION,
    get_or_create: true
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        host, port,
        path: '/api/v1/collections',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: QUERY_TIMEOUT_MS
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(true);
            return;
          }
          console.warn(`[chromadb-wrapper] decisions collection bootstrap failed with status ${res.statusCode}`);
          resolve(false);
        });
        res.on('error', () => {
          console.warn('[chromadb-wrapper] decisions collection bootstrap response error');
          resolve(false);
        });
      }
    );
    req.on('error', () => { console.warn('[chromadb-wrapper] decisions collection bootstrap error'); resolve(false); });
    req.on('timeout', () => { req.destroy(); console.warn('[chromadb-wrapper] decisions collection bootstrap timeout'); resolve(false); });
    req.write(body);
    req.end();
  });
}

/**
 * Check whether the ChromaDB sidecar is reachable.
 * @param {string} [host=localhost]
 * @param {number} [port=resolved dynamic port]
 * @returns {Promise<boolean>} — never rejects; returns false on any error
 */
async function isAvailable(host = DEFAULT_HOST, port = RESOLVED_PORT) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/api/v1/heartbeat', timeout: AVAILABILITY_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(false);
          return;
        }
        if (!bootstrapDone) {
          ensureDecisionsCollection(host, port)
            .then(() => { bootstrapDone = true; resolve(true); })
            .catch((err) => {
              console.warn(`[chromadb] decisions bootstrap failed; will retry on next heartbeat: ${err.message}`);
              resolve(true);
            });
          return;
        }
        resolve(true);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Query ChromaDB for semantically similar documents.
 * @param {string} collectionName — ChromaDB collection to search
 * @param {string} queryText — the search query
 * @param {number} [topK=5] — number of results to return
 * @param {string} [host=localhost]
 * @param {number} [port=resolved dynamic port]
 * @returns {Promise<Array<{id: string, document: string, distance: number, metadata: Object}>>} — empty array on error.
 * `metadata` is the document's metadata dict as stored at index time (predicate / source_epic / source_agent / valid_from per B0.2). May be `{}` for documents indexed without metadata.
 */
async function query(collectionName, queryText, topK = 5, host = DEFAULT_HOST, port = RESOLVED_PORT) {
  const body = JSON.stringify({
    query_texts: [queryText],
    n_results: topK,
    include: ['documents', 'distances', 'metadatas']
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        host, port,
        path: `/api/v1/collections/${encodeURIComponent(collectionName)}/query`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: QUERY_TIMEOUT_MS
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.warn(`[chromadb-wrapper] query failed with status ${res.statusCode} — falling back to L1+L0`);
            resolve([]);
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const ids = (parsed.ids && parsed.ids[0]) || [];
            const docs = (parsed.documents && parsed.documents[0]) || [];
            const distances = (parsed.distances && parsed.distances[0]) || [];
            const metadatas = (parsed.metadatas && parsed.metadatas[0]) || [];
            resolve(ids.map((id, i) => ({
              id,
              document: docs[i] || '',
              distance: distances[i] || 0,
              metadata: metadatas[i] || {}
            })));
          } catch {
            console.warn('[chromadb-wrapper] query parse error — falling back to L1+L0');
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => { console.warn('[chromadb-wrapper] query error — falling back to L1+L0'); resolve([]); });
    req.on('timeout', () => { req.destroy(); console.warn('[chromadb-wrapper] query timeout — falling back to L1+L0'); resolve([]); });
    req.write(body);
    req.end();
  });
}

/**
 * Index a document into ChromaDB. Idempotent on duplicate doc IDs.
 * @param {string} collectionName
 * @param {string} docId — unique identifier for this document
 * @param {string} content — the text content to index
 * @param {Object} [metadata={}] — optional metadata fields
 * @param {string} [host=localhost]
 * @param {number} [port=resolved dynamic port]
 * @returns {Promise<boolean>} — true on success, false on error
 */
async function index(collectionName, docId, content, metadata = {}, host = DEFAULT_HOST, port = RESOLVED_PORT) {
  const body = JSON.stringify({
    ids: [docId],
    documents: [content],
    metadatas: [metadata]
  });

  return new Promise((resolve) => {
    const req = http.request(
      {
        host, port,
        path: `/api/v1/collections/${encodeURIComponent(collectionName)}/upsert`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: QUERY_TIMEOUT_MS
      },
      (res) => {
        // Drain response body to free the keep-alive connection before resolving
        res.on('data', () => {});
        res.on('end', () => { resolve(res.statusCode === 200 || res.statusCode === 201); });
        res.on('error', () => { resolve(false); });
      }
    );
    req.on('error', () => { console.warn('[chromadb-wrapper] index error'); resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

export { isAvailable, query, index, ensureDecisionsCollection, readDynamicPort };
