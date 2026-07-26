/**
 * runtime_mode.test.mjs
 *
 * Covers detectInteractiveMode()'s precedence tiers for story
 * hqp-1-runtime-mode-detection: env override > CI > default, plus the
 * HIVE_HEADLESS-wins-over-CI precedence case.
 */

import { describe, expect, it } from 'vitest';

import { detectInteractiveMode } from '../runtime_mode.js';

describe('detectInteractiveMode', () => {
  it('HIVE_HEADLESS=1 forces headless (source: env)', () => {
    expect(detectInteractiveMode({ env: { HIVE_HEADLESS: '1' } })).toEqual({
      mode: 'headless',
      source: 'env',
    });
  });

  it('HIVE_HEADLESS=0 forces interactive (source: env)', () => {
    expect(detectInteractiveMode({ env: { HIVE_HEADLESS: '0' } })).toEqual({
      mode: 'interactive',
      source: 'env',
    });
  });

  it('CI=true with no HIVE_HEADLESS resolves headless (source: ci)', () => {
    expect(detectInteractiveMode({ env: { CI: 'true' } })).toEqual({
      mode: 'headless',
      source: 'ci',
    });
  });

  it('no HIVE_HEADLESS and no CI resolves interactive (source: default)', () => {
    expect(detectInteractiveMode({ env: {} })).toEqual({
      mode: 'interactive',
      source: 'default',
    });
  });

  it('HIVE_HEADLESS=1 wins over CI=true (source: env)', () => {
    expect(
      detectInteractiveMode({ env: { HIVE_HEADLESS: '1', CI: 'true' } }),
    ).toEqual({ mode: 'headless', source: 'env' });
  });

  it('HIVE_HEADLESS=0 wins over CI=true (source: env)', () => {
    expect(
      detectInteractiveMode({ env: { HIVE_HEADLESS: '0', CI: 'true' } }),
    ).toEqual({ mode: 'interactive', source: 'env' });
  });

  it('unrecognized CI value (not the literal string "true") does not trigger headless', () => {
    expect(detectInteractiveMode({ env: { CI: '1' } })).toEqual({
      mode: 'interactive',
      source: 'default',
    });
  });
});
