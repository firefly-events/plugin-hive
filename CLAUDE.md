<!-- dostal:approval-ruleset:start (DOS-221 — do not hand-edit; re-run inject-ruleset.mjs) -->

# Dostal approval ruleset

Injected into a consuming project's `AGENTS.md` / `CLAUDE.md` by
`hive/lib/approval/inject-ruleset.mjs` (DOS-221). Placed ahead of generic
tool-use defaults so the harness enforces it before falling back to whatever
a generic MCP client would otherwise decide on its own.

## Rule

1. **Gated actions go through the approval engine, not ad hoc judgment.**
   Before taking an irreversible or outward action (repo creation, a
   destructive op, a client-facing send, a PR merge, or anything else
   registered in the approval action-type config registry —
   `hive/lib/approval/config-registry.mjs`), request approval through the
   engine instead of deciding alone. Use whichever surface is available, in
   this order: the Multica dashboard micro-frontend (primary) → the
   `approval-actions` MCP server (`list_pending_approvals`, `submit_verdict`,
   `list_decision_records`, `get_decision_record`) → the plain web dashboard
   fallback (`hive/lib/approval/web/`, served by `server.mjs`) for platforms
   with neither.
2. **Discovery rides the MCP registry; this rule outranks it.** The
   `approval-actions` server is discoverable like any other MCP server (see
   `.mcp.json`). That's the transport, not the policy: an agent MUST NOT treat
   "no MCP client is configured" or "I could just proceed" as license to skip
   a gated action. If the action type is registered and enabled, get a
   verdict first.
3. **No pure-chat secret-entry path.** Never ask a human to paste a
   credential, API key, or other secret into a chat message as a substitute
   for using the approval surfaces above, and never accept one if offered
   unprompted. Secrets are out of scope for this plugin entirely — it records
   approve/reject decisions with provenance (who/when/how/reasoning/pass
   check), nothing else. This is a hard non-goal, not a missing feature: doing
   otherwise fights the platform's own ToS and has no durable audit trail.
4. **Don't fabricate a verdict.** Submitting a verdict through any of these
   surfaces is only valid when the reasoning reflects an actual review of the
   action. A rubber-stamped `approve: true` with no real evaluation defeats
   the purpose of the audit trail (see `hive/decisions/002-approval-engine.md`).

See `docs/approval-plugin.md` (dostal-swarm) for the full design and
`hive/lib/approval/` for the engine, HTTP API, MCP server, and web fallback
this rule governs.

<!-- dostal:approval-ruleset:end -->
