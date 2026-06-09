---
name: step-file-output-contract-before-dag-insertion
description: Define the downstream output contract in the step file before wiring the workflow YAML — the workflow inputs map must match the step's declared output names exactly.
applies_to: developer
---

When inserting a new DAG step between two existing steps, write the step file's OUTPUT CONTRACT section first (what fields the step emits), then wire the workflow YAML inputs to those exact names. Mismatch between step file output names and workflow `output_name:` references is a silent bug — the workflow runner binds by name, not position. See `hive/workflows/steps/test-swarm/step-04b-scenario-replay.md` (output: `replay_summary`) and `hive/workflows/test-swarm.workflow.yaml` (validate-coverage input `output_name: replay_summary`).
