import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterNightlyEligible } from '../backlog-loader.mjs';

describe('filterNightlyEligible', () => {
  it('removes tier=little-fix candidates', () => {
    const candidates = [
      { candidate_id: 'a', tier: 'little-fix', status: 'pending' },
      { candidate_id: 'b', tier: 'structural', status: 'pending' },
    ];
    const result = filterNightlyEligible(candidates);
    assert.equal(result.length, 1);
    assert.equal(result[0].candidate_id, 'b');
  });

  it('keeps tier=structural candidates', () => {
    const candidates = [{ candidate_id: 'a', tier: 'structural', status: 'pending' }];
    assert.equal(filterNightlyEligible(candidates).length, 1);
  });

  it('keeps tier=strategic candidates', () => {
    const candidates = [{ candidate_id: 'a', tier: 'strategic', status: 'pending' }];
    assert.equal(filterNightlyEligible(candidates).length, 1);
  });

  it('treats absent tier as structural (backward-compatible)', () => {
    const candidates = [{ candidate_id: 'a', status: 'pending' }];
    assert.equal(filterNightlyEligible(candidates).length, 1);
  });

  it('mixed-tier backlog: only structural+strategic pass', () => {
    const candidates = [
      { candidate_id: 'lf1', tier: 'little-fix', status: 'pending' },
      { candidate_id: 's1', tier: 'structural', status: 'pending' },
      { candidate_id: 'lf2', tier: 'little-fix', status: 'pending' },
      { candidate_id: 'st1', tier: 'strategic', status: 'pending' },
      { candidate_id: 'no-tier', status: 'pending' },
    ];
    const result = filterNightlyEligible(candidates);
    assert.equal(result.length, 3);
    assert.deepEqual(
      result.map(c => c.candidate_id),
      ['s1', 'st1', 'no-tier'],
    );
  });

  it('returns empty array when all candidates are little-fix', () => {
    const candidates = [
      { candidate_id: 'lf1', tier: 'little-fix', status: 'pending' },
      { candidate_id: 'lf2', tier: 'little-fix', status: 'pending' },
    ];
    assert.equal(filterNightlyEligible(candidates).length, 0);
  });

  it('handles empty candidates array', () => {
    assert.deepEqual(filterNightlyEligible([]), []);
  });

  it('handles null/undefined gracefully', () => {
    assert.deepEqual(filterNightlyEligible(null), []);
    assert.deepEqual(filterNightlyEligible(undefined), []);
  });

  it('little-fix candidates remain in queue with status=pending after filter', () => {
    const lf = { candidate_id: 'lf', tier: 'little-fix', status: 'pending' };
    const structural = { candidate_id: 's', tier: 'structural', status: 'pending' };
    const filtered = filterNightlyEligible([lf, structural]);
    // little-fix stays in the original array unchanged (not mutated)
    assert.equal(lf.status, 'pending');
    assert.equal(filtered.some(c => c.candidate_id === 'lf'), false);
  });
});
