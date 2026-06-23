/**
 * hermes-reconciler/slack-notify-await.mjs — Slack notify-and-await human-gate transport.
 *
 * Surface-verdict hook for reconcile-tick. On review_terminal or error conditions:
 *   1. Latches gate_state to 'review_awaiting_human' FIRST (fail-safe — gate is halted even if Slack fails).
 *   2. Posts a Slack message with context + decision needed.
 *   3. Returns { halted: true, gate_state: 'review_awaiting_human' }.
 *
 * Human response resolves the gate via resolveGate():
 *   approve / continue → gate_state: pre_approved
 *   reject             → gate_state: rejected
 *   revise             → gate_state: pre_approved, story rolled back to dispatched_impl, attempt++
 *
 * Slack webhook URL from opts.slackWebhookUrl or HERMES_SLACK_WEBHOOK_URL env var.
 * Slack-unreachable path: gate stays review_awaiting_human + error thrown (tick halts visibly; never auto-advance).
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { readHermesReconcilerState, writeHermesReconcilerState } from './state.mjs';

// ── Slack HTTP ────────────────────────────────────────────────────────────────

function postSlack(webhookUrl, payload, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(webhookUrl);
    const transport = parsed.protocol === 'http:' ? http : https;
    const defaultPort = parsed.protocol === 'http:' ? 80 : 443;
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + (parsed.search || ''),
      port: parsed.port || defaultPort,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`Slack webhook returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Slack webhook timed out after ${timeoutMs}ms`));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Message builders ──────────────────────────────────────────────────────────

// Inline-span safe: neutralize backticks (would close a `...` span) and Slack's
// &,<,> specials (mention/link syntax) so interpolated context cannot break the
// formatting or inject misleading visible content into the human gate prompt.
function mrkdwnInline(v) {
  return String(v)
    .replace(/`/g, 'ʼ') // modifier-letter apostrophe — visually similar, not a span delimiter
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Fence-safe: a ``` run inside content would close the surrounding code fence.
// Break only triple-backtick runs (single backticks are fine inside a fence).
function fenceSafe(v) {
  return String(v).replace(/`{3,}/g, (m) => 'ʼ'.repeat(m.length));
}

/**
 * Build a Slack message payload for a review_terminal verdict.
 * Follows standup-slack-format.md conventions: no ANSI, markdown only, ##/### headings, - lists.
 */
export function buildVerdictMessage({ epicHandle, storyId, verdict, episodeSummary, diff }) {
  const normalizedVerdict = verdict?.replace('_', '-').toLowerCase() ?? 'unknown';
  const decisionBlock = normalizedVerdict === 'needs-revision'
    ? 'Reply with one of:\n- `approve` — accept the review verdict as-is and mark done\n- `revise` — send the story back for a new implementation attempt\n- `reject` — halt this epic permanently'
    : 'Reply with one of:\n- `approve` — advance to the next story\n- `revise` — send back for revision\n- `reject` — halt this epic permanently';

  const summarySection = episodeSummary
    ? `\n### Episode Summary\n${mrkdwnInline(episodeSummary.trim())}`
    : '';

  const diffSection = diff
    ? `\n### Diff\n\`\`\`\n${fenceSafe(diff.trim())}\n\`\`\``
    : '';

  const text = [
    `## Review Verdict — ${normalizedVerdict.toUpperCase()}`,
    ``,
    `- Epic: \`${mrkdwnInline(epicHandle)}\``,
    `- Story: \`${mrkdwnInline(storyId)}\``,
    `- Verdict: \`${normalizedVerdict}\``,
    summarySection,
    diffSection,
    ``,
    `### Decision Required`,
    decisionBlock,
  ].join('\n');

  return { text };
}

/**
 * Build a Slack message payload for an error condition (dispatch failure, daemon down, etc.).
 */
export function buildErrorMessage({ epicHandle, storyId, errorKind, details }) {
  const storyLine = storyId ? `\n- Story: \`${mrkdwnInline(storyId)}\`` : '';
  const detailsSection = details
    ? `\n### Details\n\`\`\`\n${fenceSafe(String(details).trim().slice(0, 1500))}\n\`\`\``
    : '';

  const text = [
    `## Hermes Error — Action Required`,
    ``,
    `- Epic: \`${mrkdwnInline(epicHandle)}\`${storyLine}`,
    `- Error: \`${mrkdwnInline(errorKind ?? 'unknown_error')}\``,
    detailsSection,
    ``,
    `### Decision Required`,
    `Reply with one of:`,
    `- \`continue\` — acknowledge and resume from current state`,
    `- \`reject\` — halt this epic permanently`,
  ].join('\n');

  return { text };
}

// ── Hook: surface verdict ─────────────────────────────────────────────────────

/**
 * Called by reconcile-tick when review_terminal is reached.
 *
 * Writes gate_state: 'review_awaiting_human' BEFORE attempting Slack post.
 * On Slack failure the gate remains review_awaiting_human and the error propagates — tick halts.
 * Never auto-advances the gate.
 *
 * @param {string} cycleStatePath  Absolute path to the cycle-state YAML file.
 * @param {{ epicHandle: string, storyId: string, verdict: string, episodeSummary?: string, diff?: string }} context
 * @param {{ slackWebhookUrl?: string }} [opts]
 * @returns {Promise<{ halted: true, gate_state: 'review_awaiting_human' }>}
 */
export async function surfaceVerdictHook(cycleStatePath, context, opts = {}) {
  // Step 1 — latch gate FIRST (fail-safe)
  writeHermesReconcilerState(cycleStatePath, { gate_state: 'review_awaiting_human' });

  // Step 2 — post to Slack (failure halts tick; gate already latched)
  const webhookUrl = opts.slackWebhookUrl ?? process.env.HERMES_SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      'Slack notify-await: HERMES_SLACK_WEBHOOK_URL is not configured. ' +
      'gate_state is now "review_awaiting_human" — tick is halted. Configure the webhook and retry.',
    );
  }

  const message = buildVerdictMessage(context);
  await postSlack(webhookUrl, message);

  return { halted: true, gate_state: 'review_awaiting_human' };
}

// ── Hook: surface error ───────────────────────────────────────────────────────

/**
 * Called by reconcile-tick when an error condition occurs (dispatch failure, daemon down, etc.).
 * Same fail-safe contract as surfaceVerdictHook.
 *
 * @param {string} cycleStatePath
 * @param {{ epicHandle: string, storyId?: string, errorKind: string, details?: string }} context
 * @param {{ slackWebhookUrl?: string }} [opts]
 * @returns {Promise<{ halted: true, gate_state: 'review_awaiting_human' }>}
 */
export async function surfaceErrorHook(cycleStatePath, context, opts = {}) {
  // Step 1 — latch gate FIRST (fail-safe)
  writeHermesReconcilerState(cycleStatePath, { gate_state: 'review_awaiting_human' });

  // Step 2 — post to Slack
  const webhookUrl = opts.slackWebhookUrl ?? process.env.HERMES_SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error(
      'Slack notify-await: HERMES_SLACK_WEBHOOK_URL is not configured. ' +
      'gate_state is now "review_awaiting_human" — tick is halted. Configure the webhook and retry.',
    );
  }

  const message = buildErrorMessage(context);
  await postSlack(webhookUrl, message);

  return { halted: true, gate_state: 'review_awaiting_human' };
}

// ── Gate resolution ───────────────────────────────────────────────────────────

const VALID_ACTIONS = new Set(['approve', 'continue', 'reject', 'revise']);

/**
 * Resolve the review_awaiting_human gate based on a human Slack action.
 *
 * approve / continue  → gate_state: pre_approved  (tick resumes)
 * reject              → gate_state: rejected       (epic halted permanently)
 * revise              → gate_state: pre_approved   (tick resumes; story rolls back to
 *                       dispatched_impl with attempt++ so reconcile-tick re-dispatches impl)
 *
 * @param {string} cycleStatePath
 * @param {{ storyId?: string, action: 'approve'|'continue'|'reject'|'revise' }} params
 * @returns {{ resolved: true, gate_state: string, action: string }}
 */
export function resolveGate(cycleStatePath, { storyId, action }) {
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(`resolveGate: unknown action "${action}". Valid: approve, continue, reject, revise.`);
  }

  // Precondition: only a gate that is actually awaiting a human may be resolved.
  // Without this, a stale or misdirected Slack action could transition from
  // null / pre_approved / finalized / rejected straight to pre_approved —
  // resuming a terminated epic or re-approving one that never halted for review.
  const current = readHermesReconcilerState(cycleStatePath);
  if (current.gate_state !== 'review_awaiting_human') {
    throw new Error(
      `resolveGate: gate_state is ${JSON.stringify(current.gate_state)}, not "review_awaiting_human" — ` +
      'nothing is awaiting human resolution. Refusing to transition.',
    );
  }

  if (action === 'reject') {
    writeHermesReconcilerState(cycleStatePath, { gate_state: 'rejected' });
    return { resolved: true, gate_state: 'rejected', action };
  }

  if (action === 'revise') {
    if (!storyId) {
      throw new Error('resolveGate: storyId is required for action "revise"');
    }
    if (!current.stories || !(storyId in current.stories)) {
      throw new Error(
        `resolveGate: story "${storyId}" not found in reconciler state — refusing to revise an unknown story.`,
      );
    }
    const currentStory = current.stories[storyId] ?? {};
    const newAttempt = (currentStory.attempt ?? 0) + 1;

    writeHermesReconcilerState(cycleStatePath, {
      gate_state: 'pre_approved',
      in_flight_story_id: null,
      in_flight_task_id: null,
      dispatched_at: null,
      stories: {
        [storyId]: {
          phase_position: 'dispatched_impl',
          attempt: newAttempt,
        },
      },
    });
    return { resolved: true, gate_state: 'pre_approved', action: 'revise', attempt: newAttempt };
  }

  if (action === 'approve') {
    // Approve = accept the review verdict as-is and mark the surfaced story done.
    // (Under the passed-auto-advance model, the human gate is only reached for a
    // non-passing/unverified verdict; approving it completes that story.)
    const storyDone = current.in_flight_story_id ?? null;
    const patch = {
      gate_state: 'pre_approved',
      in_flight_story_id: null,
      in_flight_task_id: null,
      dispatched_at: null,
    };
    if (storyDone) {
      patch.stories = { [storyDone]: { phase_position: 'done' } };
    }
    writeHermesReconcilerState(cycleStatePath, patch);
    return { resolved: true, gate_state: 'pre_approved', action, story_done: storyDone };
  }

  // continue — acknowledge an error and resume from the current state; no story
  // is completed (the error hook, not a verdict, surfaced this gate).
  writeHermesReconcilerState(cycleStatePath, { gate_state: 'pre_approved' });
  return { resolved: true, gate_state: 'pre_approved', action };
}
