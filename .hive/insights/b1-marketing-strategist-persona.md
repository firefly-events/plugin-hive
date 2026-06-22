# Insight: b1 marketing-strategist persona authoring

## The dual-runtime constraint shapes everything

The body prose is the single shared artifact for both Claude Code (system prompt) and Codex (`developer_instructions`). Any behavior-critical instruction that lives only in a Hive-only field (`knowledge`, `domain`, `skills`) is silently dropped on the Codex path. Write the body as if those fields don't exist — they are additive, not load-bearing.

## Tool restriction needs two expressions

The `tools` allowlist only fires on the Claude Code path. Codex has no `tools` field — it uses `sandbox_mode` + MCP allow/deny instead. So tool scope must be restated in the body prose with explicit Codex-path fallback language ("on the Codex path, honor this restriction via sandbox read-only mode..."). Omitting the prose expression means the Codex path runs unrestricted.

## Consumer-gating must be in the body, not just implied

The consumer-only gate cannot rely on the orchestrator "not dispatching" this persona to Hive-internal epics — that's a routing convention, not a guarantee. The body must include an explicit stop-and-flag instruction so the agent catches the mismatch even if wrongly dispatched.

## `model` is a tier word; resist the temptation to over-specify

`sonnet` is right for a strategist: needs coherent multi-step reasoning across audience/channel/message, but not the top-tier reasoning of `opus`. Hard-coding a model id would break the `hive.config.yaml` model_overrides contract and cause a reviewer checklist failure.

## Handoff clarity is the strategist's main quality gate

The brief is useless to b2 and b3 if they have to infer what to do with it. The `→ marketing-copywriter` and `→ ad-creative` handoff sections in the output format exist specifically to prevent ambiguity about who owns what. This is a hard deliverable, not a courtesy.
