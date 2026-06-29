#!/usr/bin/env python3
"""Run a single story's development.classic DAG via executor.

Usage: python3 run_story.py <story-id>
"""
import sys, os, yaml

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hive.lib.dag_executor import run as r

EPIC = "teamcreate-migration"
WORKFLOW = "hive/workflows/development.classic.workflow.yaml"
METHOD = "classic"

def run_story(story_id: str):
    story_spec_path = f".pHive/epics/{EPIC}/stories/{story_id}.yaml"
    with open(story_spec_path) as f:
        spec = yaml.safe_load(f)

    complexity = spec.get("complexity", "medium")
    run_state_path = f".pHive/dag-runs/execution/{EPIC}/{story_id}/{complexity}"

    print(f"[dag] Running story {story_id} (complexity={complexity})")
    print(f"[dag] run_state_path: {run_state_path}")

    result = r.run(
        WORKFLOW,
        binding="multica",
        flow="execution",
        context={
            "epic_id": EPIC,
            "story_id": story_id,
            "story_spec": spec,
            "methodology": METHOD,
        },
        run_state_path=run_state_path,
        repo_root="."
    )
    print(f"[dag] Story {story_id} result: {result}")
    return result

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <story-id>")
        sys.exit(1)
    run_story(sys.argv[1])
