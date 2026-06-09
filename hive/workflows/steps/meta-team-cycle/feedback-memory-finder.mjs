/**
 * Feedback-memory recents finder for step-02 analysis.
 *
 * Pure-function helpers over file-system inputs. The caller (the step-02
 * researcher persona) walks the user's auto-memory directory and passes the
 * results here as an array of `{ path, mtimeIso, frontmatter }` records.
 * The helper does not touch the file system, run shell commands, or call
 * Date.now() — the clock is injected via `nowIso` so cycle scripts stay
 * deterministic.
 *
 * Goal: every freshly-written `feedback_*.md` memory file is a captured
 * friction point — something the user explicitly asked to remember because
 * the assistant got it wrong or surprised them. If the meta-team picks
 * those up the next morning, the loop closes: today's friction becomes
 * tomorrow's queued meta-team candidate.
 *
 * Per step-02-analysis.md §TASK SEQUENCE, the finder emits zero-or-more
 * `RECENT_FEEDBACK_MEMORY` findings into the standard findings list — the
 * AND-of-empty routing gate treats them as ordinary signal.
 */

'use strict';

// ---------------------------------------------------------------------------
// Clock helper (local copy — same shape as in sibling finders so this
// module does not force a stacking order)
// ---------------------------------------------------------------------------

export function daysBetween(isoEarlier, nowIso) {
  const earlier = Date.parse(isoEarlier);
  const now = Date.parse(nowIso);
  if (Number.isNaN(earlier) || Number.isNaN(now)) return null;
  return (now - earlier) / (1000 * 60 * 60 * 24);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify a memory record into the recents bucket. Returns one of:
 *   - 'fresh'    — within `windowDays`; emits as the standard finding
 *   - 'very-fresh' — within 1 day; emits with elevated severity
 *   - null        — older than the window OR not a feedback file
 *
 * @param {object} record  - { path, mtimeIso, frontmatter? }
 * @param {string} nowIso
 * @param {object} [opts]
 */
export function classifyMemoryRecord(record, nowIso, opts = {}) {
  if (!record || typeof record.path !== 'string') return null;
  if (!isFeedbackPath(record.path)) return null;
  if (typeof record.mtimeIso !== 'string') return null;

  const windowDays = opts.windowDays ?? 7;
  const veryFreshDays = opts.veryFreshDays ?? 1;

  const ageDays = daysBetween(record.mtimeIso, nowIso);
  if (ageDays == null || ageDays < 0) return null;
  if (ageDays > windowDays) return null;
  if (ageDays <= veryFreshDays) return 'very-fresh';
  return 'fresh';
}

function isFeedbackPath(p) {
  const filename = p.split('/').pop() ?? '';
  return filename.startsWith('feedback_') && filename.endsWith('.md');
}

// ---------------------------------------------------------------------------
// Findings emission
// ---------------------------------------------------------------------------

const BUCKET_TO_SEVERITY = {
  'very-fresh': 'high',
  'fresh': 'medium',
};

/**
 * Build findings from a list of memory-file records.
 *
 * @param {Array<object>} records   - { path, mtimeIso, frontmatter? }
 * @param {object}        opts
 * @param {string}        opts.nowIso         - required; pin the clock
 * @param {number}        [opts.windowDays=7]
 * @param {number}        [opts.veryFreshDays=1]
 * @returns {Array<object>}
 */
export function findRecentFeedbackMemories(records, opts = {}) {
  if (!opts.nowIso) {
    throw new Error('findRecentFeedbackMemories: opts.nowIso is required (callers must pin the clock)');
  }
  if (!Array.isArray(records)) return [];

  const findings = [];
  for (const record of records) {
    const bucket = classifyMemoryRecord(record, opts.nowIso, opts);
    if (!bucket) continue;
    const ageDays = daysBetween(record.mtimeIso, opts.nowIso) ?? 0;
    const ageRounded = Math.floor(ageDays);
    const slug = slugifyMemoryName(record);
    const fm = record.frontmatter ?? {};
    findings.push({
      id: `finding-feedback-${slug}`,
      category: 'RECENT_FEEDBACK_MEMORY',
      severity: BUCKET_TO_SEVERITY[bucket],
      location: `memory:${slug}`,
      description: `New feedback memory "${slug}" written ${ageRounded}d ago — ${
        typeof fm.description === 'string' ? truncate(fm.description, 100) : 'no description'
      }`,
      evidence: {
        memory_path: record.path,
        memory_slug: slug,
        age_days: ageRounded,
        bucket,
        mtime: record.mtimeIso,
        frontmatter_name: typeof fm.name === 'string' ? fm.name : null,
        frontmatter_description: typeof fm.description === 'string' ? fm.description : null,
      },
    });
  }

  // Sort: severity-desc, then youngest-first within tier (newest signals
  // surface ahead of week-old ones).
  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => {
    const sevDiff = (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99);
    if (sevDiff !== 0) return sevDiff;
    return (a.evidence.age_days ?? 0) - (b.evidence.age_days ?? 0);
  });

  return findings;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function slugifyMemoryName(record) {
  if (record?.frontmatter && typeof record.frontmatter.name === 'string') {
    return record.frontmatter.name;
  }
  const filename = (record?.path ?? '').split('/').pop() ?? '';
  return filename.replace(/\.md$/, '') || 'unknown';
}

function truncate(s, n) {
  if (typeof s !== 'string') return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
