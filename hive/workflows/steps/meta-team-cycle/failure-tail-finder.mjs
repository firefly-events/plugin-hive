/**
 * CI / sandcastle / multica failure tail finder for step-02 analysis.
 *
 * Pure-function helpers over already-fetched GH workflow run records and
 * (optionally) Multica issue records flagged for rework. The caller (the
 * step-02 researcher persona) gathers data via `gh run list` and
 * `multica issue list` and passes plain arrays. No fetch, no shell, no
 * Date.now() — the clock is injected via `nowIso`.
 *
 * Two failure signals are surfaced:
 *
 *   1. **Workflow-run failures**: when a named workflow (sandcastle bridge,
 *      meta-team-cycle, CI, etc) fails ≥ `minRecurrence` times within the
 *      recency window, emit a `CI_FAILURE_PATTERN` finding so the meta-team
 *      can propose a fix at the workflow level rather than only patching
 *      the symptom on individual runs.
 *   2. **Stuck rework-labeled issues**: open Multica issues carrying a
 *      `hive:needs-rework` (or equivalent rework) label aged > stuckDays
 *      emit a `STUCK_REWORK_ISSUE` finding — the work was kicked back but
 *      nobody is reworking it.
 *
 * Per step-02-analysis.md §TASK SEQUENCE, both finding kinds enter the
 * standard findings list — the AND-of-empty routing gate treats them as
 * ordinary signal.
 */

'use strict';

// ---------------------------------------------------------------------------
// Local daysBetween (kept inline to avoid cross-finder PR stacking).
// ---------------------------------------------------------------------------

export function daysBetween(isoEarlier, nowIso) {
  const earlier = Date.parse(isoEarlier);
  const now = Date.parse(nowIso);
  if (Number.isNaN(earlier) || Number.isNaN(now)) return null;
  return (now - earlier) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Workflow-run failure clustering
// ---------------------------------------------------------------------------

const FAILURE_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);

/**
 * Group GH workflow runs by `workflowName` and return per-workflow failure
 * counts within `windowDays`. Only terminal-failure conclusions count
 * (success and skipped are excluded).
 */
export function tallyRunFailures(runs, nowIso, opts = {}) {
  const windowDays = opts.windowDays ?? 7;
  const tally = new Map();
  if (!Array.isArray(runs)) return tally;
  for (const run of runs) {
    if (!run || typeof run !== 'object') continue;
    if (!FAILURE_CONCLUSIONS.has(run.conclusion)) continue;
    const created = run.createdAt;
    if (typeof created !== 'string') continue;
    const ageDays = daysBetween(created, nowIso);
    if (ageDays == null || ageDays < 0 || ageDays > windowDays) continue;
    const wf = run.workflowName ?? run.name;
    if (!wf || typeof wf !== 'string') continue;
    let entry = tally.get(wf);
    if (!entry) {
      entry = { count: 0, runs: [], oldestAgeDays: 0 };
      tally.set(wf, entry);
    }
    entry.count += 1;
    entry.runs.push({
      runId: run.runId ?? run.databaseId ?? null,
      createdAt: created,
      conclusion: run.conclusion,
      htmlUrl: run.htmlUrl ?? null,
    });
    if (ageDays > entry.oldestAgeDays) entry.oldestAgeDays = ageDays;
  }
  return tally;
}

/**
 * Emit findings from a workflow-failure tally. A workflow becomes a
 * finding when its failure count meets `minRecurrence`. Severity: `high`
 * at 4+ failures, `medium` at 2-3.
 */
export function emitRunFailureFindings(tally, opts = {}) {
  const minRecurrence = opts.minRecurrence ?? 2;
  const windowDays = opts.windowDays ?? 7;
  const findings = [];
  for (const [workflowName, entry] of tally.entries()) {
    if (entry.count < minRecurrence) continue;
    const severity = entry.count >= 4 ? 'high' : 'medium';
    findings.push({
      id: `finding-ci-failure-${slugify(workflowName)}`,
      category: 'CI_FAILURE_PATTERN',
      severity,
      location: `workflow:${workflowName}`,
      description: `Workflow "${workflowName}" failed ${entry.count}× in last ${windowDays}d`,
      evidence: {
        workflow_name: workflowName,
        failure_count: entry.count,
        window_days: windowDays,
        oldest_failure_days_ago: Math.floor(entry.oldestAgeDays),
        recent_runs: entry.runs.slice(0, 5),
      },
    });
  }
  findings.sort((a, b) => {
    const sev = a.severity === 'high' ? 0 : 1;
    const otherSev = b.severity === 'high' ? 0 : 1;
    if (sev !== otherSev) return sev - otherSev;
    return b.evidence.failure_count - a.evidence.failure_count;
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Stuck rework-labeled issues
// ---------------------------------------------------------------------------

const REWORK_LABEL_PATTERNS = [/needs[-_]rework/i, /hive:needs[-_]rework/i, /^rework$/i];

/**
 * Filter open Multica/GH issues that carry a rework label and have been
 * open longer than `stuckDays`. Returns one finding per stuck issue.
 *
 * Input shape per issue: `{ id, title, state, labels, createdAt, updatedAt, htmlUrl }`.
 */
export function findStuckReworkIssues(issues, nowIso, opts = {}) {
  if (!Array.isArray(issues)) return [];
  const stuckDays = opts.stuckDays ?? 3;
  const findings = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    if (issue.state && issue.state !== 'open' && issue.state !== 'OPEN') continue;
    const labels = Array.isArray(issue.labels) ? issue.labels : [];
    const labelNames = labels.map((l) => (typeof l === 'string' ? l : l?.name ?? '')).filter(Boolean);
    const hasReworkLabel = labelNames.some((name) =>
      REWORK_LABEL_PATTERNS.some((re) => re.test(name)),
    );
    if (!hasReworkLabel) continue;

    const anchor = issue.updatedAt ?? issue.createdAt;
    if (typeof anchor !== 'string') continue;
    const ageDays = daysBetween(anchor, nowIso);
    if (ageDays == null || ageDays < stuckDays) continue;

    const ageRounded = Math.floor(ageDays);
    findings.push({
      id: `finding-stuck-rework-${issue.id ?? slugify(issue.title ?? 'unknown')}`,
      category: 'STUCK_REWORK_ISSUE',
      severity: ageRounded > 7 ? 'high' : 'medium',
      location: `issue:${issue.id ?? '?'}`,
      description: `Rework-labeled issue ${issue.id ?? ''} "${(issue.title ?? '').slice(0, 80)}" idle ${ageRounded}d`,
      evidence: {
        issue_id: issue.id ?? null,
        title: issue.title ?? null,
        labels: labelNames,
        age_days: ageRounded,
        html_url: issue.htmlUrl ?? null,
      },
    });
  }
  findings.sort((a, b) => {
    const sev = a.severity === 'high' ? 0 : 1;
    const otherSev = b.severity === 'high' ? 0 : 1;
    if (sev !== otherSev) return sev - otherSev;
    return (b.evidence.age_days ?? 0) - (a.evidence.age_days ?? 0);
  });
  return findings;
}

// ---------------------------------------------------------------------------
// Convenience: build both finding kinds in one call
// ---------------------------------------------------------------------------

/**
 * One-call convenience for the step-02 caller. Returns a combined finding
 * list (CI failures + stuck rework issues).
 *
 * @param {object} sources
 * @param {Array}  sources.runs   - GH workflow runs (see tallyRunFailures shape)
 * @param {Array}  sources.issues - Multica/GH issues (see findStuckReworkIssues shape)
 * @param {object} opts
 * @param {string} opts.nowIso              - required
 * @param {number} [opts.windowDays=7]
 * @param {number} [opts.minRecurrence=2]
 * @param {number} [opts.stuckDays=3]
 */
export function findFailureTail(sources = {}, opts = {}) {
  if (!opts.nowIso) {
    throw new Error('findFailureTail: opts.nowIso is required (callers must pin the clock)');
  }
  const runs = Array.isArray(sources.runs) ? sources.runs : [];
  const issues = Array.isArray(sources.issues) ? sources.issues : [];
  const runTally = tallyRunFailures(runs, opts.nowIso, opts);
  const runFindings = emitRunFailureFindings(runTally, opts);
  const reworkFindings = findStuckReworkIssues(issues, opts.nowIso, opts);
  return [...runFindings, ...reworkFindings];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'unknown';
}
