// hive/lib/runtime_mode.js
//
// Detects whether the current Hive skill invocation is running interactively
// (a human is present, AskUserQuestion is usable) or headlessly (driven by an
// orchestrator via `claude -p`, no human present). Dual-implemented with
// runtime_mode.py per this package's existing config.py/config.js convention.
//
// Precedence (env > CI > default), matching the env > config > default idiom
// used elsewhere in this repo (see planning.mode resolution):
//   1. HIVE_HEADLESS=1 forces headless; HIVE_HEADLESS=0 forces interactive.
//   2. CI=true is treated as headless.
//   3. Default: interactive.
//
// Deliberately no TTY-probe tier — a Bash-tool subprocess's stdio does not
// reliably reflect whether a human is present in the calling session, and
// using it risks misclassifying sessions in either direction. See
// .pHive/epics/headless-question-protocol/docs/grill-record.md finding H1.

/**
 * @param {{ env?: Record<string, string | undefined> }} [opts]
 * @returns {{ mode: 'interactive' | 'headless', source: 'env' | 'ci' | 'default' }}
 */
export function detectInteractiveMode(opts = {}) {
  const env = opts.env || process.env;

  const headlessOverride = env.HIVE_HEADLESS;
  if (headlessOverride === '1') {
    return { mode: 'headless', source: 'env' };
  }
  if (headlessOverride === '0') {
    return { mode: 'interactive', source: 'env' };
  }

  if (env.CI === 'true') {
    return { mode: 'headless', source: 'ci' };
  }

  return { mode: 'interactive', source: 'default' };
}
