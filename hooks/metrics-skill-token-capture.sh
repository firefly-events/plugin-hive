#!/usr/bin/env bash
# metrics-skill-token-capture.sh — mo-2 per-skill attributed token sensor.
#
# REVISION (mo-2-per-skill-token-sensor round 1): the original Pre/PostToolUse:Skill
# pairing was INVALID as a capture boundary. PostToolUse:Skill fires the instant the
# Skill tool call returns its (prompt) result — BEFORE the model has generated a
# single token of the response that actually follows the skill's instructions. The
# window between PreToolUse:Skill and PostToolUse:Skill only bounds the tool-call
# overhead itself; it excludes essentially all of the tokens the skill invocation
# was supposed to measure. See the rewritten spike doc
# (.pHive/epics/metrics-observability/docs/mo-2-skill-token-sensor-spike.md) for the
# evidence trail.
#
# Corrected mechanism — three phases, keyed by real Claude Code hook events:
#   pre         (PreToolUse:Skill)   -> push a start marker when a skill is invoked
#                                       as a tool call.
#   promptstart (UserPromptSubmit)   -> push a start marker when the user directly
#                                       types a slash command (e.g. `/plan ...`),
#                                       which bypasses the Skill tool entirely and
#                                       therefore never fires PreToolUse:Skill.
#                                       (The story text names this boundary
#                                       "UserPromptExpansion" — no such Claude Code
#                                       hook event exists; the real event that fires
#                                       on prompt submission is UserPromptSubmit.
#                                       Using the fictitious name would have made
#                                       this hook silently never fire. Corrected here
#                                       to the verified name.)
#   stop        (Stop)               -> drain every open marker for this session and
#                                       emit one attributed row per marker, using the
#                                       CURRENT transcript line count as the shared
#                                       end boundary. Stop is a verified post-model
#                                       boundary: it is the same hook
#                                       metrics-stop-dispatch.sh already relies on to
#                                       read a turn's tokens, so pairing a skill/
#                                       prompt start marker with the next Stop event
#                                       captures the model's actual work product,
#                                       not just tool-call overhead.
#
# Documented limit (still open — HONESTY GATE, not swept under the rug): Stop fires
# once per agent TURN, not once per multi-phase skill RUN. A single `/plan`
# invocation can span many turns (planning, grilling, story emission, ...). This
# hook closes the marker at the FIRST Stop after the matching start, so it
# accurately attributes the turn in which the skill/command was invoked, but a
# multi-turn run's later turns are NOT re-opened or re-attributed to the same
# run_id — they fall through to the legacy whole-turn bundle
# (metrics-stop-dispatch.sh) uncorrelated to the skill. No Claude Code hook signals
# "this skill's multi-turn run is now fully complete" (skills are prompt text, not a
# process with a close event), so a true multi-phase run boundary could not be
# established with the hook primitives available; this is a real, load-bearing gap,
# not an oversight, and is called out again in the spike doc.
#
# Sibling-invocation note: if a single turn invokes more than one Skill tool call,
# each pushes its own marker; `stop` drains the whole stack and each marker's row
# spans from ITS OWN start line to the shared end line, so a later sibling's window
# is a subset of an earlier sibling's — same class of overlap the spike doc already
# documents for skill-calls-skill nesting, just extended to same-turn siblings.
#
# Fire-and-forget (D4 parity with sibling metrics hooks): always exits 0,
# every step degrades to a no-op rather than blocking the calling tool call/turn.
#
# Usage:
#   metrics-skill-token-capture.sh --phase pre|promptstart|stop
# Reads the corresponding hook JSON payload from stdin.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HIVE_ROOT="${HIVE_ROOT:-${CLAUDE_PROJECT_DIR:-$PLUGIN_ROOT}}"
. "$PLUGIN_ROOT/hooks/common.sh"
CONFIG_FILE="${CONFIG_FILE:-$HIVE_ROOT/hive.config.yaml}"

trap 'exit 0' ERR

_read_metrics_config() {
  local key="$1"
  local default="$2"
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "$default"
    return
  fi
  local val=""
  if command -v yq &>/dev/null; then
    val=$(yq ".metrics.${key}" "$CONFIG_FILE" 2>/dev/null | tr -d ' "' || true)
  elif command -v python3 &>/dev/null; then
    val=$(python3 - "$CONFIG_FILE" "$key" <<'PYEOF'
import sys
try:
    import yaml
    with open(sys.argv[1]) as f:
        c = yaml.safe_load(f)
    v = c.get('metrics', {}).get(sys.argv[2], '')
    if v is not None and str(v) != '':
        print(str(v).lower() if isinstance(v, bool) else str(v))
except Exception:
    pass
PYEOF
    )
  else
    val=$(awk '/^metrics:/{flag=1; next} /^[a-zA-Z]/{flag=0} flag && /^[[:space:]]+'"$key"':/' "$CONFIG_FILE" \
      | head -1 | sed 's/[^:]*:[[:space:]]*//' | tr -d ' "')
  fi
  if [ -z "${val:-}" ] || [ "$val" = "null" ]; then
    echo "$default"
  else
    echo "$val"
  fi
}

METRICS_ENABLED=$(_read_metrics_config "enabled" "false")
METRICS_ENABLED=$(echo "$METRICS_ENABLED" | awk '{print $1}')
if [ "$METRICS_ENABLED" != "true" ]; then
  exit 0
fi

PHASE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --phase) PHASE="$2"; shift 2 ;;
    *) shift ;;
  esac
done
case "$PHASE" in
  pre|promptstart|stop) ;;
  *) exit 0 ;;
esac

HOOK_INPUT=$(cat 2>/dev/null || echo "{}")
SESSION_ID=$(echo "$HOOK_INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo "")
TRANSCRIPT_PATH=$(echo "$HOOK_INPUT" | jq -r '.transcript_path // ""' 2>/dev/null || echo "")
HOOK_CWD=$(echo "$HOOK_INPUT" | jq -r '.cwd // ""' 2>/dev/null || echo "$HIVE_ROOT")

[ -z "$SESSION_ID" ] && exit 0

_resolve_main_jsonl() {
  if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    echo "$TRANSCRIPT_PATH"
    return
  fi
  local base="${HOOK_CWD:-$HIVE_ROOT}"
  local encoded_cwd
  encoded_cwd=$(echo "$base" | sed 's|^/||' | sed 's|[^a-zA-Z0-9-]|-|g')
  local candidate="$HOME/.claude/projects/$encoded_cwd/$SESSION_ID.jsonl"
  [ -f "$candidate" ] && echo "$candidate"
}

MAIN_JSONL=$(_resolve_main_jsonl)
[ -z "$MAIN_JSONL" ] && exit 0

STATE_DIR=$(_resolve_state_dir)
METRICS_DIR="$STATE_DIR/metrics"
EVENTS_DIR="$METRICS_DIR/events"
MARKERS_DIR="$METRICS_DIR/.skill-markers"
mkdir -p "$EVENTS_DIR" "$MARKERS_DIR" || exit 0
STACK_FILE="$MARKERS_DIR/${SESSION_ID}.jsonl"

STORY_ID="${HIVE_STORY_ID:-${HIVE_SWARM_ID:-unscoped}}"

# Extract the invoked skill name for a direct slash-command prompt, e.g.
# "/plan the auth epic" -> "plan". Returns empty for a non-slash prompt (not a
# skill invocation at all — most user prompts).
_slash_command_skill() {
  local prompt="$1"
  case "$prompt" in
    /*)
      local rest="${prompt#/}"
      echo "${rest%% *}"
      ;;
    *)
      echo ""
      ;;
  esac
}

if [ "$PHASE" = "pre" ] || [ "$PHASE" = "promptstart" ]; then
  if [ "$PHASE" = "pre" ]; then
    SKILL_NAME=$(echo "$HOOK_INPUT" | jq -r '.tool_input.skill // .tool_input.name // "unknown-skill"' 2>/dev/null || echo "unknown-skill")
    SOURCE="tool"
  else
    PROMPT_TEXT=$(echo "$HOOK_INPUT" | jq -r '.prompt // .message // ""' 2>/dev/null || echo "")
    SKILL_NAME=$(_slash_command_skill "$PROMPT_TEXT")
    # Not a slash command -> not a skill invocation; nothing to mark.
    [ -z "$SKILL_NAME" ] && exit 0
    SOURCE="prompt"
  fi

  BEFORE_LINES=$(wc -l < "$MAIN_JSONL" 2>/dev/null | tr -d ' ' || echo 0)
  BEFORE_LINES=${BEFORE_LINES:-0}
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  RUN_ID="run_skill_${SKILL_NAME}_${SESSION_ID}_${TS}_$$"
  RUN_ID=$(echo "$RUN_ID" | tr -c 'a-zA-Z0-9_-' '_')
  jq -cn \
    --arg skill "$SKILL_NAME" \
    --argjson before "$BEFORE_LINES" \
    --arg run_id "$RUN_ID" \
    --arg ts "$TS" \
    --arg source "$SOURCE" \
    '{skill: $skill, before_lines: $before, run_id: $run_id, ts: $ts, source: $source}' \
    >> "$STACK_FILE" 2>/dev/null || true
  exit 0
fi

# --phase stop: drain every open marker for this session (a single Stop event
# can close more than one sibling marker opened in the same turn) and emit one
# attributed event per marker.
[ -f "$STACK_FILE" ] || exit 0

AFTER_LINES=$(wc -l < "$MAIN_JSONL" 2>/dev/null | tr -d ' ' || echo 0)
AFTER_LINES=${AFTER_LINES:-0}

MARKERS=$(cat "$STACK_FILE" 2>/dev/null || echo "")
: > "$STACK_FILE" 2>/dev/null || true

[ -z "$MARKERS" ] && exit 0

while IFS= read -r MARKER; do
  [ -z "$MARKER" ] && continue

  BEFORE_LINES=$(echo "$MARKER" | jq -r '.before_lines // 0')
  RUN_ID=$(echo "$MARKER" | jq -r '.run_id // ""')
  MARKER_SKILL=$(echo "$MARKER" | jq -r '.skill // "unknown-skill"')
  [ -z "$RUN_ID" ] && continue

  if [ "$AFTER_LINES" -le "$BEFORE_LINES" ]; then
    STATS='{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","has_rows":false}'
    DELTA_LINES=0
  else
    DELTA_LINES=$((AFTER_LINES - BEFORE_LINES))
    STATS=$(sed -n "$((BEFORE_LINES + 1)),${AFTER_LINES}p" "$MAIN_JSONL" 2>/dev/null | jq -c -s '
      [.[] | select(.type == "assistant" and .isSidechain == false and .message.usage != null)]
      | if length == 0 then
          {input_tokens:0, output_tokens:0, cache_creation_input_tokens:0, cache_read_input_tokens:0, model:"unknown", has_rows:false}
        else
          {
            input_tokens:                (map(.message.usage.input_tokens // 0) | add),
            output_tokens:               (map(.message.usage.output_tokens // 0) | add),
            cache_creation_input_tokens: (map(.message.usage.cache_creation_input_tokens // 0) | add),
            cache_read_input_tokens:     (map(.message.usage.cache_read_input_tokens // 0) | add),
            model:                       ([.[].message.model] | unique | join(",")),
            has_rows:                    true
          }
        end
    ' 2>/dev/null || echo '{"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"model":"unknown","has_rows":false}')
  fi

  IN=$(echo "$STATS" | jq -r '.input_tokens // 0')
  OUT=$(echo "$STATS" | jq -r '.output_tokens // 0')
  CC=$(echo "$STATS" | jq -r '.cache_creation_input_tokens // 0')
  CR=$(echo "$STATS" | jq -r '.cache_read_input_tokens // 0')
  MDL=$(echo "$STATS" | jq -r '.model // "unknown"')
  TOTAL=$((IN + OUT))
  TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  EVENT_ID="evt_${TS}_$$_${RANDOM}_skilltoken"

  OUTPUT_FILE="$EVENTS_DIR/token-skill-${SESSION_ID}.jsonl"

  jq -cn \
    --arg event_id "$EVENT_ID" \
    --arg ts "$TS" \
    --arg run_id "$RUN_ID" \
    --arg story_id "$STORY_ID" \
    --arg skill "${MARKER_SKILL}" \
    --argjson value "$TOTAL" \
    --arg model "$MDL" \
    --argjson input_t "$IN" \
    --argjson output_t "$OUT" \
    --argjson cache_c "$CC" \
    --argjson cache_r "$CR" \
    --argjson delta_lines "$DELTA_LINES" \
    '
      {
        event_id: $event_id,
        timestamp: $ts,
        run_id: $run_id,
        story_id: $story_id,
        metric_type: "tokens",
        agent: ("skill:" + $skill),
        value: $value,
        unit: "tokens",
        dimensions: {
          attribution: "skill_boundary",
          skill: $skill,
          model: $model,
          input_tokens: $input_t,
          output_tokens: $output_t,
          cache_creation_input_tokens: $cache_c,
          cache_read_input_tokens: $cache_r,
          lines_delta: $delta_lines
        },
        source: "skill-boundary-capture"
      }
    ' >> "$OUTPUT_FILE" 2>/dev/null || true
done <<< "$MARKERS"

exit 0
