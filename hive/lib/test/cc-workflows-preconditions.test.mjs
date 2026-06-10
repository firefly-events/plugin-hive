/**
 * cc-workflows-preconditions.test.mjs
 *
 * Vitest spec covering:
 *   - assertWorktreeIsolation throws on a non-worktree cwd
 *   - assertWorktreeIsolation passes (no throw) on a valid worktree cwd
 *   - Error message contains invariant text and the failing cwd
 *   - Nested paths inside a worktree (subdirs) still pass
 */

import { describe, expect, it } from 'vitest';

import { assertWorktreeIsolation } from '../cc-workflows-preconditions.mjs';

// ---------------------------------------------------------------------------
// Test 1: throws on a main-checkout (non-worktree) cwd
// ---------------------------------------------------------------------------

describe('assertWorktreeIsolation — non-worktree cwd', () => {
  it('throws when cwd is a plain project checkout with no .claude/worktrees segment', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    expect(() => assertWorktreeIsolation(mainCwd)).toThrow();
  });

  it('throws an Error (not a non-Error object) for a plain checkout path', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Test 2: does NOT throw on a valid .claude/worktrees/<name>/ cwd
// ---------------------------------------------------------------------------

describe('assertWorktreeIsolation — valid worktree cwd', () => {
  it('does not throw when cwd is a direct .claude/worktrees/<name> path', () => {
    const worktreeCwd = '/Users/don/.claude/worktrees/substrate-coverage';
    expect(() => assertWorktreeIsolation(worktreeCwd)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Error message includes invariant text and the failing cwd
// ---------------------------------------------------------------------------

describe('assertWorktreeIsolation — error message content', () => {
  it('error message includes the worktree-isolation invariant text', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toContain('Worktree-isolation invariant');
  });

  it('error message includes the failing cwd', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught.message).toContain(mainCwd);
  });

  it('thrown error has precondition_failed=true', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught.precondition_failed).toBe(true);
  });

  it('thrown error has field_sources.worktree_isolation with verdict=fail', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught.field_sources?.worktree_isolation?.verdict).toBe('fail');
  });

  it('thrown error records the failing cwd in field_sources', () => {
    const mainCwd = '/Users/don/Documents/plugin-hive';
    let caught;
    try {
      assertWorktreeIsolation(mainCwd);
    } catch (e) {
      caught = e;
    }
    expect(caught.field_sources?.worktree_isolation?.value).toBe(mainCwd);
  });
});

// ---------------------------------------------------------------------------
// Test 4: nested path inside a worktree still passes (regex matches segment)
// ---------------------------------------------------------------------------

describe('assertWorktreeIsolation — nested worktree paths pass', () => {
  it('does not throw when cwd is a subdir inside a worktree', () => {
    const nestedCwd = '/Users/don/.claude/worktrees/foo/subdir/nested';
    expect(() => assertWorktreeIsolation(nestedCwd)).not.toThrow();
  });

  it('does not throw for a deeply nested path inside a worktree', () => {
    const deepCwd = '/Users/don/.claude/worktrees/my-epic/hive/lib/test';
    expect(() => assertWorktreeIsolation(deepCwd)).not.toThrow();
  });

  it('does not throw when the worktree name contains hyphens', () => {
    const hyphenatedCwd = '/Users/don/.claude/worktrees/substrate-coverage-and-test/src';
    expect(() => assertWorktreeIsolation(hyphenatedCwd)).not.toThrow();
  });
});
