/**
 * Node readiness probe for an externally-managed MLX Qwen sidecar.
 *
 * Story: am-5-mlx-qwen-sidecar (actual-manual-tier) — review remediation.
 *
 * Thin, subprocess-free companion to mlx_sidecar.py:probe_ready. Used by the
 * /test actual Step 1 Node path to confirm a separately-launched MLX server is
 * serving before scenario execution. No curl/wget — fetch with an abort timeout.
 *
 * Mirrors the Python contract byte-for-byte:
 *   { state: 'ready' | 'not_ready' | 'error', detail: string }
 */

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8089; // 8080 is owned by Multica — never use it

/**
 * @param {{ host?: string, port?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ state: 'ready'|'not_ready'|'error', detail: string }>}
 */
export async function probeReady({ host = DEFAULT_HOST, port = DEFAULT_PORT, timeoutMs = 2000 } = {}) {
  const url = `http://${host}:${port}/v1/models`;
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 200) return { state: 'ready', detail: `${url} returned 200` };
    return { state: 'not_ready', detail: `${url} returned HTTP ${r.status}` };
  } catch (e) {
    return { state: 'error', detail: `cannot reach ${url}: ${e?.message || e}` };
  }
}
