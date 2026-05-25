# Research Brief — Multica Integration Fixes

## Scope

Three failure modes surfaced during hermes-integration-mvp execute run (2026-05-24). Recon revised what we thought we were fixing:

1. **task #64 — cmux MODULE_NOT_FOUND** — originally framed as a cmux/codex SessionEnd cleanup bug. Recon shows it is **cosmetic stderr noise** downstream of a more serious primary failure. Real root cause is **Anthropic API socket idle timeout** on long-running Multica claude sessions.
2. **task #63 — Multica workdir inconsistency** — confirmed real Hive-side bug. Three of four h-* runs deviated from the documented execute-mode-multica contract (no per-task plugin-hive clone in workdir).
3. **task #62 — plugin-hive + codex plugin install in Multica agent runtime** — confirmed real, needs Multica-side investigation. Plugin source IS available in workdir/plugin-hive/ (when clone happens) but plugins are not REGISTERED, so /hive:* slash commands don't resolve.

## Findings

### #64 reframe: API socket idle timeout

`/Users/don/.multica/daemon.log` analysis (h-04 attempt 1, task `6b08b856`):

```
04:26:49 DBG agent text="Now write the tests:"
04:42:58 DBG agent text="API Error: The socket connection was closed unexpectedly"
04:42:58 INF claude finished pid=51349 status=failed duration=7m9.126s
```

**16 minutes** between agent's last text message and socket drop. Agent claimed 48 tool invocations in 7m9s. Pattern: long pause between text message and next tool use → server-side socket idle timeout → session dies.

The cmux MODULE_NOT_FOUND surfaces AFTER the API failure when the SessionEnd hook fires. The hook runs with `NODE_OPTIONS=--require /var/folders/.../cmux-claude-node-options/restore-node-options.cjs` but that file has been cleaned up (by something — likely Multica's own cmux integration teardown that races with the hook). It is unrelated to the primary failure mode.

Daemon log shows the SAME socket-drop pattern across multiple unrelated tasks (302e56c4 also dropped, different epic) — this is a Multica session-lifecycle issue, not a Hive issue.

### #63: execute-mode-multica workdir consistency

Per `skills/hive/skills/execute-mode-multica/SKILL.md` contract: "Multica owns the internal task work directory and task execution after assignment." The skill expects per-task workdirs to be self-contained.

Observed across 4 h-* runs:

| Run | Workdir | plugin-hive clone | Where agent worked |
|---|---|---|---|
| h-01 (3c517fd1) | workdir/plugin-hive/ ✅ | yes, off origin/main | inside own workdir |
| h-02 (5c1bc08f) | workdir/ contains CLAUDE.md only | NO | improvised into h-01's leftover workdir |
| h-03 (682781a0) | workdir/ contains CLAUDE.md only | NO | mutated caller's checkout directly |
| h-04 (6b08b856 et al) | workdir/ contains CLAUDE.md only | NO | improvised into h-01's leftover workdir |

When the clone IS made (h-01), it bases off `origin/main` (verified: `git remote -v` in workdir/plugin-hive/ resolves to `github.com/firefly-events/plugin-hive`; HEAD was at `401f121` which is the main release tip). Multica's `multica repo checkout` CLI accepts `--ref <branch>` (verified in `multica repo checkout --help`) but execute-mode-multica skill never calls it — relies on default branch.

### #62: plugin discovery in Multica agent runtime

Multica daemon supports `claude` + `codex` providers (per `multica daemon status` output `Agents: claude, codex`). `.pHive/multica/agents.yaml` declares three agents (`developer`, `tester`, `reviewer`) all using `provider: claude` + `model: claude-sonnet-4-6` / `claude-opus-4-7` (reviewer).

`multica agent get <uuid>` shows the agent's `instructions` field contains the FULL persona file inlined (developer.md verbatim, ~3KB). No reference to plugin manifests or skill paths. The Claude provider apparently launches `claude` CLI directly — no plugin install layer.

Plugin runtime discovery in claude code reads `~/.claude/plugins/cache/` (verified by `find ~/.claude/plugins -name 'plugin.json'`). If Multica's Claude provider runs the agent's claude session with a different HOME (per-workdir isolation) OR doesn't pass through plugin manifests, slash commands like /hive:* won't resolve even if the source files exist in workdir/plugin-hive/.

No documentation found in Multica CLI help for plugin-loading or per-agent plugin config. Source is at `github.com/multica-ai/multica` (Apache 2.0; local clone at `~/Code/spikes/multica`).

## Key paths

- `skills/hive/skills/execute-mode-multica/SKILL.md` — Hive-side skill, owns dispatch loop
- `hive/lib/multica-story-dispatch/index.mjs` — dispatch helpers (5 functions)
- `hive/lib/multica-story-dispatch/episode-sync.mjs` — polling + episode markers
- `hive/adapters/multica/index.ts` — Multica task-tracking ABI adapter
- `.pHive/multica/agents.yaml` — agent persona seed (single writer = `/hive:multica-init`)
- `~/.multica/config.json` — local Multica config (server_url, app_url, workspace_id, token)
- `~/.multica/daemon.log` — Multica daemon runtime log (the recon-critical source for primary failures)
- `~/Code/spikes/multica` — local clone of Multica source (for upstream investigations)
- `~/.claude/plugins/marketplaces/openai-codex/plugins/codex/scripts/session-lifecycle-hook.mjs` — codex SessionEnd hook (the one capturing cmux stderr noise)

## Constraints

- Same-system runtime — Multica daemon, Hive checkout, caller workdir all on this Mac. No cross-machine.
- `multica` is a Go binary distributed via Homebrew tap (`multica-ai/tap/multica`). Upstream patches need PR + new release OR local fork build.
- `codex` plugin owned by OpenAI (`github.com/openai/codex-plugin-cc`). Upstream patches need PR. The SessionEnd hook IS the cmux integration site but the noise is symptomatic, not causal.
- Hive-side fixes can ship in plugin-hive feat branch immediately. Multica + codex fixes are upstream-deps.
- Plugin discovery in Multica's Claude provider is undocumented — need source-level investigation in Multica repo.

## Patterns to Reuse

- Existing execute-mode-multica skill structure (atomic skill called from /execute via dispatch). Patch points within it: Step 1 (per-story dispatch — add explicit clone + --ref + verify), error handling.
- Multica adapter ABI surface (createStory, updateStatus, addComment, getStory) is stable — can extend if needed.
- Episode markers already capture per-run state across attempts (h-04's marker tracks all 3 attempts) — pattern works.

## Risks

| Severity | Risk | Evidence | Mitigation |
|---|---|---|---|
| **High** | Anthropic API socket idle timeout is a Multica-side issue we cannot fully fix from Hive side | daemon log shows pattern across unrelated tasks | Hive-side workaround: shorter stories, retry-with-backoff in execute-mode-multica; surface to Multica upstream as bug report |
| **High** | execute-mode-multica spec says workdir is self-contained but reality shows 3/4 runs degraded | direct comparison of 4 workdirs | Patch skill: explicit `multica repo checkout --ref <branch>` + post-clone verification + fail-fast if missing |
| **Med** | Plugin loading in Multica's claude provider is undocumented — fix may require Multica source patch | no docs found; need to read Multica code | Spike investigation story first; ship documented procedure as deliverable |
| **Med** | Multica binary distributed via brew — local fork builds add maintenance overhead | Go build + Homebrew tap | Prefer upstream PR over local fork; document workaround for users |
| **Low** | Codex plugin (cmux integration) cleanup is racy — cosmetic stderr noise pollutes Multica logs | confirmed cosmetic by daemon log analysis | Lower priority — fix in codex-plugin-cc as separate upstream PR; not a release blocker |

## Validation Note

- **Checked:** Hive-side `execute-mode-multica` skill source, multica CLI surface, Multica daemon log analysis, codex plugin SessionEnd hook source, agents.yaml + agent details
- **Source:** codebase-only (Multica source clone at ~/Code/spikes/multica not yet read; planned for plugin-loading investigation story)
- **Confidence:** high on #63 + #64 reframe; medium on #62 (depends on Multica source investigation)
- **Gaps:** Multica source-level understanding of plugin loading + session lifecycle; needs spike investigation

## Inconsistency Risk Signals (for grill skill)

- **Vocabulary mismatch:** "session" in this domain means three different things — Hive workflow session, Multica task execution session, Claude Code SDK session. Grill should flag if planner uses "session" without disambiguation.
- **Hidden assumption:** Hive-side fixes assume `multica repo checkout --ref <branch>` actually clones into the agent's workdir at dispatch time. Need to verify the CLI call IS the mechanism Multica uses, vs a separate config-driven auto-clone.
- **Hidden assumption:** "API socket idle timeout" framing assumes Anthropic-side behavior. Could also be Multica's WebSocket/HTTP keepalive logic dropping the connection. Spike investigation needed before claiming root cause.
- **Unresolved tension:** "Fix #62 in this epic" vs "scope discipline". #62 fix may require Multica source patch + PR + release. That's not shippable in one Hive-side epic. Should #62 be downgraded to investigation-only deliverable here, with implementation in a follow-on epic?
- **Convention violation:** Per `feedback_codex_general_backend`, Codex is the preferred backend for developer creates. But Multica agents are all `provider: claude`. Should Codex provider be added to agents.yaml as part of this epic, or stay deferred?
- **Posture mismatch:** Composable substrate posture says Hive should expose stable contracts + let downstream tools (Multica) consume them — NOT patch Multica. If the failures are Multica-side, the right Hive-side response is fail-fast + clear error messages, not workarounds.
