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
import path from 'node:path';
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

const ACTION_LABELS = { approve: 'Approve', continue: 'Continue', revise: 'Revise', reject: 'Reject' };

/**
 * Encode gate action context into a Slack button value string (JSON).
 * Format: {"a":<action>,"e":<epicHandle>,"s":<storyId>}
 * Parse back with parseGateAction().
 */
function encodeGateAction(action, epicHandle, storyId) {
  return JSON.stringify({ a: action, e: epicHandle, s: storyId ?? null });
}

/**
 * Build a Block Kit actions block containing the gate resolution buttons.
 * @param {string[]} actions  Ordered list of action strings.
 * @param {string} epicHandle
 * @param {string|null} storyId
 */
function buildGateActionsBlock(actions, epicHandle, storyId) {
  return {
    type: 'actions',
    elements: actions.map((action) => {
      const el = {
        type: 'button',
        text: { type: 'plain_text', text: ACTION_LABELS[action] ?? action, emoji: false },
        action_id: 'hive_gate_resolve',
        value: encodeGateAction(action, epicHandle, storyId),
      };
      if (action === 'approve') el.style = 'primary';
      if (action === 'reject') el.style = 'danger';
      return el;
    }),
  };
}

/**
 * Build a Slack message payload for a review_terminal verdict.
 * Returns { text, blocks } — text is a plain-text fallback; blocks is Block Kit.
 * Follows standup-slack-format.md conventions: no ANSI, markdown only, ##/### headings, - lists.
 */
export function buildVerdictMessage({ epicHandle, storyId, verdict, episodeSummary, diff }) {
  const normalizedVerdict = verdict?.replace('_', '-').toLowerCase() ?? 'unknown';
  const decisionBlock = normalizedVerdict === 'needs-revision'
    ? 'Reply with one of:\n- `approve` — accept the review verdict as-is and mark done\n- `revise` — send the story back for a new implementation attempt\n- `reject` — halt this epic permanently'
    : 'Reply with one of:\n- `approve` (or `continue`) — advance to the next story\n- `revise` — send back for revision\n- `reject` — halt this epic permanently';

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

  // Block Kit representation — buttons encode the gate action for the Studio receiver.
  const actions = normalizedVerdict === 'needs-revision'
    ? ['approve', 'revise', 'reject']
    : ['approve', 'continue', 'revise', 'reject'];

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `Review Verdict — ${normalizedVerdict.toUpperCase()}`, emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Epic:* \`${mrkdwnInline(epicHandle)}\`` },
        { type: 'mrkdwn', text: `*Story:* \`${mrkdwnInline(storyId)}\`` },
        { type: 'mrkdwn', text: `*Verdict:* \`${normalizedVerdict}\`` },
      ],
    },
  ];

  if (episodeSummary) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Episode Summary*\n${mrkdwnInline(episodeSummary.trim())}` },
    });
  }

  if (diff) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Diff*\n\`\`\`\n${fenceSafe(diff.trim())}\n\`\`\`` },
    });
  }

  blocks.push(buildGateActionsBlock(actions, epicHandle, storyId));

  return { text, blocks };
}

/**
 * Build a Slack message payload for an error condition (dispatch failure, daemon down, etc.).
 * Returns { text, blocks } — text is a plain-text fallback; blocks is Block Kit.
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

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Hermes Error — Action Required', emoji: true },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Epic:* \`${mrkdwnInline(epicHandle)}\`` },
        ...(storyId ? [{ type: 'mrkdwn', text: `*Story:* \`${mrkdwnInline(storyId)}\`` }] : []),
        { type: 'mrkdwn', text: `*Error:* \`${mrkdwnInline(errorKind ?? 'unknown_error')}\`` },
      ],
    },
  ];

  if (details) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Details*\n\`\`\`\n${fenceSafe(String(details).trim().slice(0, 1500))}\n\`\`\``,
      },
    });
  }

  blocks.push(buildGateActionsBlock(['continue', 'reject'], epicHandle, storyId));

  return { text, blocks };
}

// ── Gate action encoding ──────────────────────────────────────────────────────

/**
 * Parse a Slack button value produced by buildVerdictMessage / buildErrorMessage
 * back into { action, epicHandle, storyId }.
 *
 * Throws on malformed input so the Studio receiver can reject bad payloads early.
 *
 * @param {string} buttonValue  The `value` field from a Slack interaction payload action.
 * @returns {{ action: string, epicHandle: string, storyId: string|null }}
 */
export function parseGateAction(buttonValue) {
  let parsed;
  try {
    parsed = JSON.parse(buttonValue);
  } catch {
    throw new Error(`parseGateAction: invalid button value (expected JSON): ${buttonValue}`);
  }
  const { a: action, e: epicHandle, s: storyId } = parsed ?? {};
  if (!action || typeof action !== 'string') {
    throw new Error(`parseGateAction: missing or invalid "a" (action) in value: ${buttonValue}`);
  }
  if (!epicHandle || typeof epicHandle !== 'string') {
    throw new Error(`parseGateAction: missing or invalid "e" (epicHandle) in value: ${buttonValue}`);
  }
  return { action, epicHandle, storyId: (storyId && typeof storyId === 'string') ? storyId : null };
}

// ── resolveGate invoker ───────────────────────────────────────────────────────

/**
 * Thin entrypoint for the Studio HTTP receiver: resolves the cycle-state path
 * from epicHandle and delegates to resolveGate().
 *
 * The Studio receiver verifies the Slack request signature BEFORE calling this.
 * This function owns only: path resolution + resolveGate delegation.
 *
 * @param {{ epicHandle: string, storyId?: string|null, action: string }} params
 * @param {{ cycleStateDirPath?: string }} [opts]  Overrides HERMES_CYCLE_STATE_DIR env var.
 * @returns {{ resolved: true, gate_state: string, action: string, [key: string]: unknown }}
 */
export function resolveGateInvoker({ epicHandle, storyId, action }, { cycleStateDirPath } = {}) {
  const dir = cycleStateDirPath ?? process.env.HERMES_CYCLE_STATE_DIR;
  if (!dir) {
    throw new Error(
      'resolveGateInvoker: cycleStateDirPath not provided and HERMES_CYCLE_STATE_DIR is not set',
    );
  }
  if (!epicHandle || typeof epicHandle !== 'string') {
    throw new Error('resolveGateInvoker: epicHandle must be a non-empty string');
  }
  const cycleStatePath = path.join(dir, `${epicHandle}.yaml`);
  return resolveGate(cycleStatePath, { storyId: storyId ?? undefined, action });
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
