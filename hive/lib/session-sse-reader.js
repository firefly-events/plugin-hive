/**
 * SSE Reader
 *
 * Wraps session-client.streamEvents() with:
 *   - stuck-timer: fires if no SSE event arrives within stuckThresholdMs
 *   - completion detection: session.status_idle + end_turn
 *   - requires_action detection: session.status_idle + requires_action
 *
 * The caller receives events through an async generator. The stuck-timer
 * calls process.exit(15) directly (as specified) when triggered.
 */

'use strict';

const { streamEvents } = require('./session-client');

const DEFAULT_STUCK_THRESHOLD_MS = 90 * 1000; // 90 seconds

/**
 * Stream and classify SSE events for a session.
 *
 * Yields objects of shape:
 *   { type: 'event', event: <raw sse event> }
 *   { type: 'complete', stopReason: <stop_reason object> }
 *   { type: 'requires_action', stopReason: <stop_reason object> }
 *
 * The generator returns after yielding 'complete' or 'requires_action'.
 * If no event arrives within stuckThresholdMs, calls onStuck() (defaults to exit 15).
 *
 * @param {string} sessionId
 * @param {Object} [options]
 * @param {number} [options.stuckThresholdMs=90000] - ms without event before stuck fires
 * @param {Function} [options.onStuck] - called when stuck; defaults to process.exit(15)
 * @param {Function} [options.onSseEvent] - called on every raw SSE event (for registry updates)
 */
async function* readStream(sessionId, options = {}) {
  const {
    stuckThresholdMs = DEFAULT_STUCK_THRESHOLD_MS,
    onStuck = () => process.exit(15),
    onSseEvent = null,
  } = options;

  let stuckTimer = null;

  const resetStuckTimer = () => {
    if (stuckTimer) clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      console.error(`[session-sse-reader] stuck: no SSE event for ${stuckThresholdMs}ms on session ${sessionId}`);
      onStuck();
    }, stuckThresholdMs);
  };

  const clearStuckTimer = () => {
    if (stuckTimer) {
      clearTimeout(stuckTimer);
      stuckTimer = null;
    }
  };

  try {
    resetStuckTimer();

    for await (const event of streamEvents(sessionId)) {
      resetStuckTimer();

      if (onSseEvent) {
        try { onSseEvent(event); } catch { /* best-effort */ }
      }

      yield { type: 'event', event };

      // Detect completion or requires_action
      if (event.type === 'session.status_idle') {
        const stopReason = event.stop_reason || {};
        if (stopReason.type === 'end_turn') {
          clearStuckTimer();
          yield { type: 'complete', stopReason };
          return;
        }
        if (stopReason.type === 'requires_action') {
          clearStuckTimer();
          yield { type: 'requires_action', stopReason };
          return;
        }
      }
    }

    // Stream ended without a terminal event — treat as complete
    clearStuckTimer();
  } catch (err) {
    clearStuckTimer();
    throw err;
  }
}

module.exports = { readStream };
