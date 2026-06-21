# Reconcile Step (Review)

## Purpose

Materialise the reviewer's committed review artifact into the working tree before
the downstream gate evaluates it. Invokes `cli.mjs reconcile` to fast-forward-merge
the reviewer's branch commit so the gate provably validates real committed files
(R5 contract).

## Inputs

| Name       | Source      | Required | Notes                                        |
|------------|-------------|----------|----------------------------------------------|
| `sha`      | step_output | optional | Commit SHA from the upstream reviewer node.  |
| `branch`   | context     | optional | Branch the reviewer committed to.            |
| `repo`     | context     | optional | Git remote repository URL.                   |
| `work_dir` | context     | optional | Local working-tree path override.            |

## Behaviour

- **sha absent or empty**: clean no-op. Work is already in the tree (local binding).
- **sha present**: runs `cli.mjs reconcile --repo … --branch … --sha …`. Non-fast-forward
  or CLI error raises `ReconcileHandlerError` — the downstream gate must NOT run against
  a stale tree.

## Outputs

| Name               | Type   | Notes                               |
|--------------------|--------|-------------------------------------|
| `reconcile_status` | string | `"noop"` (local) or JSON from CLI.  |
