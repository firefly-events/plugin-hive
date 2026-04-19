#!/bin/bash
# check-agent-misuse.sh — PreToolUse hook for Agent tool
#
# Detects when the orchestrator is likely using Agent to execute
# full stories (should use TeamCreate instead). Checks the Agent
# tool_input.prompt for story-level delegation patterns.
#
# Exit codes:
#   0 = allow (no story-level patterns detected)
#   2 = block (story-level Agent misuse detected)

set -euo pipefail

input=$(cat)

tool_name=$(echo "$input" | jq -r '.tool_name // ""')

# Only check Agent calls
if [ "$tool_name" != "Agent" ]; then
  exit 0
fi

prompt=$(echo "$input" | jq -r '.tool_input.prompt // ""')
description=$(echo "$input" | jq -r '.tool_input.description // ""')

# Pattern 1: Agent prompt references story YAML paths (story-level work)
if echo "$prompt" | grep -qiE '.pHive/epics/[^/]+/stories/[^/]+\.yaml'; then
  # Check if it's a single story being fully delegated
  story_count=$(echo "$prompt" | grep -oiE '.pHive/epics/[^/]+/stories/[^/]+\.yaml' | sort -u | wc -l | tr -d ' ')
  if [ "$story_count" -ge 1 ]; then
    # Check for workflow execution signals (not just reading a story for context)
    if echo "$prompt" | grep -qiE '(execute.*stor|implement.*stor|workflow.*phase|development.*workflow|research.*implement.*test|review.*integrate)'; then
      echo "BLOCKED: Agent tool used to execute story-level work. Use TeamCreate for story execution." >&2
      echo "Detected $story_count story reference(s) with workflow execution patterns." >&2
      echo "The orchestrator must delegate stories via TeamCreate, not Agent." >&2
      exit 2
    fi
  fi
fi

# Pattern 2: Agent prompt contains epic execution language
if echo "$prompt" | grep -qiE '(execute.*epic|epic.*execution|execute all stories|run the stories)'; then
  echo "BLOCKED: Agent tool used for epic-level execution. Use TeamCreate instead." >&2
  echo "The orchestrator delegates epics and stories via TeamCreate, not Agent." >&2
  exit 2
fi

# Pattern 3: Description indicates whole-story delegation.
# Narrow to explicit whole-story phrasing so legitimate sub-step Agent calls
# (e.g. "implement story checkout-123 test step") are not blocked. The allowed
# `Agent` path documented in SKILL.md is "Sequential workflow steps within a
# single story" — those descriptions name the step, not the whole story.
if echo "$description" | grep -qiE '(story execution|execute (the )?(entire|full|whole) story|run (the )?(entire|full|whole) story|implement (the )?(entire|full|whole) story|execute all steps)'; then
  echo "BLOCKED: Agent description indicates whole-story delegation. Use TeamCreate." >&2
  exit 2
fi

# No misuse patterns detected — allow
exit 0
