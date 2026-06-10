/**
 * CodeRabbit recurring-comment finder for step-02 analysis.
 *
 * Pure-function helpers — no fetch, no shell exec. Callers (the step-02
 * researcher persona) gather review-comment data via `gh api` and pass it
 * here as a plain object. This mirrors the separation in
 * external-research-providers.mjs's testable contract while keeping the
 * shell-out cost outside the helper.
 *
 * Goal: detect CodeRabbit comment patterns that recur across multiple recent
 * PRs. A title flagged in 3+ distinct PRs within the recency window is a
 * real signal — either the codebase has a recurring convention issue, or
 * the reviewers are repeating the same advice because the author didn't
 * internalize it last time. Either way, a meta-team proposal can address
 * the root cause.
 *
 * Per step-02-analysis.md §TASK SEQUENCE, the finder emits zero-or-more
 * `CODERABBIT_RECURRING` findings into the standard findings list — the
 * AND-of-empty routing gate treats them as ordinary signal.
 */

'use strict';

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Extract the bold title from a CodeRabbit review comment body. CodeRabbit
 * comments lead with a severity-marker line (`_⚠️ Potential issue_ | …`)
 * followed by a `**Title.**` bold-prefixed sentence on a later line. The
 * bold-prefix sentence is the stable cross-PR signature.
 *
 * Returns the normalized title (lowercased, leading/trailing punctuation
 * stripped) or null when no bold-prefixed line is found.
 */
export function extractCommentTitle(body) {
  if (typeof body !== 'string' || body.length === 0) return null;

  const lines = body.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('**')) continue;
    // Match a bold-prefix sentence: **Title.** or **Title** or **Title — …**
    const m = line.match(/^\*\*(.+?)\*\*/);
    if (!m) continue;
    const title = m[1].trim();
    if (title.length === 0) continue;
    return normalizeTitle(title);
  }
  return null;
}

/**
 * Normalize a title for cross-comment equality. Lowercases, collapses
 * whitespace, strips trailing punctuation that varies across PRs.
 */
export function normalizeTitle(title) {
  return title
    .toLowerCase()
    .replace(/[`*_]/g, '')        // drop residual markdown
    .replace(/\s+/g, ' ')         // collapse whitespace
    .replace(/[.,;:!?]+$/g, '')   // drop trailing punctuation
    .trim();
}

// ---------------------------------------------------------------------------
// Tally
// ---------------------------------------------------------------------------

/**
 * Tally CodeRabbit comment titles across an array of PR comment lists.
 *
 * Input shape:
 *   pullRequests: Array<{
 *     number: number,
 *     title: string,
 *     comments: Array<{ user: { login: string }, body: string, id?: string|number }>,
 *   }>
 *
 * Only comments authored by `coderabbitai` (case-insensitive) are tallied.
 * Returns a Map<normalizedTitle, { count, prNumbers: Set<number>, commentIds: [] }>
 * where prNumbers is the SET of distinct PR numbers (a single PR with
 * 4 same-title comments still counts as 1 for recurrence).
 */
export function tallyTitles(pullRequests) {
  const tally = new Map();
  if (!Array.isArray(pullRequests)) return tally;

  for (const pr of pullRequests) {
    const prNumber = pr?.number;
    if (typeof prNumber !== 'number') continue;
    const comments = Array.isArray(pr?.comments) ? pr.comments : [];
    for (const comment of comments) {
      const author = comment?.user?.login?.toLowerCase?.() ?? '';
      if (!author.startsWith('coderabbit')) continue;
      const title = extractCommentTitle(comment.body);
      if (!title) continue;
      let entry = tally.get(title);
      if (!entry) {
        entry = { count: 0, prNumbers: new Set(), commentIds: [] };
        tally.set(title, entry);
      }
      entry.count += 1;
      entry.prNumbers.add(prNumber);
      if (comment.id != null) entry.commentIds.push(comment.id);
    }
  }
  return tally;
}

// ---------------------------------------------------------------------------
// Findings emission
// ---------------------------------------------------------------------------

/**
 * Convert a tally into a findings array. A title is emitted as a finding
 * only when it recurs across at least `minRecurrence` DISTINCT PRs.
 *
 * @param {Map} tally        — output of tallyTitles
 * @param {object} [opts]
 * @param {number} [opts.minRecurrence=3]  — distinct-PR threshold
 * @param {number} [opts.windowDays=14]    — descriptive only: MUST mirror the gather
 *   window used to fetch the PR list (the helper sees pre-fetched data and cannot
 *   enforce it); recorded in finding.evidence and the description string
 * @returns {Array<object>}                — findings ready for step-02 emission
 */
export function emitFindings(tally, opts = {}) {
  const minRecurrence = opts.minRecurrence ?? 3;
  const windowDays = opts.windowDays ?? 14;
  const findings = [];

  // Stable order: highest recurrence first, then alphabetical by title.
  const entries = [...tally.entries()]
    .filter(([_, entry]) => entry.prNumbers.size >= minRecurrence)
    .sort((a, b) => {
      const diff = b[1].prNumbers.size - a[1].prNumbers.size;
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0]);
    });

  for (const [title, entry] of entries) {
    const prList = [...entry.prNumbers].sort((a, b) => a - b);
    const severity = entry.prNumbers.size >= 5 ? 'high' : 'medium';
    findings.push({
      id: `finding-cr-recurring-${slugifyTitle(title)}`,
      category: 'CODERABBIT_RECURRING',
      severity,
      location: 'cross-repo',
      description: `CodeRabbit flagged "${title}" in ${entry.prNumbers.size} PRs within last ${windowDays}d`,
      evidence: {
        pattern_title: title,
        pr_numbers: prList,
        recurrence_count: entry.prNumbers.size,
        comment_count: entry.count,
        window_days: windowDays,
      },
    });
  }

  return findings;
}

function slugifyTitle(title) {
  return title
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

/**
 * One-call convenience: tally + emit. Intended as the public surface
 * called by step-02 after `gh api` data has been gathered.
 */
export function findRecurringCoderabbitComments(pullRequests, opts = {}) {
  const tally = tallyTitles(pullRequests);
  return emitFindings(tally, opts);
}
