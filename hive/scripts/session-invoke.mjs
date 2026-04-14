/**
 * session-invoke.mjs
 *
 * CLI entry point: translates a Hive workflow step into a Managed Agent session.
 *
 * Usage:
 *   node hive/scripts/session-invoke.mjs --payload-file <path>
 *
 * Exit codes:
 *   0  — success
 *   10 — AUTH_MISSING / AUTH_INVALID
 *   11 — CONTENT_FILTER
 *   12 — RATE_LIMITED (after 3 retries)
 *   13 — CONTEXT_OVERFLOW
 *   14 — NETWORK / API_5XX (after 3 retries)
 *   15 — STUCK
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve lib path relative to this script
const LIB_DIR = path.join(__dirname, '..', 'lib');
const sessionClient = require(path.join(LIB_DIR, 'session-client.js'));
const sessionSseReader = require(path.join(LIB_DIR, 'session-sse-reader.js'));
const sessionRegistry = require(path.join(LIB_DIR, 'session-registry.js'));
const sessionEpisodeWriter = require(path.join(LIB_DIR, 'session-episode-writer.js'));
const sessionPromptBuilder = require(path.join(LIB_DIR, 'session-prompt-builder.js'));
const sessionTurnBuilder = require(path.join(LIB_DIR, 'session-turn-builder.js'));

// ─── Exit code map ────────────────────────────────────────────────────────────
const EXIT_CODES = {
  AUTH_MISSING:    10,
  AUTH_INVALID:    10,
  CONTENT_FILTER:  11,
  RATE_LIMITED:    12,
  CONTEXT_OVERFLOW: 13,
  NETWORK:         14,
  API_5XX:         14,
  STUCK:           15,
};

// ─── Retry policies ───────────────────────────────────────────────────────────
const RETRY_POLICY = {
  RATE_LIMITED: [2000, 5000, 10000],
  NETWORK:      [1000, 2000, 4000],
  API_5XX:      [1000, 2000, 4000],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emitJson(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function readLineFromStdin() {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.once('line', (line) => { rl.close(); resolve(line); });
  });
}

/**
 * Retry an async fn with the given delay sequence.
 * @param {Function} fn - async function to retry
 * @param {number[]} delays - wait times in ms before each retry attempt
 * @returns {Promise<any>}
 */
async function withRetry(fn, delays) {
  let lastErr;
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < delays.length) {
        const effectiveDelays = err.code === 'RATE_LIMITED' ? RETRY_POLICY.RATE_LIMITED : delays;
        const waitMs = effectiveDelays[Math.min(i, effectiveDelays.length - 1)];
        console.error(`[session-invoke] retrying (${i + 1}/${delays.length}) after ${waitMs}ms: ${err.message}`);
        await sleep(waitMs);
      }
    }
  }
  throw lastErr;
}

/**
 * Handle a fatal error: write registry, emit error JSON, exit.
 */
async function fatalExit(code, errorCode, message, sessionId, fields = {}) {
  emitJson({ status: 'failed', error_code: errorCode, message });
  if (sessionId) {
    try {
      await sessionRegistry.update(sessionId, { status: 'failed', last_active_at: new Date().toISOString(), ...fields });
    } catch { /* best-effort */ }
  }
  process.exit(code);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Check API key
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ERROR: ANTHROPIC_API_KEY not set\n');
    process.exit(10);
  }

  // 2. Read payload
  const payloadFlagIdx = process.argv.indexOf('--payload-file');
  if (payloadFlagIdx < 0 || !process.argv[payloadFlagIdx + 1]) {
    process.stderr.write('ERROR: --payload-file <path> is required\n');
    process.exit(1);
  }
  const payloadPath = process.argv[payloadFlagIdx + 1];
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  } catch (err) {
    process.stderr.write(`ERROR: could not read payload file: ${err.message}\n`);
    process.exit(1);
  }

  const {
    epic_id,
    story_id,
    step_id,
    agent_id,
    environment_id,
    agent_role,
    model,
    story_context,
    matched_specialists = [],
  } = payload;

  // 3. Build prompt content
  let content;
  try {
    content = sessionPromptBuilder.buildPrompt({ story_context, epic_id, matched_specialists });
  } catch (err) {
    process.stderr.write(`ERROR: prompt builder failed: ${err.message}\n`);
    process.exit(1);
  }

  // 4. Build first user.message event
  const firstMessage = sessionTurnBuilder.buildFirstMessage(content);

  // 5. Create session (with retry for transient errors)
  let sessionId;
  try {
    sessionId = await withRetry(
      () => sessionClient.createSession(agent_id, environment_id),
      RETRY_POLICY.NETWORK
    );
  } catch (err) {
    const code = err.code || 'API_5XX';
    const exitCode = EXIT_CODES[code] || 14;
    await fatalExit(exitCode, code, err.message, null);
  }

  const createdAt = new Date().toISOString();

  // 6. Register session as pending
  try {
    await sessionRegistry.upsert(sessionId, {
      epic_id, story_id, step_id,
      agent_name: agent_role,
      model,
      status: 'pending',
      created_at: createdAt,
      last_active_at: createdAt,
      sse_last_event_at: null,
    });
  } catch (err) {
    console.warn(`[session-invoke] registry upsert failed (non-fatal): ${err.message}`);
  }

  // 7. Send first message
  try {
    await withRetry(
      () => sessionClient.sendEvents(sessionId, [firstMessage]),
      RETRY_POLICY.NETWORK
    );
  } catch (err) {
    const code = err.code || 'API_5XX';
    const exitCode = EXIT_CODES[code] || 14;
    await fatalExit(exitCode, code, err.message, sessionId);
  }

  // ── SSE streaming loop ────────────────────────────────────────────────────
  const QUIET_STEPS = new Set(['implement', 'test', 'optimize']);
  const stuckThresholdMs = QUIET_STEPS.has(payload.step_id) ? 180_000 : 90_000;

  let sseEventCount = 0;
  let lastRegistryUpdateMs = 0;
  const SSE_REGISTRY_DEBOUNCE_MS = 2000;
  let firstEvent = true;

  // Debounced registry updater for sse_last_event_at; sets status: active on first event
  const onSseEvent = (_event) => {
    sseEventCount++;
    const nowMs = Date.now();
    if (firstEvent) {
      firstEvent = false;
      // 8. Update registry: active (on first real SSE event)
      sessionRegistry.update(sessionId, {
        status: 'active',
        last_active_at: new Date(nowMs).toISOString(),
        sse_last_event_at: new Date(nowMs).toISOString(),
      }).catch(err => console.warn(`[session-invoke] registry active update failed (non-fatal): ${err.message}`));
      lastRegistryUpdateMs = nowMs;
      return;
    }
    if (nowMs - lastRegistryUpdateMs >= SSE_REGISTRY_DEBOUNCE_MS) {
      lastRegistryUpdateMs = nowMs;
      sessionRegistry.update(sessionId, { sse_last_event_at: new Date(nowMs).toISOString() })
        .catch(err => console.warn(`[session-invoke] sse registry update failed: ${err.message}`));
    }
  };

  // Stuck handler: update registry then exit 15
  const onStuck = async () => {
    try {
      await sessionRegistry.update(sessionId, {
        status: 'stuck',
        last_active_at: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
    emitJson({ status: 'failed', error_code: 'STUCK', message: 'No SSE event received within stuck threshold' });
    process.exit(15);
  };

  const rawEvents = [];

  // 9. Stream SSE
  try {
    for await (const item of sessionSseReader.readStream(sessionId, { onSseEvent, onStuck, stuckThresholdMs })) {
      if (item.type === 'event') {
        rawEvents.push(item.event);
        continue;
      }

      if (item.type === 'complete') {
        // Done — fall through to completion handling below
        break;
      }

      if (item.type === 'requires_action') {
        const stopReason = item.stopReason;
        const eventIds = (stopReason.event_ids || []);

        for (const eventId of eventIds) {
          // Look up event details from rawEvents
          const sourceEvent = rawEvents.find(e => e.id === eventId);
          const eventType = sourceEvent ? sourceEvent.type : null;

          if (eventType === 'agent.custom_tool_use') {
            // Emit tool_request to stdout, read result from stdin
            emitJson({
              type: 'tool_request',
              custom_tool_use_id: eventId,
              tool_name: sourceEvent.name || null,
              tool_input: sourceEvent.input || {},
            });
            let resultLine;
            try {
              resultLine = await readLineFromStdin();
            } catch (err) {
              await fatalExit(14, 'NETWORK', `stdin read failed: ${err.message}`, sessionId);
            }
            let toolResult;
            try {
              toolResult = JSON.parse(resultLine);
            } catch {
              toolResult = { result: resultLine };
            }
            const resultEvent = sessionTurnBuilder.buildCustomToolResult(eventId, toolResult.result || '');
            await withRetry(() => sessionClient.sendEvents(sessionId, [resultEvent]), RETRY_POLICY.NETWORK)
              .catch(async (err) => {
                const code = err.code || 'API_5XX';
                await fatalExit(EXIT_CODES[code] || 14, code, err.message, sessionId);
              });
          } else {
            // Treat as built-in tool_use requiring confirmation
            emitJson({
              type: 'tool_request',
              tool_use_id: eventId,
              tool_name: sourceEvent ? sourceEvent.name : null,
              tool_input: sourceEvent ? (sourceEvent.input || {}) : {},
            });
            let resultLine;
            try {
              resultLine = await readLineFromStdin();
            } catch (err) {
              await fatalExit(14, 'NETWORK', `stdin read failed: ${err.message}`, sessionId);
            }
            let confirmation;
            try {
              confirmation = JSON.parse(resultLine);
            } catch {
              confirmation = { result: 'allow' };
            }
            const confirmEvent = sessionTurnBuilder.buildToolConfirmation(
              eventId,
              confirmation.result || 'allow',
              confirmation.deny_message
            );
            await withRetry(() => sessionClient.sendEvents(sessionId, [confirmEvent]), RETRY_POLICY.NETWORK)
              .catch(async (err) => {
                const code = err.code || 'API_5XX';
                await fatalExit(EXIT_CODES[code] || 14, code, err.message, sessionId);
              });
          }
        }

        // Re-enter the SSE stream after sending tool responses
        for await (const resumeItem of sessionSseReader.readStream(sessionId, { onSseEvent, onStuck, stuckThresholdMs })) {
          if (resumeItem.type === 'event') {
            rawEvents.push(resumeItem.event);
          } else if (resumeItem.type === 'complete' || resumeItem.type === 'requires_action') {
            // Handle nested requires_action by breaking — full recursion not needed per spec
            break;
          }
        }
        break;
      }
    }
  } catch (err) {
    const code = err.code || 'API_5XX';
    const exitCode = EXIT_CODES[code] || 14;
    await fatalExit(exitCode, code, err.message, sessionId);
  }

  // 10. Update registry: completed
  const completedAt = new Date().toISOString();
  try {
    await sessionRegistry.update(sessionId, {
      status: 'completed',
      last_active_at: completedAt,
    });
  } catch (err) {
    console.warn(`[session-invoke] registry completion update failed (non-fatal): ${err.message}`);
  }

  // 11. Write episode file
  let episodePath;
  try {
    episodePath = sessionEpisodeWriter.writeEpisode({
      session_id: sessionId,
      epic_id,
      story_id,
      step_id,
      agent_name: agent_role,
      model,
      status: 'completed',
      created_at: createdAt,
      completed_at: completedAt,
      sse_event_count: sseEventCount,
      events: rawEvents,
    });
  } catch (err) {
    console.warn(`[session-invoke] episode write failed (non-fatal): ${err.message}`);
    episodePath = null;
  }

  // 12. Emit success JSON
  emitJson({
    session_id: sessionId,
    status: 'completed',
    episode_path: episodePath,
    sse_event_count: sseEventCount,
  });

  process.exit(0);
}

main().catch(async (err) => {
  const code = err.code || 'API_5XX';
  const exitCode = EXIT_CODES[code] || 1;
  emitJson({ status: 'failed', error_code: code, message: err.message });
  process.exit(exitCode);
});
