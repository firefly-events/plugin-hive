name: Hive dispatch

# Event-driven Hive execution. Fires when a maintainer labels an issue
# `hive:ready` (the canonical Hive trigger label). Workflow YAML owns
# the label state machine (`hive:ready` -> `hive:in-flight` ->
# `hive:shipped` | `hive:failed`) so failure transitions survive bridge
# crashes via `if: failure()`.
#
# Single-isolation-layer rule: the bridge sets HIVE_EXECUTION_MODE=team
# inside the sandcastle prompt context, preventing the inner Hive from
# spawning more sandcastles (no nested isolation, no DinD).
#
# Scaffolded by `/hive:sandcastle-gh-init`. Re-runnable; edits land in
# `.hive-dispatch/manifest.yaml`.

on:
  issues:
    types: [labeled]

permissions:
  contents: write
  issues: write
  pull-requests: write

concurrency:
  # Per-issue group: two `hive:ready` labels on the same issue queue,
  # never double-run. `cancel-in-progress: false` preserves the active
  # job — the second label simply waits.
  group: hive-issue-${{ github.event.issue.number }}
  cancel-in-progress: false

jobs:
  run:
    # Step-level guard: GitHub `on:` cannot pre-filter by label name, so
    # the label gate lives here. Combined with `issues:[labeled]` above
    # and the per-issue concurrency group, this is the triple-guard
    # against accidental fires on other `hive:*` labels.
    if: github.event.label.name == 'hive:ready'
    runs-on: {{RUNNER}}
    timeout-minutes: 60

    steps:
      - name: Claim issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          gh issue edit "$ISSUE_NUMBER" \
            --repo "${{ github.repository }}" \
            --remove-label hive:ready \
            --add-label hive:in-flight

      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install dependencies
        run: npm ci

      - name: Run Hive via sandcastle bridge
        env:
          {{SECRET_KEY}}: ${{ secrets.{{SECRET_KEY}} }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
          # Prevent the inner Hive from spawning more sandcastles. The
          # outer container is already the isolation boundary.
          HIVE_EXECUTION_MODE: team
        run: npx tsx .github/scripts/sandcastle-hive-bridge.mts

      - name: On success — ship + label
        if: success()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          BRANCH="agent/issue-${ISSUE_NUMBER}"
          # Hive may complete /execute with zero commits (idle timeout,
          # no actionable work). Pre-check the remote branch + soft-fail
          # PR creation so the label transition + comment still fire.
          if git ls-remote --exit-code --heads origin "$BRANCH"; then
            gh pr create \
              --base "${{ github.event.repository.default_branch }}" \
              --head "$BRANCH" \
              --title "Hive: #${ISSUE_NUMBER}" \
              --body "Automated /hive:execute run for #${ISSUE_NUMBER}." || true
          fi
          gh issue edit "$ISSUE_NUMBER" \
            --remove-label hive:in-flight \
            --add-label hive:shipped
          gh issue comment "$ISSUE_NUMBER" \
            --body "Hive execute completed — see PR from \`$BRANCH\`."

      - name: On failure — label + comment
        # `if: failure()` fires even when the bridge step exits non-zero
        # (missing key, agent crash, timeout). This is the load-bearing
        # invariant that prevents stuck `hive:in-flight` labels.
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: |
          gh issue edit "$ISSUE_NUMBER" \
            --remove-label hive:in-flight \
            --add-label hive:failed
          gh issue comment "$ISSUE_NUMBER" \
            --body "Hive execute failed — see workflow logs at ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}."
