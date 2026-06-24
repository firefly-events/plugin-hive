#!/usr/bin/env node
/**
 * hermes-reconciler/epic-bootstrap.mjs — Human "go" entrypoint for Hermes.
 *
 * Sets gate_state=pre_approved + epic_of_record=<handle> on the named epic's
 * cycle-state, admitting it into the autonomous loop. This is the ONLY way an
 * epic enters lights-on operation.
 *
 * HUMAN-ONLY: This file is a standalone CLI binary. It is NOT imported by the
 * reconcile-tick surface. The reconciler imports state.mjs and slack-notify-await.mjs;
 * it never imports epic-bootstrap.mjs. No code path in the tick can call this.
 *
 * Usage:
 *   node epic-bootstrap.mjs --epic <handle> [--cycle-state <path>] [--slack-webhook <url>] [--yes]
 *
 * Options:
 *   --epic <handle>         Epic handle to approve (required, non-empty string)
 *   --cycle-state <path>    Override cycle-state file path (default: .pHive/cycle-state/<handle>.yaml)
 *   --slack-webhook <url>   Slack webhook URL for lights-on notice (default: $HERMES_SLACK_WEBHOOK_URL)
 *   --yes                   Skip interactive confirmation prompt (useful in scripted human workflows)
 *   --dry-run               Print what would be written without writing
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { URL } from 'node:url';
import { fileURLToPath } from 'node:url';

import { writeHermesReconcilerState } from './state.mjs';

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

// ── Cycle-state path resolution ───────────────────────────────────────────────

function resolveCycleStatePath(args, epic) {
  if (typeof args['cycle-state'] === 'string') return args['cycle-state'];
  return path.join(process.cwd(), '.pHive', 'cycle-state', `${epic}.yaml`);
}

// ── Confirmation prompt ───────────────────────────────────────────────────────

function promptConfirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── Slack notice (optional, best-effort) ──────────────────────────────────────

function postSlackNotice(webhookUrl, epicHandle) {
  return new Promise((resolve, reject) => {
    const payload = {
      text: `*Hermes:* Epic \`${epicHandle}\` is now lights-on. gate_state=pre_approved. The autonomous loop will begin on the next tick.`,
    };
    const body = JSON.stringify(payload);
    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      reject(new Error(`Invalid Slack webhook URL: ${webhookUrl}`));
      return;
    }
    // Constrain the target (SSRF guard): https to a Slack host, http only to
    // loopback for test injection. The notice carries epic context.
    {
      const host = parsed.hostname;
      // Node's URL.hostname keeps IPv6 brackets ("[::1]"), so match both forms.
      const isLoopback =
        host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
      if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback)) {
        reject(new Error(`Slack webhook must use https (got ${parsed.protocol}//${host}); http only for loopback.`));
        return;
      }
      if (!(host === 'hooks.slack.com' || host.endsWith('.slack.com') || isLoopback)) {
        reject(new Error(`Slack webhook host not allowed: ${host}. Expected hooks.slack.com (or loopback for tests).`));
        return;
      }
    }
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
          resolve({ statusCode: res.statusCode });
        } else {
          reject(new Error(`Slack webhook returned HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });
    req.setTimeout(10_000, () => {
      req.destroy(new Error('Slack webhook timed out after 10s'));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Validate epic handle ──────────────────────────────────────────────────────

// The epic handle composes a filesystem path (`.pHive/cycle-state/<handle>.yaml`
// in resolveCycleStatePath). Reject path separators and traversal sequences so a
// handle can only ever reference a file inside the intended cycle-state dir.
const EPIC_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,127})$/;

function validateEpicHandle(handle) {
  if (!handle || handle === true) {
    return '--epic is required';
  }
  if (typeof handle !== 'string' || handle.trim() === '') {
    return '--epic must be a non-empty string';
  }
  if (!EPIC_HANDLE_RE.test(handle)) {
    return '--epic must be a slug ([a-z0-9-]) without path separators';
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [, , ...rest] = process.argv;
  const args = parseArgs(rest);

  // Validate epic handle
  const epicError = validateEpicHandle(args.epic);
  if (epicError) {
    process.stderr.write(`Error: ${epicError}\n`);
    process.stderr.write('Usage: node epic-bootstrap.mjs --epic <handle> [--cycle-state <path>] [--slack-webhook <url>] [--yes] [--dry-run]\n');
    process.exit(1);
  }

  const epicHandle = String(args.epic).trim();
  const cycleStatePath = resolveCycleStatePath(args, epicHandle);
  const isDryRun = args['dry-run'] === true;
  const skipConfirm = args['yes'] === true;
  const slackWebhookUrl = typeof args['slack-webhook'] === 'string'
    ? args['slack-webhook']
    : (process.env.HERMES_SLACK_WEBHOOK_URL || null);

  // Echo what will happen
  process.stdout.write('\n');
  process.stdout.write('Hermes Epic Bootstrap\n');
  process.stdout.write('─────────────────────────────────────────────\n');
  process.stdout.write(`  Epic handle   : ${epicHandle}\n`);
  process.stdout.write(`  Cycle-state   : ${cycleStatePath}\n`);
  process.stdout.write(`  Will write    : gate_state=pre_approved, epic_of_record=${epicHandle}\n`);
  if (isDryRun) {
    process.stdout.write(`  Mode          : DRY RUN (no write)\n`);
  }
  if (slackWebhookUrl) {
    process.stdout.write(`  Slack notice  : yes (webhook configured)\n`);
  } else {
    process.stdout.write(`  Slack notice  : no (HERMES_SLACK_WEBHOOK_URL not set)\n`);
  }
  process.stdout.write('─────────────────────────────────────────────\n');
  process.stdout.write('\n');

  // Require explicit confirmation
  if (!skipConfirm && !isDryRun) {
    const answer = await promptConfirm('Confirm? This will arm the autonomous loop for this epic. Type "yes" to proceed: ');
    if (answer !== 'yes') {
      process.stdout.write('Aborted. No state was written.\n');
      process.exit(1);
    }
  }

  if (isDryRun) {
    process.stdout.write('Dry run complete. No state written.\n');
    process.exit(0);
  }

  // Write gate state via the validated write boundary
  try {
    writeHermesReconcilerState(cycleStatePath, {
      gate_state: 'pre_approved',
      epic_of_record: epicHandle,
    });
  } catch (error) {
    process.stderr.write(`Error: Failed to write cycle-state: ${error?.message || String(error)}\n`);
    process.exit(1);
  }

  process.stdout.write(`\nEpic "${epicHandle}" is now pre_approved. The autonomous loop will begin on the next Hermes tick.\n\n`);

  // Optional Slack notice (best-effort; failure is logged but does not fail the bootstrap)
  if (slackWebhookUrl) {
    try {
      await postSlackNotice(slackWebhookUrl, epicHandle);
      process.stdout.write('Slack notice sent.\n');
    } catch (error) {
      process.stderr.write(`Warning: Slack notice failed (state was written successfully): ${error?.message || String(error)}\n`);
    }
  }

  process.exit(0);
}

main();
