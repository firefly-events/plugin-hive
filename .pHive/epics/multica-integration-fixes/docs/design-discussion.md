# Design Discussion — Multica Integration Fixes

## 0. Prior Decisions (KG Pre-flight)

KG `/hive:why` still broken (Python 3.13 chromadb subprocess import bug from hermes-integration-mvp era). Treated as zero results per skill contract. Out of scope here.

## 0a. Session glossary (per V1 grill finding)

"Session" appears in three distinct senses across this epic. Story specs MUST use the qualified term, not bare "session":

- **Claude Code harness session** — what `/plan` or `/execute` runs inside on the orchestrator's machine. Lifecycle = single CLI invocation.
- **Multica task session** — what Multica spawns to execute one assigned issue. Lifecycle = one `multica issue runs` entry per task. Has its own `session_id` field (visible in run records).
- **Anthropic API connection** — the underlying HTTP/socket the Claude SDK uses inside a Multica task session. Idle timeout on this connection is what dropped h-04. NOT the same as the task session.

## Grill-record consumption note

Phase A2 grill produced [`grill-record.md`](./grill-record.md) with 13 findings. This revision addresses each:
- **V1** session glossary — added §0a above; stories reference qualified terms only.
- **V2** "spike" terminology — accepted as informal industry term; deliverable shape (~50-line brief) is the load-bearing contract.
- **H1** spike scope cap — mi-01/mi-02 acceptance criteria specify ≤2h wall-clock budget + ≤15 file reads + explicit non-completion path ("if not findable, document the gap + recommended upstream question").
- **H2** Multica source verification — mi-01/mi-02 include pre-step verifying `~/Code/spikes/multica` is current + acceptable to read, OR fall back to fresh clone of `github.com/multica-ai/multica`.
- **H3** mi-04 under-specification — mi-04 explicitly gates on mi-01 completion. Acceptance criteria written with three branches (config-only / Multica patch / unfindable) so executing agent picks based on mi-01's brief.
- **H4** `multica repo checkout --ref` unverified — mi-03 prepends a pre-implementation verification step (invoke against throwaway issue; inspect resulting workdir; document actual behavior) before writing skill patch.
- **U1** Done-definition rewrite — see §1 below.
- **U2** mi-02 workaround scope — accepted P1 grill finding: mi-02 ships diagnosis + upstream-fix-spec ONLY. Retry shim deferred to follow-on epic. mi-02's brief lists workaround options as appendix without implementing.
- **C1** agents.yaml single-writer — mi-04 explicitly extends `/hive:multica-init` rather than mutating agents.yaml outside that skill. Preserves single-writer invariant.
- **C2** Codex provider deferral — mi-04 includes documenting the policy deviation under `.pHive/upstream-watch/` (per epic deliverable convention from grill P2 fold-in).
- **C3** parallel codex race — mi-01/mi-02 set `parallel_allowed: false`. Defensive; Multica's per-task one-agent model probably skirts the race but verifying isn't worth the risk for two stories.
- **P1** composable-substrate posture — accepted. mi-02 deliverable is diagnosis + upstream-fix-spec. No Hive-side retry shim in this epic.
- **P2** Wave 3 deliverable shape — accepted. **mi-05 dropped from this epic.** Upstream-blocker docs become outputs of mi-01 (plugin loading upstream brief at `.pHive/upstream-watch/multica-plugin-loading.md`) and mi-02 (session lifecycle upstream brief at `.pHive/upstream-watch/multica-session-lifecycle.md`). Collapsing one story; total drops from 5 to 4.

## 1. What Are We Doing?

Fix the three Multica integration pathologies surfaced during hermes-integration-mvp execute run (4 of 5 stories needed orchestrator manual intervention to reconcile work or complete after Multica failures). Tasks #62/#63/#64.

Reframed per recon: only #63 (workdir consistency) is a clean Hive-side win shippable in one epic. #64 (cmux MODULE_NOT_FOUND) is cosmetic stderr noise downstream of the real bug (Anthropic API socket idle timeout — Multica-side). #62 (plugin install in Multica agent runtime) needs source-level Multica investigation before we know whether it's a config tweak or a Multica patch.

**"Done" (rewritten per grill U1)** — partial-closure framing that matches what this epic actually delivers:
1. Hive-side `execute-mode-multica` skill fails fast on missing/wrong-branch workdir clone instead of silently degrading (mi-03)
2. Reconciliation pattern documented in the skill itself (mi-03)
3. Upstream-blocker brief at `.pHive/upstream-watch/multica-session-lifecycle.md` documenting the API socket idle drop with repro + root cause + suggested fix (mi-02)
4. Upstream-blocker brief at `.pHive/upstream-watch/multica-plugin-loading.md` documenting the plugin discovery gap + recommended fix (mi-01)
5. If mi-01 finds plugin loading is config-only (not source-patch), the plugin install procedure also ships via `/hive:multica-init` extension (mi-04 branch a). Otherwise mi-04 produces a documented procedure and the actual Multica change ships in a follow-on epic.

Full closure (next Multica run truly clean) requires upstream Multica + codex PRs landing — out of this epic's scope. This epic ships the Hive-side hardening + the upstream-PR-ready artifacts.

## 2. What I Found

Hive's `execute-mode-multica` skill assumes Multica makes each task's workdir self-contained (per-task clone of plugin-hive inside `workdir/plugin-hive/`). Observed reality: only 1 of 4 runs (h-01) matched that contract. Three runs left workdir bare; agent improvised by writing into prior runs' leftover workdirs OR mutating the caller's checkout directly.

When Multica DOES clone, it bases off `origin/main` (verified). The `multica repo checkout` CLI accepts `--ref <branch>` but execute-mode-multica skill never calls it. So even on a clean clone, agent works from main and dependent stories don't see prior story commits without cherry-pick reconciliation.

The cmux MODULE_NOT_FOUND that I treated as a session-start blocker was actually stderr noise from a SessionEnd hook running with a stale NODE_OPTIONS preload. The PRIMARY failure is Anthropic API socket dropping mid-session — h-04 attempt 1 had a 16-minute idle gap between agent's last message and the socket drop. This pattern also affected unrelated tasks (per daemon log) — it's a Multica connection-lifecycle issue, not a Hive issue.

`agents.yaml` declares all three Multica agents as `provider: claude`. Multica daemon supports `codex` provider but no agent uses it. The Claude provider inlines the persona file as `instructions` text on the agent record — no plugin manifest reference. Plugin discovery in Multica's claude provider isn't documented in CLI help; need source-level inspection of `~/Code/spikes/multica` (or `github.com/multica-ai/multica`).

## 3. My Proposed Approach

Five stories across three waves. Wave 1 is investigation (cheap, blocks everything). Wave 2 ships Hive-side fixes (the only thing fully under our control). Wave 3 captures findings for upstream PRs.

**Wave 1 — Investigation (serial, per C3 grill — defensive vs codex race):**
- **mi-01** spike: read Multica source to find plugin-loading mechanism for the Claude provider. Pre-step: verify `~/Code/spikes/multica` is current OR fresh-clone upstream. Budget: ≤2h wall-clock + ≤15 file reads. Output: `.pHive/upstream-watch/multica-plugin-loading.md` with sections {repro, root cause, suggested fix, recommended Multica-side change}. Non-completion path: if not findable within budget, brief still ships documenting the gap + suggested question to file upstream.
- **mi-02** spike: read Multica source to find session-lifecycle / connection management for the Claude provider. Same pre-step + budget as mi-01. Output: `.pHive/upstream-watch/multica-session-lifecycle.md` with same four sections. Includes appendix listing Hive-side workaround options (retry-with-backoff, smaller stories, keepalive-tickle) WITHOUT recommending any of them — composable-substrate posture says diagnosis + upstream fix is the right deliverable; workarounds are a follow-on epic decision.

**Wave 2 — Hive-side ships:**
- **mi-03** patch `execute-mode-multica` skill: pre-implementation step invokes `multica repo checkout --ref <epic-branch>` against a throwaway issue + inspects resulting workdir; documents actual behavior; THEN writes the skill patch. Patch adds explicit clone + post-clone verification (`workdir/plugin-hive/` must exist, branch must match) + fail-fast actionable error if missing. Document the canonical reconciliation pattern in the skill itself (cherry-pick OR direct-clone-from-feat, picked per mi-03's pre-step finding).
- **mi-04** apply mi-01 finding: install plugin-hive + codex plugins into Multica agent runtime by extending `/hive:multica-init`. Three-branch acceptance criteria (executing agent picks based on mi-01's brief):
  - **Branch (a) config-only:** mi-04 extends multica-init to write the right config (env var, agent field, etc.) + adds `/reload-plugins` invocation. Ships working procedure.
  - **Branch (b) Multica patch needed:** mi-04 ships the documented procedure as `.pHive/upstream-watch/multica-plugin-loading-impl.md` (extending mi-01's brief with implementation detail), defers the actual install. Plus writes the codex-provider-deviation note into the same upstream-watch dir per grill C2.
  - **Branch (c) unfindable:** mi-04 is a no-op; mi-01's brief stands as the upstream-watch deliverable. Story marked completed (mi-04 acceptance is "execute the right branch per mi-01").

Sequence: Wave 1 serial (mi-01 → mi-02 — `parallel_allowed: false` defensive per grill C3). Wave 2 mi-03 can run parallel with Wave 1 (no dependency, purely Hive-side patch + skill spec). Wave 2 mi-04 strictly after mi-01.

## 4. What Could Go Wrong

- **[high] Wave 1 spike finds the bugs are deeper than expected.** mi-01 might reveal that Multica's claude provider hardcodes a stripped-down environment that won't load plugins at all without source patch. mi-02 might reveal the socket-drop is a Bun runtime issue inside Multica (unfixable from outside). Mitigation: explicit spike posture — each story produces a written brief documenting what we found; downstream stories adjust scope based on those briefs. Don't pre-commit Wave 2/3 shape until Wave 1 reports.
- **[high] mi-04 shape unknown until mi-01 returns.** Risk: writing mi-04 acceptance criteria now creates a story spec that doesn't match the actual fix shape. Mitigation: leave mi-04 acceptance criteria minimal ("apply mi-01's recommendation") + accept this as a 2-pass story where the first pass narrows scope.
- **[med] Multica upstream patches won't ship in this epic.** mi-05's deliverable is documentation, not code in Multica. If primary failure (socket drop) can only be fixed Multica-side, this epic ships partial: Hive-side execute-mode-multica patch + investigation findings + upstream-watch entries — but next Multica run could STILL fail with socket drops. Mitigation: explicit framing — this epic is the Hive-side half + upstream-prep; full closure requires Multica PRs.
- **[med] Spikes drift into implementation.** Per memory `feedback_researcher_overshoots_to_planning`, Wave 1 agents could go past spike-scope into proposing implementations. Mitigation: tight story spec for mi-01/mi-02 — name the questions, cap deliverable at ~50-line brief.
- **[med] execute-mode-multica patch (mi-03) breaks h-01-style clean runs.** The current "rely on auto-clone" path works sometimes (h-01) — explicit checkout + verify could regress that path if `multica repo checkout` behaves differently than auto-clone. Mitigation: regression test (or manual run) against a known-working story before merging mi-03.
- **[low] /reload-plugins isn't a thing the user invocation can do mid-session.** Claude Code may require a session restart for plugin changes. Mitigation: mi-04 brief should call out whether reload-vs-restart is the actual fix.
- **[low] Multica agents.yaml is single-writer (`/hive:multica-init`).** Changes need to go through multica-init or break the convention. Mitigation: mi-04 either extends multica-init's schema OR documents that agents.yaml is now multi-writer.

## 5. Dependencies and Constraints

- **External:** Multica daemon (already running, v0.3.4). codex plugin (already installed via openai-codex marketplace). plugin-hive (this repo).
- **Internal:** `execute-mode-multica` skill (in plugin-hive). `hive/lib/multica-story-dispatch/` (helpers). agents.yaml (under .pHive/multica/, single-writer = /hive:multica-init).
- **Cross-repo:** Multica source at `github.com/multica-ai/multica` (Apache 2.0). codex plugin source at `github.com/openai/codex-plugin-cc`. NEITHER receives code in this epic — Wave 1 reads only, Wave 3 prepares-but-defers PRs.
- **Branching:** per-epic branch convention. This epic = `feat/multica-integration-fixes` off develop. Single PR aggregates all 5 story commits.
- **Time-sensitive:** None. Failing runs can be unblocked by orchestrator-manual fallback (proven in hermes-integration-mvp).
- **Methodology:** classic (per `hive.config.yaml execution.default_methodology`).

## 6. Open Questions

1. **mi-04 scope cap.** If mi-01 finds plugin loading requires a Multica patch (not config-only), should mi-04 (a) stub-out the deliverable + downgrade to spike-only, (b) open the Multica PR within this epic, or (c) defer to a follow-on epic? Recommend (c) — keeps this epic atomic; PR is a separate effort.
2. **mi-03 explicit checkout vs caller-checkout-direct.** Three of four h-* runs had Multica NOT clone (agent worked in caller checkout). Should mi-03 (a) force explicit clone always + fail-fast if Multica doesn't clone, or (b) detect missing clone + fall back to caller-checkout-direct with a warning? Option (a) is cleaner contract; option (b) preserves "it sometimes works" behavior. Recommend (a) — cleaner test surface + matches the skill's documented contract.
3. **Multica session lifecycle workaround in mi-02 deliverable.** Should mi-02's brief include a Hive-side workaround proposal (retry-with-backoff, smaller stories, etc.) — or stay pure root-cause-and-upstream-fix? Recommend "include workaround as appendix" — even if upstream fixes ship, Hive should still degrade gracefully on transient socket drops.
4. **Codex provider in agents.yaml.** Per agent_backends policy, developer should be Codex. Multica daemon supports `codex` provider. Should mi-04 also add a `developer-codex` agent variant (or swap developer to codex)? Or stay claude-only for this epic? Recommend stay-claude-only — codex routing is a separate optimization that mi-01 finding may shape.
5. **mi-05 upstream-watch path.** `.pHive/upstream-watch/` is already a tracked convention (per .gitignore). Two new files. Just confirm path + naming.

## 7. Verification Strategy

```
VERIFICATION PLAN:
  Tools: bun test (Hive-side unit tests for execute-mode-multica skill patch),
         manual Multica dispatch round-trip (mi-03 end-to-end validation),
         shell smoke (Wave 1 spikes have no code — output is a brief)
  Platforms: macOS (Mac Studio runtime is same-system per hermes-integration-mvp lock)
  Automated:
    - mi-03 patch: unit test for explicit-clone branch, fail-fast assertion on missing workdir/plugin-hive/
    - mi-03 regression: existing execute-mode-multica tests still pass (no behavior change on the auto-clone success path)
  Manual:
    - mi-03 end-to-end: dispatch a throwaway story to Multica from feat branch; verify clone happens off feat (not main); verify reconciliation works
    - mi-04 end-to-end: after plugin install in Multica runtime, dispatch a throwaway story that invokes /hive:status; verify slash command resolves
    - mi-02 workaround (if shipped): retry-with-backoff fires after one socket drop; second attempt succeeds
  Not verifying:
    - Multica source patches (out of scope — Wave 3 produces docs only)
    - codex plugin SessionEnd cleanup race (cosmetic noise; tracked but not fixed in this epic)
    - Cross-machine Multica deployment (single-system constraint)
```

## 8. Scale Assessment

```
SCALE ASSESSMENT:
  Files affected: ~6-9 (1 skill patch + 0-1 lib helper + 2 upstream-watch briefs + 0-1 multica-init extension + tests; mi-05 dropped per grill P2)
  Subsystems: execute-mode-multica skill, multica-story-dispatch helpers,
              upstream-watch convention dir, possibly .pHive/multica/agents.yaml
  Migration required: no
  Cross-team coordination: no — single-repo work + read-only investigation of upstream sources
  Unknowns: 5 (numbered open questions); 2 ride on spike outputs (mi-01/mi-02)

  RECOMMENDATION: Proceed to stories (no H/V needed — this is Medium-scope bug-fix epic)
  RATIONALE: Spike-then-implement shape is clean. Hive-side surface is small (1 skill +
    1 lib). Investigation outputs feed implementation directly. Cross-stack thinking already
    captured in research brief. Skipping H/V keeps planning ceremony proportional to scope.
    H/V would just restate the wave structure above.

  Note: this is /plan defaulting to "Medium without --gate-hv" — Medium scope but no
  formal H/V documents. Equivalent to invoking with --fast.
```
