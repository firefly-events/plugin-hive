/**
 * mode-resolver.mjs
 *
 * Resolves a Hive mode variable to a { decision, sources } result using the
 * canonical 5-tier precedence chain:
 *
 *   env > root_config > shipped_baseline > skill_override > default
 *
 * ## Return shape
 *
 * ```
 * {
 *   decision: string,       // winning mode value (e.g. 'sandcastle', 'multica', 'cc-workflows', 'default')
 *   sources: {              // ONLY the resolving tier key is populated
 *     env?:              string,   // e.g. 'HIVE_EXECUTE_MODE=sandcastle'
 *     root_config?:      string,   // e.g. 'execution.mode=multica'
 *     shipped_baseline?: string,   // raw value token
 *     skill_override?:   string,   // raw value token
 *     default?:          string,   // e.g. 'auto'
 *   }
 * }
 * ```
 *
 * ## ctx shape
 *
 * ```
 * {
 *   env?:             string,   // raw "VARNAME=value" token (e.g. 'HIVE_EXECUTE_MODE=multica')
 *   rootConfig?:      object,   // parsed root hive.config.yaml (e.g. { execution: { mode: 'sandcastle' } })
 *   shippedBaseline?: string,   // additive slot — set by downstream resolver stories; falls through when absent
 *   skillOverride?:   string,   // additive slot — set by skill-local override; falls through when absent
 *   default?:         string,   // caller-supplied default; falls back to 'auto' when absent
 * }
 * ```
 *
 * ## Resolver-name registry
 *
 * The varName argument must be one of the following six recognized strings:
 *   - HIVE_PLAN_MODE
 *   - HIVE_EXECUTE_MODE
 *   - HIVE_TEST_MODE
 *   - HIVE_DESIGN_MODE
 *   - HIVE_DESIGN_REVIEW_MODE
 *   - HIVE_REVIEW_MODE
 *
 * All six share identical tier semantics. Passing an unrecognized varName is
 * permitted (future-proofing) and falls through to the default tier.
 *
 * ## Env-path silencing rule
 *
 * An env token whose value is not a recognized mode string is silently ignored
 * (reserved for future modes) and resolution falls through to the next tier.
 * Recognized mode strings: sandcastle, multica, cc-workflows, sequential, auto.
 *
 * ## Conflict resolution
 *
 * When env and root_config disagree, env wins per standard Hive precedence.
 * Only the winning tier key is recorded in sources.
 */

/** Recognized mode values — any other env value is silently ignored. */
const RECOGNIZED_MODES = new Set(['sandcastle', 'multica', 'cc-workflows', 'sequential', 'auto']);

/**
 * Resolve a Hive mode variable using the 5-tier precedence chain.
 *
 * @param {string} varName - One of the six recognized resolver names (e.g. 'HIVE_EXECUTE_MODE')
 * @param {object} ctx - Resolution context (see module doc-block for shape)
 * @returns {{ decision: string, sources: object }}
 */
export function resolveMode(varName, ctx = {}) {
  // Tier 1: env
  if (ctx.env != null) {
    // ctx.env is a raw "VARNAME=value" token
    const eqIdx = ctx.env.indexOf('=');
    if (eqIdx !== -1) {
      const envVar = ctx.env.slice(0, eqIdx);
      const envVal = ctx.env.slice(eqIdx + 1);
      if (envVar === varName && RECOGNIZED_MODES.has(envVal)) {
        return { decision: envVal, sources: { env: ctx.env } };
      }
      // Unknown env value or wrong var name — fall through (silently ignored)
    }
  }

  // Tier 2: root_config
  const configMode = ctx.rootConfig?.execution?.mode;
  if (configMode != null && RECOGNIZED_MODES.has(configMode)) {
    return {
      decision: configMode,
      sources: { root_config: `execution.mode=${configMode}` },
    };
  }

  // Tier 3: shipped_baseline
  if (ctx.shippedBaseline != null) {
    return {
      decision: ctx.shippedBaseline,
      sources: { shipped_baseline: ctx.shippedBaseline },
    };
  }

  // Tier 4: skill_override
  if (ctx.skillOverride != null) {
    return {
      decision: ctx.skillOverride,
      sources: { skill_override: ctx.skillOverride },
    };
  }

  // Tier 5: default
  const defaultVal = ctx.default ?? 'auto';
  return { decision: 'default', sources: { default: defaultVal } };
}

export default resolveMode;
