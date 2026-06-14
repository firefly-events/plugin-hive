'use strict';

/**
 * GitHub Issues adapter — adds the sandcastle-ops label namespace to issues
 * ALREADY created by the Epic C ABI dispatch (hive/adapters/github/index.ts).
 *
 * Story: s1-github-issues-adapter (sandcastle-ops-layer)
 *
 * Role: LABEL-EXISTING ONLY. This adapter does NOT create issues. Issue
 * creation is owned by Epic C (`createStory` invoked from step 19 of
 * skills/plan/SKILL.md Phase D). This module runs in step 19a, AFTER step 19,
 * and reads each story's `tracker_id` (set by step 19) to look up the
 * already-created issue and add hive:* labels to it. Single source of truth
 * for issue creation = Epic C; the sandcastle layer is purely additive
 * (labels + sweep).
 *
 * tracker_id format (per hive/adapters/github/index.ts header):
 *   "<owner>/<repo>#<number>"   e.g. "firefly-events/plugin-hive#42"
 *
 * Opt-in contract: callers gate on `task_tracking.adapter === "github"`. This
 * module performs no opt-in check itself — it is the caller's job to gate.
 *
 * Label namespace (locked):
 *   hive:ready                  — published, unblocked, available for pickup
 *   hive:in-flight              — claimed by a worker
 *   hive:failed                 — worker failed; needs human review
 *   hive:epic:<epic-id>         — epic membership
 *   hive:story:<story-id>       — story identity (round-trip)
 *   hive:blocked-by:<story-id>  — open dependency; removed on parent close
 *
 * The label prefix ("hive" above) is configurable via
 * task_tracking.label_prefix; defaults to "hive".
 *
 * Idempotency: when a story YAML already has `external_id: <issue#>`, the
 * publish path skips it with reason "already_published" — labels were
 * applied on a prior run. Stories that lack `tracker_id` (because step 19
 * errored for that story, or no_adapter, etc.) are skipped with reason
 * "no_tracker_id". No fallback to create — Epic C is the single creation
 * point.
 *
 * Dependency wiring: depends_on entries in story YAML become
 * `hive:blocked-by:<story-id>` labels. The sweepBlockedByLabels function
 * inspects parent issue states and removes blocked-by labels when parents
 * close, promoting unblocked children to hive:ready.
 *
 * Transport: gh CLI via node:child_process.execFile. No SDK dependency.
 *
 * YAML round-trip: js-yaml is BYO (try/catch import) per the pattern in
 * hive/lib/config.js, session-client.js, session-registry.js,
 * dreaming-replay.js. When unavailable, publishing throws a clear error
 * instructing the user to install it.
 *
 * Test seam: every function accepts an optional `_deps` parameter for DI
 * (execFileFn, readFileFn, writeFileFn, renameFn, yamlLib). Not part of the
 * public API but documented for tests/hive-lib/github-issues-adapter.test.js.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');

let yamlLib = null;
try {
  yamlLib = require('js-yaml');
} catch {
  yamlLib = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_LABEL_PREFIX = 'hive';

function execFileAsync(execFileFn, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileFn(file, args, options || {}, (err, stdout, stderr) => {
      if (err) {
        // Decorate the error with stderr so callers can surface root cause
        // without leaking command args (which may include label names but
        // never tokens — `gh` reads tokens from env or `gh auth token`).
        const decorated = new Error(
          `[github-issues-adapter] gh ${args.join(' ').slice(0, 200)} failed: ` +
          `${err.message}${stderr ? ` — stderr: ${String(stderr).slice(0, 500)}` : ''}`
        );
        decorated.cause = err;
        decorated.stdout = stdout;
        decorated.stderr = stderr;
        return reject(decorated);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.length) {
    throw new TypeError(`[github-issues-adapter] ${field} must be a non-empty string`);
  }
  return value;
}

function getYaml(_deps) {
  const lib = (_deps && _deps.yamlLib) || yamlLib;
  if (!lib) {
    throw new Error(
      '[github-issues-adapter] js-yaml not available — run: npm install --no-save js-yaml'
    );
  }
  return lib;
}

function loadStoryYaml(storyPath, _deps) {
  const readFileFn = (_deps && _deps.readFileFn) || fs.readFileSync;
  const yaml = getYaml(_deps);
  const raw = readFileFn(storyPath, 'utf8');
  return yaml.load(raw);
}

/**
 * Atomic write: tempfile + rename, in the same directory as the destination.
 * Preserves YAML formatting via noRefs + lineWidth 120.
 */
function writeStoryYaml(storyPath, data, _deps) {
  const writeFileFn = (_deps && _deps.writeFileFn) || fs.writeFileSync;
  const renameFn = (_deps && _deps.renameFn) || fs.renameSync;
  const yaml = getYaml(_deps);
  const dir = path.dirname(storyPath);
  const tmp = path.join(dir, `.${path.basename(storyPath)}.tmp-${process.pid}-${Date.now()}`);
  const out = yaml.dump(data, { noRefs: true, lineWidth: 120 });
  writeFileFn(tmp, out, 'utf8');
  renameFn(tmp, storyPath);
}

// Default state dir per Q2 precedence: injected _deps.stateDir (test seam)
// > HIVE_STATE_DIR env > root-config paths.state_dir > `.pHive`. The shared
// resolver lives in the ESM hive/lib/config.js; require(esm) loads it on
// Node >= 22.12, and older Nodes fall back to the legacy env-or-default
// behavior (config tier unavailable there, same as before this change).
function defaultStateDir(_deps) {
  if (_deps && _deps.stateDir) return _deps.stateDir;
  try {
    const { resolveStateDir } = require('../config.js');
    const resolved = resolveStateDir();
    // The resolver canonicalizes to an absolute path; story paths here have
    // always been cwd-relative (callers and the _deps fs seams join/compare
    // them as such), so convert back. With unset config the result is exactly
    // '.pHive'; a configured state dir may yield '.' (state dir == cwd) or a
    // '../'-prefixed path (state dir outside cwd) — both intentional.
    // realpath the cwd so symlinked working dirs (macOS /var -> /private/var)
    // don't derail path.relative against the canonicalized resolver output.
    const rel = path.relative(fs.realpathSync(process.cwd()), resolved);
    return rel === '' ? '.' : rel;
  } catch {
    return process.env.HIVE_STATE_DIR || '.pHive';
  }
}

function resolveStoryPath(epicId, storyId, _deps) {
  const baseDir = defaultStateDir(_deps);
  return path.join(baseDir, 'epics', epicId, 'stories', `${storyId}.yaml`);
}

/**
 * Parse a tracker_id in Epic C format "<owner>/<repo>#<number>" and return
 * the parts. Returns null when the format is unrecognized so callers can
 * skip the story instead of throwing.
 */
function parseTrackerId(trackerId) {
  if (typeof trackerId !== 'string' || !trackerId.length) return null;
  const m = trackerId.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

function buildLabelsForStory(story, opts) {
  const prefix = opts.labelPrefix || DEFAULT_LABEL_PREFIX;
  const labels = [
    `${prefix}:epic:${opts.epicId}`,
    `${prefix}:story:${story.id}`,
  ];
  const deps = Array.isArray(story.depends_on) ? story.depends_on : [];
  if (deps.length === 0) {
    labels.push(`${prefix}:ready`);
  } else {
    for (const dep of deps) {
      labels.push(`${prefix}:blocked-by:${dep}`);
    }
  }
  return labels;
}

function ghRepoArgs(config) {
  const owner = config.github_owner || config.team_value;
  const repo = config.github_repo || config.project_value;
  requireString(owner, 'task_tracking.github_owner (or team_value)');
  requireString(repo, 'task_tracking.github_repo (or project_value)');
  return { owner, repo, flag: `${owner}/${repo}` };
}

// ---------------------------------------------------------------------------
// Public: publishStoriesToIssues
// ---------------------------------------------------------------------------

/**
 * Apply the sandcastle-ops label namespace to issues already created by the
 * Epic C ABI dispatch (step 19 of /plan Phase D). This function does NOT
 * create issues — it only adds hive:* labels to issues created upstream.
 *
 * For each story:
 *   1. Read its `tracker_id` (format "<owner>/<repo>#<number>") from the
 *      story YAML (set by step 19's `dispatch.invoke("createStory", ...)`).
 *   2. If `tracker_id` is missing, skip with reason "no_tracker_id" — Epic C
 *      is the single creation point; the sandcastle layer never creates.
 *   3. If `external_id` is already set, skip with reason "already_published"
 *      — labels were applied on a prior run.
 *   4. Otherwise call `gh issue edit <n> --add-label ...` with the locked
 *      hive:* label set (ready/epic/story/blocked-by:*).
 *   5. Write `external_id: <number>` (bare integer) back into the story
 *      YAML so the worker can query `gh issue list --label hive:ready` and
 *      cross-reference without parsing the slash-encoded tracker_id form.
 *
 * @param {object}   opts
 * @param {string}   opts.epicId
 * @param {string[]} opts.storyIds
 * @param {object}   opts.config        task_tracking config block
 * @param {boolean} [opts.dryRun=false] if true, no gh calls; returns planned actions
 * @param {object}  [opts._deps]        test seam
 * @returns {Promise<{ labeled: Array, skipped: Array, errors: Array }>}
 */
async function publishStoriesToIssues(opts) {
  const epicId = requireString(opts && opts.epicId, 'epicId');
  const storyIds = Array.isArray(opts && opts.storyIds) ? opts.storyIds : [];
  const config = (opts && opts.config) || {};
  const dryRun = !!(opts && opts.dryRun);
  const _deps = (opts && opts._deps) || {};
  const execFileFn = _deps.execFileFn || execFile;

  const labeled = [];
  const skipped = [];
  const errors = [];

  if (storyIds.length === 0) {
    return { labeled, skipped, errors };
  }

  const labelPrefix = config.label_prefix || DEFAULT_LABEL_PREFIX;
  // Repo enforcement is opt-in: only checked when config provides
  // task_tracking.github_owner (or team_value) + github_repo (or project_value).
  // Without those, the adapter trusts the tracker_id owner/repo directly.
  let allowedRepo = null;
  try {
    allowedRepo = ghRepoArgs(config);
  } catch {
    allowedRepo = null;
  }

  for (const storyId of storyIds) {
    const storyPath = resolveStoryPath(epicId, storyId, _deps);
    let story;
    try {
      story = loadStoryYaml(storyPath, _deps);
    } catch (err) {
      errors.push({ id: storyId, error: `load_failed: ${err.message}` });
      continue;
    }
    if (!story || typeof story !== 'object') {
      errors.push({ id: storyId, error: 'load_failed: empty or invalid YAML' });
      continue;
    }

    if (story.external_id) {
      skipped.push({
        id: storyId,
        reason: 'already_published',
        issue_number: story.external_id,
      });
      continue;
    }

    const parsed = parseTrackerId(story.tracker_id);
    if (!parsed) {
      // Step 19 didn't (or couldn't) create an issue for this story. The
      // sandcastle layer never creates — skip and let humans investigate.
      skipped.push({ id: storyId, reason: 'no_tracker_id' });
      continue;
    }

    if (allowedRepo && (parsed.owner !== allowedRepo.owner || parsed.repo !== allowedRepo.repo)) {
      skipped.push({
        id: storyId,
        reason: 'unexpected_repo',
        tracker_repo: `${parsed.owner}/${parsed.repo}`,
        allowed_repo: allowedRepo.flag,
      });
      continue;
    }

    const labels = buildLabelsForStory(story, { epicId, labelPrefix });
    const repoFlag = `${parsed.owner}/${parsed.repo}`;

    if (dryRun) {
      labeled.push({
        id: storyId,
        issue_number: parsed.number,
        dryRun: true,
        labels,
        repo: repoFlag,
      });
      continue;
    }

    // `gh issue edit <n> --add-label <l>` is idempotent — adding a label the
    // issue already has is a no-op (GitHub dedupes labels server-side).
    const args = ['issue', 'edit', String(parsed.number), '--repo', repoFlag];
    for (const label of labels) {
      args.push('--add-label', label);
    }

    try {
      await execFileAsync(execFileFn, 'gh', args, {});
    } catch (err) {
      errors.push({ id: storyId, error: String(err.message).slice(0, 500) });
      continue;
    }

    // Persist external_id (bare int) back into the story YAML. The worker
    // prompt queries `gh issue list --label hive:ready` and matches against
    // `hive:story:<id>` to round-trip back to this YAML.
    story.external_id = parsed.number;
    try {
      writeStoryYaml(storyPath, story, _deps);
    } catch (err) {
      errors.push({
        id: storyId,
        error: `issue_${parsed.number}_labeled_but_yaml_write_failed: ${err.message}`,
      });
      continue;
    }

    labeled.push({ id: storyId, issue_number: parsed.number });
  }

  return { labeled, skipped, errors };
}

// ---------------------------------------------------------------------------
// Public: sweepBlockedByLabels
// ---------------------------------------------------------------------------

/**
 * Inspect open issues in the epic. For each issue with a
 * hive:blocked-by:<parent-story-id> label, look up the parent story's
 * external_id (issue number) and check its state. If the parent issue is
 * closed, remove the blocked-by label from the child. If the child has no
 * other blocked-by labels after removal, add hive:ready.
 *
 * @param {object} opts
 * @param {string} opts.epicId
 * @param {object} opts.config       task_tracking config
 * @param {object} [opts._deps]      test seam
 * @returns {Promise<{ unblocked: Array<number> }>}
 */
async function sweepBlockedByLabels(opts) {
  const epicId = requireString(opts && opts.epicId, 'epicId');
  const config = (opts && opts.config) || {};
  const _deps = (opts && opts._deps) || {};
  const execFileFn = _deps.execFileFn || execFile;

  const repo = ghRepoArgs(config);
  const labelPrefix = config.label_prefix || DEFAULT_LABEL_PREFIX;
  const epicLabel = `${labelPrefix}:epic:${epicId}`;
  const blockedByPrefix = `${labelPrefix}:blocked-by:`;
  const readyLabel = `${labelPrefix}:ready`;

  // List open issues in the epic.
  const listArgs = [
    'issue', 'list',
    '--repo', repo.flag,
    '--label', epicLabel,
    '--state', 'open',
    '--json', 'number,labels',
    '--limit', '500',
  ];
  const { stdout: openListJson } = await execFileAsync(execFileFn, 'gh', listArgs, {});
  let openIssues;
  try {
    openIssues = JSON.parse(openListJson || '[]');
  } catch (err) {
    throw new Error(`[github-issues-adapter] sweep: failed to parse gh issue list output: ${err.message}`);
  }

  // Cache parent state lookups so we don't re-query the same parent.
  const parentStateCache = new Map();

  const unblocked = [];

  for (const issue of openIssues) {
    const labels = (issue.labels || []).map((l) => l.name || l);
    const blockedByLabels = labels.filter((n) => n.startsWith(blockedByPrefix));
    if (blockedByLabels.length === 0) continue;

    const labelsToRemove = [];
    for (const blockedLabel of blockedByLabels) {
      const parentStoryId = blockedLabel.slice(blockedByPrefix.length);
      let parentState = parentStateCache.get(parentStoryId);
      if (!parentState) {
        // Find the parent issue by hive:story:<id> label, scoped to the
        // current epic to avoid story-ID collisions across epics.
        const findArgs = [
          'issue', 'list',
          '--repo', repo.flag,
          '--label', `${labelPrefix}:story:${parentStoryId}`,
          '--label', epicLabel,
          '--state', 'all',
          '--json', 'number,state',
          '--limit', '5',
        ];
        try {
          const { stdout } = await execFileAsync(execFileFn, 'gh', findArgs, {});
          const matches = JSON.parse(stdout || '[]');
          parentState = matches[0] ? String(matches[0].state).toLowerCase() : 'unknown';
        } catch {
          parentState = 'unknown';
        }
        parentStateCache.set(parentStoryId, parentState);
      }
      if (parentState === 'closed') {
        labelsToRemove.push(blockedLabel);
      }
    }

    if (labelsToRemove.length === 0) continue;

    // Edit the child: remove the closed-parent blocked-by labels. If that
    // leaves no remaining blocked-by labels, add hive:ready.
    const remainingBlocked = blockedByLabels.length - labelsToRemove.length;
    const editArgs = ['issue', 'edit', String(issue.number), '--repo', repo.flag];
    for (const l of labelsToRemove) {
      editArgs.push('--remove-label', l);
    }
    if (remainingBlocked === 0) {
      editArgs.push('--add-label', readyLabel);
    }
    try {
      await execFileAsync(execFileFn, 'gh', editArgs, {});
      unblocked.push(issue.number);
    } catch (err) {
      // Non-fatal: log via error path. Continue sweeping.
      // (Caller can inspect this via stderr; module returns successful sweeps.)
      const _ = err;
    }
  }

  return { unblocked };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  publishStoriesToIssues,
  sweepBlockedByLabels,
  // Exported for testing only — not stable public API.
  _internal: {
    buildLabelsForStory,
    parseTrackerId,
    resolveStoryPath,
    DEFAULT_LABEL_PREFIX,
  },
};
