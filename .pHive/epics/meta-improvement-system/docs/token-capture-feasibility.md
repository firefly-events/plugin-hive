# Token-capture feasibility (C2.0 discovery spike)

- **Epic:** meta-improvement-system
- **Story:** C2.0 (blocking discovery spike — D7)
- **Date:** 2026-04-21
- **Status:** chosen mechanism identified, proof extracted from real session
- **Decision reference:** D7 in `.pHive/cycle-state/meta-improvement-system.yaml` and `.pHive/epics/meta-improvement-system/docs/user-decisions-dd.md` — user directive: *"we need to figure out a viable path for token spend.. there has to be a way."* Token capture is REQUIRED, not contingent; S5 MVP cannot ship without it.

## TL;DR

**Chosen mechanism: Claude Code JSONL transcripts** at `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
Every assistant turn writes a line with `type:"assistant"`, `sessionId`, `isSidechain`, and `message.usage` containing `input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens` / `model`. Subagent (Task tool) turns are written under a per-session `subagents/agent-<id>.jsonl`, and an `agent-<id>.meta.json` sidecar carries the `agentType` for clean per-agent attribution.

A real extraction is committed alongside this doc at `token-capture-proof.json` — 543 usage rows aggregated from one real past session on this machine.

The three other candidate surfaces were investigated and rejected with concrete evidence below.

## Candidate 1 — Claude Code JSONL transcripts (CHOSEN)

### Location
- Main session: `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`
  - `<encoded-cwd>` is the repo path with `/` → `-`. For this repo: `<ENCODED_CWD>`.
- Subagent transcripts (Task tool calls): `~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<agent-id>.jsonl`
- Subagent metadata: `~/.claude/projects/<encoded-cwd>/<session-uuid>/subagents/agent-<agent-id>.meta.json`

### Evidence (real)
Sampled `<SESSION_ID>.jsonl` (this repo, the C2.0 planning session that preceded this spike):

- 543 assistant turns with `message.usage` populated
- Totals: `input_tokens=6,886`, `output_tokens=665,932`, `cache_creation_input_tokens=2,586,192`, `cache_read_input_tokens=161,621,847`
- All on `claude-opus-4-7`
- Session header row carries `cwd`, `gitBranch`, `version` — perfect context dimensions

First usage line (trimmed):
```
{"type":"assistant","sessionId":"<SESSION_ID>","isSidechain":false,
 "timestamp":"2026-04-21T03:20:03.146Z",
 "message":{"model":"claude-opus-4-7",
  "usage":{"input_tokens":5,"output_tokens":364,
           "cache_creation_input_tokens":24668,"cache_read_input_tokens":18177,
           "service_tier":"standard"}}}
```

Subagent JSONL sample (session `<SESSION_ID>`, agent `<AGENT_ID>`):
- `agent-<AGENT_ID>.meta.json` → `{"agentType":"claude-code-guide","description":"Research Claude Design API/MCP"}`
- `agent-<AGENT_ID>.jsonl` → usage rows on `claude-haiku-4-5-20251001`, `isSidechain=true`

### Why it wins
- **Actually has token counts** (decisive — the other three candidates do not).
- **Dimensional keys for free:** `sessionId`, `cwd`, `gitBranch`, `version`, `model`, `isSidechain`, `timestamp`, plus subagent `agentType` from meta sidecar → covers every axis S5 metrics need (per-story, per-agent, main-vs-subagent, per-model).
- **Cache-aware:** separate `cache_creation_input_tokens` and `cache_read_input_tokens` let us compute true billed cost, not just raw input.
- **Already on disk** — no new plumbing, no API call, no subscription to runtime events. Just read a file.
- **Stable across Claude Code versions observed** (2.1.116 at time of spike); format has been consistent across all sessions in `~/.claude/projects/` going back weeks.

## Candidate 2 — Background Agent task output JSONL (REJECTED)

### Location checked
`/private/tmp/claude-501/<encoded-cwd>/<session-id>/tasks/*.output`

### Evidence
- `ls` confirmed 199 `*.output` files for the current session.
- `grep -l '"usage"'` across that directory returned **zero matches** (exit 1).
- Head of a representative file (`a49de2f3ec9cd7970.output`): starts with `{"parentUuid":null,"isSidechain":true,"promptId":"…","agentId":"…","type":"user","message":{"role":"user","content":"You are executing story C2.0 …"}`. These are **agent input prompts**, not completion turns.

### Verdict
No usage blocks present. The `/tmp` surface captures agent *prompts* (input scaffolding), not model *outputs*. Rejected.

## Candidate 3 — PostToolUse hook stdin (REJECTED)

### Evidence
- Claude Code hook spec (PostToolUse payload): `{session_id, transcript_path, cwd, hook_event_name, tool_name, tool_input, tool_response}`.
- Existing example in repo at `hooks/check-agent-misuse.sh` (lines 22-24) reads `.tool_input.prompt` and `.tool_input.description` from stdin — no `usage` key is referenced anywhere.
- `grep -R` across `hive/references/` for `usage`/`input_tokens` in hook context: no hits.

### Verdict
Hook stdin exposes tool-level metadata but not model token accounting. Rejected as a *direct* capture surface. (Note: `transcript_path` in the payload *is* useful — it's the JSONL path; PostToolUse could be a legitimate *trigger* to tail the JSONL. See "S5 usage guidance" below.)

## Candidate 4 — SessionEnd hook context (REJECTED)

### Evidence
- SessionEnd hook spec: `{session_id, transcript_path, cwd, hook_event_name, reason}`. No `usage` field.
- Same repo-side evidence as #3 — no hook script reads usage data because no hook event provides it.

### Verdict
Same as #3 — no direct usage. But again the `transcript_path` is gold: SessionEnd is an ideal trigger to sweep the JSONL once at close. Rejected as a direct surface; retained as a potential trigger.

## Guidance for C2.2 / C2.3 story executors

### Read path (primary)
For a given story episode:

1. Determine the active `session_id` (Claude Code hook input exposes this, or the orchestrator already knows it when emitting metrics).
2. Resolve the encoded cwd: `echo "$cwd" | sed 's|/|-|g'`.
3. Open `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
4. For a per-step window, bound by the episode's start/stop timestamps (we already record these in the episode status marker).

### Extraction shape (what to parse)
```jq
select(.type == "assistant" and .message.usage != null)
| {
    uuid,
    timestamp,
    session_id: .sessionId,
    is_sidechain: .isSidechain,
    model: .message.model,
    input_tokens:               .message.usage.input_tokens,
    output_tokens:              .message.usage.output_tokens,
    cache_creation_input_tokens: (.message.usage.cache_creation_input_tokens // 0),
    cache_read_input_tokens:     (.message.usage.cache_read_input_tokens // 0)
  }
```

### Aggregation contract for metric emission
For a story episode (C2.2 = S5 "tokens per story" metric), emit:
- `input_tokens` = sum of all `input_tokens` across rows in the episode window.
- `output_tokens` = sum of all `output_tokens` across rows.
- `cache_creation_input_tokens` + `cache_read_input_tokens` = sum (for billed-cost reconstruction).
- `by_model` = group by `.message.model` (Opus vs Codex-proxied Sonnet vs Haiku test-worker).
- `by_agent` = for rows where `isSidechain == true`, join to the subagent meta sidecar to pull `agentType`.

### Subagent attribution procedure
For each `<session-id>` directory under `subagents/`:
- Read `agent-<id>.meta.json` once → `{agentType, description}`
- Sum usage across `agent-<id>.jsonl`
- Tag the aggregated row with `agent_type` (e.g., `claude-code-guide`, `hive:developer`)

Main-thread rows stay at the session level (attribute to `orchestrator`).

### Trigger options for when to run extraction
Two viable wiring patterns; C2.2 authors pick one:

1. **Pull-on-demand** (simpler, recommended MVP): orchestrator tails the JSONL at episode-close time, inside the existing Stop-hook dispatcher combined under D4. No hook additions needed — Stop hook already fires and has access to `transcript_path` equivalents via the known session id.
2. **Push-via-hook** (only if pull proves lossy): add a PostToolUse sweep that reads the last-N rows from `transcript_path`. More invasive, but reacts per-tool rather than per-episode. Skip unless #1 misses turns (should not).

### Conditional on `metrics.enabled`
Per Q-new-B: if `metrics.enabled: false` in hive.config, the extractor no-ops. The JSONL is still there (Claude Code writes it regardless), but nothing reads it and nothing gets appended to `.pHive/metrics/`.

## Edge cases C2.2 / C2.3 must handle

1. **Episode spans a session boundary.** If a story runs across two Claude Code sessions (user restart), two JSONLs must be read. The episode start/end timestamps + the session registry in `.pHive/cycle-state/` should disambiguate.
2. **Sidechain rows may land only in subagent JSONL.** Spot-checked 5 recent main-session JSONLs — all had `isSidechain=false` throughout (Task calls rendered their assistant turns in the subagent file, not the main). So *always* sweep both: main JSONL *and* every `subagents/agent-*.jsonl` under that session.
3. **Haiku + Opus + Codex mix.** Codex execution runs via the codex-companion runtime (outside Claude Code's JSONL). Codex tokens will not appear here. C2.2 must record this as a known gap; Codex backend must be polled separately (follow-on) OR Codex turns must be treated as zero-for-now with a `model: codex` placeholder row synthesized from episode metadata. Acceptable for MVP per Q8 "best-effort given SDK visibility."
4. **JSONL line can be very large** (multi-MB rows with tool results). Stream with `jq -c` / line-by-line reading; never slurp the whole file into memory for large sessions.
5. **Cache tokens inflate raw input.** Reporting must separate `input_tokens` (billed-input), `cache_creation_input_tokens` (written), `cache_read_input_tokens` (read). Don't roll them into a single "input" number — user will misread cost.
6. **`usage` sometimes absent** on streaming-error or interrupted turns. Select only rows where `.message.usage != null` (shown in the jq snippet above).
7. **Format drift.** Bound to Claude Code internal format. Pin a Claude Code `version` field read at extraction time (already present in JSONL header rows) and log a warning if it changes across a metric window.

## Risks & fallback

| Risk | Mitigation |
|------|-----------|
| JSONL format changes in a future Claude Code release | Extractor pins on `version` field, logs drift, fails closed (emits zero + warning rather than wrong numbers). |
| Codex turns not captured here | Documented gap. Follow-on story reads Codex-companion's own session log. MVP accepts Opus-only coverage. |
| Episode-to-JSONL time alignment off by a tool call | Use UUID chains (`parentUuid` → child) to scope precisely, not wall-clock alone. JSONL rows carry UUIDs; episode markers can record the first/last UUID in their window. |
| `~/.claude/projects/` moves or gets pruned by user | User-level tree; we don't own it. Extractor fails soft (metric becomes "unavailable") rather than blocking Stop hook. Per D4 guardrail: metrics failure must not suppress the Stop sentinel. |
| Multi-machine execution (CI) | `~/.claude/` is per-user per-host; CI runs will not have it. MVP scope is local-dev only (consistent with meta-meta-optimize being local-only per Q-new-A). |

### Ultimate fallback (not expected to trigger)
If the JSONL format disappears in a future release, candidate #2's `/tmp` surface could be promoted — but that would require Anthropic to start writing usage to task outputs (they currently don't). There is no second viable on-disk surface today; the JSONL is the only game in town, which matches the D7 "there has to be a way" answer: there is one, and it's this.

## Proof artifact

See `token-capture-proof.json` in this directory. Real extraction from session `<SESSION_ID>` on this machine. Non-synthetic; produced by the jq pipeline above.
