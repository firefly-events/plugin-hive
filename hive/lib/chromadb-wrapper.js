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

const http = require('http');

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8000;  // ChromaDB default HTTP port
const AVAILABILITY_TIMEOUT_MS = 500;
const QUERY_TIMEOUT_MS = 5000;

/**
 * Check whether the ChromaDB sidecar is reachable.
 * @param {string} [host=localhost]
 * @param {number} [port=8000]
 * @returns {Promise<boolean>} — never rejects; returns false on any error
 */
async function isAvailable(host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return new Promise((resolve) => {
    const req = http.get(
      { host, port, path: '/api/v1/heartbeat', timeout: AVAILABILITY_TIMEOUT_MS },
      (res) => {
        resolve(res.statusCode === 200);
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
 * @param {number} [port=8000]
 * @returns {Promise<Array<{id: string, document: string, distance: number}>>} — empty array on error
 */
async function query(collectionName, queryText, topK = 5, host = DEFAULT_HOST, port = DEFAULT_PORT) {
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
          try {
            const parsed = JSON.parse(data);
            const ids = (parsed.ids && parsed.ids[0]) || [];
            const docs = (parsed.documents && parsed.documents[0]) || [];
            const distances = (parsed.distances && parsed.distances[0]) || [];
            resolve(ids.map((id, i) => ({ id, document: docs[i] || '', distance: distances[i] || 0 })));
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
 * @param {number} [port=8000]
 * @returns {Promise<boolean>} — true on success, false on error
 */
async function index(collectionName, docId, content, metadata = {}, host = DEFAULT_HOST, port = DEFAULT_PORT) {
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
      (res) => { resolve(res.statusCode === 200 || res.statusCode === 201); }
    );
    req.on('error', () => { console.warn('[chromadb-wrapper] index error'); resolve(false); });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

module.exports = { isAvailable, query, index };
