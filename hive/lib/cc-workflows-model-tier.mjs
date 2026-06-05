/**
 * cc-workflows-model-tier.mjs
 *
 * Resolves a persona name to a model tier by reading `model_tiers` (base
 * assignment) and `model_overrides` (runtime promotion — override wins) from
 * hive.config.yaml. This is the SOLE source of truth for per-agent model
 * selection in cc-workflows mode dispatch.
 *
 * Precedence: model_overrides > model_tiers > default('sonnet' + WARN)
 *
 * DO NOT read persona frontmatter `model:` from agent files — frontmatter is
 * documentation, not runtime config (per feedback_frontmatter_base_tier_not_override).
 *
 * Returns: { tier: 'sonnet' | 'opus' | 'haiku', source: 'model_overrides' | 'model_tiers' | 'default' }
 */

/**
 * Resolve the model tier for a persona from hive.config.yaml config.
 *
 * @param {string} persona - The persona name (e.g. 'developer', 'reviewer')
 * @param {{ config: { model_overrides?: Record<string,string>, model_tiers?: Record<string,string[]> } }} ctx
 * @returns {{ tier: string, source: 'model_overrides' | 'model_tiers' | 'default' }}
 */
export function resolveModelTier(persona, ctx) {
  const overrides = ctx.config?.model_overrides ?? {};
  if (overrides[persona]) {
    return { tier: overrides[persona], source: 'model_overrides' };
  }

  const tiers = ctx.config?.model_tiers ?? {};
  for (const [tier, personas] of Object.entries(tiers)) {
    if (Array.isArray(personas) && personas.includes(persona)) {
      return { tier, source: 'model_tiers' };
    }
  }

  console.warn(`[cc-workflows-model-tier] persona "${persona}" unmapped — defaulting to sonnet`);
  return { tier: 'sonnet', source: 'default' };
}

export default resolveModelTier;
