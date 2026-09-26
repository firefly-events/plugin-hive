/**
 * Actual-tier backend availability + fallback decision (Hive↔SimMan bridge seam).
 *
 * M0 built the seam; M2 flipped the backend to the external SimMan product
 * (firefly-events/simman). See:
 *   .pHive/proposals/hive-simman-bridge-contract.md
 *   .pHive/proposals/simman-spinout-plan.md
 *
 * Policy: once `/test` resolves `mode_decision = actual`, we do NOT assume the
 * vision-cursor path is available. SimMan is an OPTIONAL external dependency. We
 * probe for it and either keep `actual` (SimMan present) or return `inconclusive`
 * (SimMan absent, on_unavailable=fallback) — unless the operator demanded strict
 * behavior via on_unavailable=abort (CI).
 *
 * Detect-and-prefer with explicit inconclusive on fallback — actual-format scenarios
 * cannot be routed to the simulated-manual executor, so fallback is never a silent
 * downgrade to `default`. A loud WARNING is emitted and the outcome is `inconclusive`
 * so test-dispatch surfaces it without attempting an incompatible executor path.
 *
 * Boundary: this module is pure Hive glue and STAYS in Hive. The runner, MLX sidecar,
 * and grounding all live in SimMan now (deleted from hive/lib/actual-manual/ in M2).
 * Hive binds to SimMan through its CLI (`simman run <scenario> --json`); provider /
 * model / sidecar readiness is SimMan's concern, surfaced via its exit codes at run
 * time. The probe here answers "is the SimMan CLI or service reachable?".
 *
 * sources keys (bridge contract — outside the standard 5-tier mode-resolver sources):
 *   actual_backend: 'simman'       — SimMan available; mode_decision=actual
 *   actual_fallback: 'inconclusive' — SimMan unavailable, on_unavailable=fallback;
 *                                     mode_decision=inconclusive (never routed to simulated-manual)
 * Both keys are documented here and in test-dispatch/SKILL.md sources/outputs contract.
 */

import { execFile } from 'node:child_process';

/** @typedef {'fallback'|'abort'} OnUnavailable */

/**
 * Resolve the SimMan command Hive should invoke. Resolution order (env wins):
 *   1. env `SIMMAN_CMD`  — operator override; wins over project config
 *   2. explicit `simmanCmd` (config `test.actual.simman_cmd`)
 *   3. `simman` on PATH (npm-linked / globally installed)
 *
 * Env wins over config so operators can override without editing project config.
 *
 * @param {{ simmanCmd?: string|null }} [opts]
 * @returns {string}
 */
export function resolveSimmanCmd({ simmanCmd = null } = {}) {
  return process.env.SIMMAN_CMD || simmanCmd || 'simman';
}

/**
 * Default CLI presence check: spawn `<cmd> --help` with a short timeout.
 * ENOENT → not installed. EACCES → not executable (handled explicitly).
 * Checks both stdout AND stderr for /simman/i — usage text often goes to stderr.
 *
 * @param {string} cmd
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
function defaultProbeCli(cmd, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, ['--help'], { timeout: timeoutMs }, (err, stdout, stderr) => {
      const combined = `${stdout ?? ''}${stderr ?? ''}`;
      if (!err) {
        // Zero-exit — verify the binary actually identifies as simman
        const isSimman = /simman/i.test(combined);
        return resolve(isSimman
          ? { ok: true, detail: `${cmd} --help ok` }
          : { ok: false, detail: `${cmd} ran (exit 0) but output does not identify as simman` });
      }
      if (err.code === 'ENOENT') return resolve({ ok: false, detail: `simman not found (cmd="${cmd}")` });
      if (err.code === 'EACCES') return resolve({ ok: false, detail: `simman not executable (cmd="${cmd}"): permission denied` });
      if (err.killed) return resolve({ ok: false, detail: `simman --help timed out after ${timeoutMs}ms` });
      // Non-zero exit — check combined stdout+stderr for simman identity
      const isSimman = /simman/i.test(combined);
      return resolve(isSimman
        ? { ok: true, detail: `${cmd} present (--help exited ${err.code})` }
        : { ok: false, detail: `simman --help failed: ${err.message}` });
    });
  });
}

/**
 * Default URL reachability check: HTTP GET with short timeout.
 * Any 2xx/3xx/4xx is treated as "service present" (5xx or network error = absent).
 * Injectable for tests.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function defaultProbeUrl(url, timeoutMs) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, method: 'GET' });
      const ok = res.status < 500;
      return { ok, detail: `${url} HTTP ${res.status}` };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, detail: `${url} timed out after ${timeoutMs}ms` };
    return { ok: false, detail: `${url} unreachable: ${e.message}` };
  }
}

/**
 * Availability probe for the actual (SimMan) backend.
 *
 * Resolution tiers (first available wins):
 *   1. simman_url: HTTP GET probe — service running at that URL (fastest, no CLI needed)
 *   2. CLI: spawn `simman --help`, verify binary identity via stdout+stderr
 *
 * Not-found / timeout surfaces as `available:false` (→ inconclusive on fallback),
 * never a thrown error — matching the bridge contract (absence triggers fallback, not abort).
 *
 * @param {{
 *   simmanCmd?: string|null, simmanUrl?: string|null, timeoutMs?: number,
 *   _probeCli?: (cmd: string, timeoutMs: number) => Promise<{ok: boolean, detail: string}>,
 *   _probeUrl?: (url: string, timeoutMs: number) => Promise<{ok: boolean, detail: string}>
 * }} [opts]
 * @returns {Promise<{ available: boolean, state: 'ready'|'not_ready', detail: string, backend: 'simman'|null, cmd: string }>}
 */
export async function probeActualBackend({
  simmanCmd = null,
  simmanUrl = null,
  timeoutMs = 4000,
  _probeCli = defaultProbeCli,
  _probeUrl = defaultProbeUrl,
} = {}) {
  const cmd = resolveSimmanCmd({ simmanCmd });

  // Tier 1: service URL probe (when configured)
  if (simmanUrl) {
    const urlRes = await _probeUrl(simmanUrl, timeoutMs);
    if (urlRes.ok) {
      return {
        available: true,
        state: 'ready',
        detail: urlRes.detail,
        backend: 'simman',
        cmd,
      };
    }
    // URL unreachable — fall through to CLI tier
  }

  // Tier 2: CLI probe
  const cliRes = await _probeCli(cmd, timeoutMs);
  const detail = simmanUrl
    ? `${cliRes.detail} (simman_url=${simmanUrl} also unreachable)`
    : cliRes.detail;
  const available = cliRes.ok;
  return {
    available,
    state: available ? 'ready' : 'not_ready',
    detail,
    backend: available ? 'simman' : null,
    cmd,
  };
}

/**
 * Pure decision: given availability + the on_unavailable policy, decide whether to
 * keep `actual`, return `inconclusive` (fallback), or throw (abort).
 *
 * IMPORTANT: when SimMan is unavailable and on_unavailable=fallback, the outcome is
 * `inconclusive` — NOT a downgrade to `default`/simulated-manual. Actual-format
 * scenarios cannot run on the simulated-manual executor; routing them there causes a
 * schema crash or a false green pass. The caller (test-dispatch) must surface the
 * inconclusive outcome and must NOT attempt to run the scenario.
 *
 * @param {{ available: boolean, onUnavailable?: OnUnavailable, probeDetail?: string }} args
 * @returns {{ mode_decision: 'actual'|'inconclusive', sources: object, reason: string }}
 */
export function resolveActualBackend({ available, onUnavailable = 'fallback', probeDetail = '' }) {
  if (available) {
    return {
      mode_decision: 'actual',
      sources: { actual_backend: 'simman' },
      reason: 'simman-ready',
    };
  }
  if (onUnavailable === 'abort') {
    const err = new Error(
      `actual mode selected but SimMan is unavailable and on_unavailable=abort: ${probeDetail}`,
    );
    err.code = 'ACTUAL_UNAVAILABLE_ABORT';
    throw err;
  }
  // Fallback: SimMan absent, on_unavailable=fallback.
  // Return inconclusive — do NOT route to simulated-manual; actual-format scenarios are incompatible.
  return {
    mode_decision: 'inconclusive',
    sources: { actual_fallback: 'inconclusive' },
    reason: `simman-unavailable: ${probeDetail}`,
  };
}

/**
 * Orchestrator: probe, then decide. The single entrypoint `test-dispatch` calls on
 * the `actual` branch. Returns the decision plus the raw probe for logging.
 *
 * @param {{
 *   simmanCmd?: string|null, simmanUrl?: string|null, timeoutMs?: number,
 *   onUnavailable?: OnUnavailable,
 *   _probe?: typeof probeActualBackend
 * }} [opts]
 * @returns {Promise<{ mode_decision: 'actual'|'inconclusive', sources: object, reason: string, probe: object }>}
 */
export async function decideActual({
  simmanCmd = null,
  simmanUrl = null,
  timeoutMs = 4000,
  onUnavailable = 'fallback',
  _probe = probeActualBackend,
} = {}) {
  const probe = await _probe({ simmanCmd, simmanUrl, timeoutMs });
  const decision = resolveActualBackend({
    available: probe.available,
    onUnavailable,
    probeDetail: probe.detail,
  });
  return { ...decision, probe };
}

/**
 * Format the resolve log line for an actual-tier backend decision.
 *
 * Emits `[telemetry] test_dispatch` on the ready path (SimMan available).
 * Emits `[WARNING] test_dispatch` on inconclusive (SimMan unavailable, fallback).
 *
 * This is a SECOND line alongside the Step 0 `[telemetry] test_dispatch test_mode=actual`
 * line — the actual-tier probe is the only mode with a runtime-variable backend, so it
 * warrants its own entry per the bridge contract (§2).
 *
 * Uses `probe.backend` (the value the probe already computed) rather than re-deriving
 * from sources keys.
 *
 * @param {{ probe: { state: string, backend?: string|null }, mode_decision: string, sources: object, reason: string }} d
 * @returns {string}
 */
export function formatActualResolveLog({ probe, mode_decision, sources, reason }) {
  const backend = probe.backend ?? sources.actual_backend ?? sources.actual_fallback ?? 'unknown';
  const prefix = mode_decision === 'actual' ? '[telemetry]' : '[WARNING]';
  return `${prefix} test_dispatch actual_backend probe=${probe.state} decision=${mode_decision} backend=${backend} reason=${reason}`;
}

export default decideActual;
