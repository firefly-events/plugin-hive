# b5 — /marketing-campaign skill: design decisions and gotchas

## The changelog-first framing is structural, not just a flag

The `--from-ship` mode is the primary path, but the standalone path is equally complete. The key insight: both modes feed the **same three-agent ceremony** (strategist → copywriter + ad-creative in parallel). The only difference is what the strategist reads. Resist the temptation to short-circuit the standalone path — it must produce the same artifact layout.

## Phase 2 parallelism is load-bearing

The copywriter (b2) and ad-creative (b3) only need the campaign brief — they do not depend on each other. Running them in parallel is the right call architecturally, not just an optimization. The brief's `### Handoffs` section already separates `→ b2` from `→ b3`, so there is no ambiguity about which persona gets which input.

## The user-review gate is a hard constraint, not a placeholder

Maintainer decision #4 explicitly ruled out an automated `/marketing-review` skill in v1. The skill MUST end by presenting artifacts to the user. Do not sneak in a "quality check" agent after Phase 2. If a future story adds automated review, it should be a new skill wired by the orchestrator, not retrofitted here.

## b7 delegation boundary: this skill does not render

When `--render-assets` is set, every image-gen prompt from the ad-creative deliverable becomes a b7 call. The skill does not call Frame0 or openai-image MCP directly. The b7 fallback behavior (`fallback_used=true`, prompt files written to disk) must propagate to the handoff index so the reviewer knows which assets still need manual generation.

## index.yaml mirrors .pHive/design/index.yaml deliberately

The `.pHive/campaigns/index.yaml` shape was modeled after the design skill's `.pHive/design/index.yaml`. Keep them structurally analogous — same `updated_at` / `campaigns[]` list pattern, same in-place-update-by-topic behavior. Future tooling that reads both indexes will thank you.

## Consumer-scope check belongs at the skill level, not just the agent level

Each of the three personas (b1, b2, b3) individually checks for Hive-internal projects. The skill also checks early (after the kickoff gate, before dispatching any subagent) so the operator gets a clear rejection at the entry point, not buried inside a persona run.

## Topic slug derivation edge case: versioned changelogs

When `source=changelog` and the changelog heading is something like `## [2.12.0] — 2026-06-20`, a naive slug would produce `2-12-0`. Prefer the product/feature name from the first prose line or the tagline in the changelog entry. Fall back to a version-based slug (`v2-12-launch`) only if no product name is extractable.
