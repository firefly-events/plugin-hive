# Reconcile Step

## Purpose

Materialise the prior agent's committed work into the working tree before the downstream
gate evaluates it. Invokes `cli.mjs reconcile` to fast-forward-merge the agent's branch
commit so the gate provably validates real committed files (R5 contract).

## Inputs

| Name    | Source  | Required | Notes                                         |
|---------|---------|----------|-----------------------------------------------|
| `sha`   | context | optional | Commit SHA from the upstream Multica agent.   |
| `branch`| context | optional | Branch the agent committed to.                |
| `repo`  | context | optional | Git remote repository URL.                    |
| `work_dir` | context | optional | Local working-tree path override.          |

## Behaviour

- **sha absent or empty**: clean no-op. Work is already in the tree (local binding).
- **sha present**: runs `cli.mjs reconcile --repo … --branch … --sha …`. Non-fast-forward
  or CLI error raises `ReconcileHandlerError` — the downstream gate must NOT run against
  a stale tree.

## Outputs

| Name               | Type   | Notes                              |
|--------------------|--------|------------------------------------|
| `reconcile_status` | string | `"noop"` (local) or JSON from CLI. |
