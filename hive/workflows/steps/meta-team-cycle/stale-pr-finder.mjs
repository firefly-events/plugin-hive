/**
 * Stale-PR finder for step-02 analysis.
 *
 * Pure-function helpers — no fetch, no shell exec. Callers (the step-02
 * researcher persona) gather open-PR data via `gh api` and pass it here as
 * a plain object. Mirrors the separation in coderabbit-finder.mjs and
 * external-research-providers.mjs.
 *
 * Goal: detect open PRs that have been sitting too long since last activity.
 * A PR open with no `updatedAt` movement for >7 days is either stranded
 * awaiting human review or has a process gap (reviewer unassigned, CI
 * failing repeatedly without anyone acting). Either way it is a real
 * meta-team-actionable signal.
 *
 * Per step-02-analysis.md §TASK SEQUENCE, the finder emits zero-or-more
 * `STALE_OPEN_PR` findings into the standard findings list — the
 * AND-of-empty routing gate treats them as ordinary signal.
 */

'use strict';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Days between two ISO 8601 timestamps. `now` defaults to the second
 * timestamp the helper was called with, so test fixtures can pin a
 * deterministic clock — Date.now() is forbidden in workflow scripts but
 * the helper module is plain Node and exposes a `now` injection point.
 */
export function daysBetween(isoEarlier, nowIso) {
  const earlier = Date.parse(isoEarlier);
  const now = Date.parse(nowIso);
  if (Number.isNaN(earlier) || Number.isNaN(now)) return null;
  return (now - earlier) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Stale classification
// ---------------------------------------------------------------------------

/**
 * Classify a PR into the stale-finding pool. Returns one of:
 *   - { tier: 'critical', reason: ... } — open >14d AND a reviewer was requested
 *   - { tier: 'medium',   reason: ... } — open >7d AND a reviewer was requested
 *   - { tier: 'watch',    reason: ... } — open >7d, no reviewer assigned
 *   - null  — fresh (open <=7d) or already merged/closed
 *
 * Input shape per PR (matches `gh pr list --json number,title,createdAt,updatedAt,reviewDecision,reviewRequests,isDraft,state`):
 *   {
 *     number: 254,
 *     title: '...',
 *     headRefName: '...',
 *     createdAt: '2026-06-01T00:00:00Z',
 *     updatedAt: '2026-06-02T00:00:00Z',
 *     reviewDecision: 'REVIEW_REQUIRED' | 'APPROVED' | 'CHANGES_REQUESTED' | null,
 *     reviewRequests: [{ ... }, ...],  // present-tense outstanding requests
 *     isDraft: false,
 *     state: 'OPEN',
 *   }
 */
export function classifyPr(pr, nowIso, opts = {}) {
  if (!pr || pr.state !== 'OPEN') return null;
  if (pr.isDraft) return null;

  const staleDays = opts.staleDays ?? 7;
  const criticalDays = opts.criticalDays ?? 14;

  const anchorIso = pr.updatedAt ?? pr.createdAt;
  if (!anchorIso) return null;
  const ageDays = daysBetween(anchorIso, nowIso);
  if (ageDays == null || ageDays <= staleDays) return null;

  const hasReviewRequest = Array.isArray(pr.reviewRequests) && pr.reviewRequests.length > 0;
  const decisionRequiresWork =
    pr.reviewDecision === 'REVIEW_REQUIRED' || pr.reviewDecision === 'CHANGES_REQUESTED';

  if (ageDays > criticalDays && (hasReviewRequest || decisionRequiresWork)) {
    return {
      tier: 'critical',
      reason: `open ${Math.floor(ageDays)}d with outstanding review request`,
    };
  }
  if (hasReviewRequest || decisionRequiresWork) {
    return {
      tier: 'medium',
      reason: `open ${Math.floor(ageDays)}d with outstanding review request`,
    };
  }
  return {
    tier: 'watch',
    reason: `open ${Math.floor(ageDays)}d, no reviewer assigned`,
  };
}

// ---------------------------------------------------------------------------
// Findings emission
// ---------------------------------------------------------------------------

const TIER_TO_SEVERITY = {
  critical: 'high',
  medium: 'medium',
  watch: 'low',
};

/**
 * Convert an array of PRs into step-02 findings. Each emitted finding
 * uses the standard step-02 shape with `category: STALE_OPEN_PR` and
 * `location: <head ref or PR url>`.
 *
 * @param {Array<object>} pullRequests  — open PR objects (see classifyPr docstring)
 * @param {object}        [opts]
 * @param {string}        [opts.nowIso]       — clock injection; required for determinism
 * @param {number}        [opts.staleDays=7]
 * @param {number}        [opts.criticalDays=14]
 * @returns {Array<object>}                   — findings ready for step-02 emission
 */
export function findStalePrs(pullRequests, opts = {}) {
  if (!Array.isArray(pullRequests)) return [];
  if (!opts.nowIso) {
    throw new Error('findStalePrs: opts.nowIso is required (callers must pin the clock)');
  }

  const findings = [];
  for (const pr of pullRequests) {
    const verdict = classifyPr(pr, opts.nowIso, opts);
    if (!verdict) continue;
    const ageDays = Math.floor(daysBetween(pr.updatedAt ?? pr.createdAt, opts.nowIso) ?? 0);
    findings.push({
      id: `finding-stale-pr-${pr.number}`,
      category: 'STALE_OPEN_PR',
      severity: TIER_TO_SEVERITY[verdict.tier],
      location: pr.headRefName ? `branch:${pr.headRefName}` : `pr:${pr.number}`,
      description: `PR #${pr.number} "${pr.title?.slice(0, 80) ?? ''}" — ${verdict.reason}`,
      evidence: {
        pr_number: pr.number,
        title: pr.title ?? null,
        head_ref: pr.headRefName ?? null,
        age_days: ageDays,
        tier: verdict.tier,
        review_decision: pr.reviewDecision ?? null,
        outstanding_review_requests: Array.isArray(pr.reviewRequests) ? pr.reviewRequests.length : 0,
      },
    });
  }

  // Sort severity-desc, then by age-desc within tier so the oldest stuck
  // PR floats to the top.
  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const sevDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return (b.evidence.age_days ?? 0) - (a.evidence.age_days ?? 0);
  });

  return findings;
}
