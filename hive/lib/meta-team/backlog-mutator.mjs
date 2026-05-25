import fs from 'node:fs';

/**
 * Marks the specified candidates as status=done in the queue YAML file.
 * Preserves all other fields and YAML comments in the file header by
 * performing a line-level string replacement rather than a full round-trip
 * through a YAML serializer.
 *
 * @param {string} queuePath - Absolute or repo-relative path to the queue YAML
 * @param {string[]} candidateIds - candidate_id values to mark done
 * @returns {string[]} IDs that were actually updated (subset of candidateIds)
 */
export function markCandidatesDone(queuePath, candidateIds) {
  if (!candidateIds || candidateIds.length === 0) return [];

  const idSet = new Set(candidateIds);
  const raw = fs.readFileSync(queuePath, 'utf8');
  const lines = raw.split('\n');

  const updated = [];
  let currentId = null;

  const out = lines.map((line) => {
    const idMatch = line.match(/candidate_id:\s+"?([^"]+)"?\s*$/);
    if (idMatch) {
      currentId = idMatch[1];
    }
    const statusMatch = line.match(/^(\s+status:\s+)"pending"(.*)$/);
    if (statusMatch && currentId && idSet.has(currentId)) {
      updated.push(currentId);
      currentId = null;
      return `${statusMatch[1]}"done"${statusMatch[2]}`;
    }
    return line;
  });

  fs.writeFileSync(queuePath, out.join('\n'), 'utf8');
  return updated;
}

/**
 * Returns only tier=little-fix candidates with status=pending from a
 * parsed candidates array. Complement of filterNightlyEligible in
 * backlog-loader.mjs.
 *
 * @param {Array<object>} candidates - raw candidates array from backlog YAML
 * @returns {Array<object>}
 */
export function filterShotgunEligible(candidates) {
  return (candidates ?? []).filter(
    (c) => c.tier === 'little-fix' && c.status === 'pending',
  );
}

/**
 * Groups candidates by the leading directory component of their target path.
 *
 * @param {Array<object>} candidates - each must have a `target` string field
 * @returns {Map<string, Array<object>>} dir → candidates in that dir
 */
export function groupByDir(candidates) {
  const map = new Map();
  for (const c of candidates ?? []) {
    const dir = c.target.includes('/')
      ? c.target.split('/').slice(0, -1).join('/')
      : '.';
    if (!map.has(dir)) map.set(dir, []);
    map.get(dir).push(c);
  }
  return map;
}
