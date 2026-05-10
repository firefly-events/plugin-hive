# Code Review Integration

Hive review and Anthropic Code Review (ACR) can both comment on the same
change, but they do not produce the same artifact. Hive emits a structured
change verdict for workflow routing; ACR emits inline pull-request comments for
human review in the PR surface.

## Ownership Boundary

The reviewer persona is the authority for Hive's verdict taxonomy and for the
mapping between Hive review outcomes and any external review surface. Consumers
should treat `hive/agents/reviewer.md` as the canonical source for the
`passed`, `needs_optimization`, and `needs_revision` values.

ACR may add useful line-level feedback, but it does not replace Hive's routing
contract or redefine the verdict vocabulary.

## Verdict Mapping

| Hive `change_verdict` | ACR inline comment posture | Integration meaning |
|-----------------------|----------------------------|---------------------|
| `passed` | No blocking inline findings expected; comments, if present, are informational or minor. | The change may advance through Hive's gate. |
| `needs_optimization` | Non-blocking inline suggestions and cleanup comments are expected. | The change is mergeable, but improvement work is recommended. |
| `needs_revision` | Blocking or correctness-significant inline findings are expected. | The change must not advance until the blocking issues are fixed. |

This table is interpretive, not generative: Hive does not derive its verdict by
counting ACR comments, and ACR does not become the source of truth for
`change_verdict`.

## Collision Tolerance Stance

When both Hive `/review` and ACR are enabled, surface both the Hive verdict and
the ACR inline comments, then let the user reconcile them.

This is the preferred stance because the two systems operate at different
layers: Hive owns workflow gating and explicit verdict routing, while ACR adds
PR-native, line-level context. Silent deduplication would hide evidence without
a trustworthy merge rule, and recommending that one system be disabled would
discard a useful review surface without a runtime requirement to do so.

## Practical Coexistence Rules

Treat the outputs as complementary but non-authoritative over one another:

- Hive verdicts control Hive workflow routing.
- ACR comments inform code review discussion in the PR.
- If they overlap on the same issue, keep both records visible.
- If they disagree in emphasis, resolve the discrepancy by inspecting the diff,
  not by assuming one system invalidates the other.

The operative question is not "which comment survives," but "what must change
before the branch is acceptable to advance."

## Don't Double-Run Guidance

Consumers who enable both systems should avoid asking them to perform the same
review pass twice on the same revision.

Recommended pattern:

- Use Hive `/review` when you need the local Hive verdict and workflow-facing
  gate outcome.
- Let ACR annotate the PR after the branch is pushed.
- Re-run Hive review only when the local diff changed materially.
- Re-trigger ACR only when a new PR revision needs fresh inline feedback.

This keeps each reviewer on its native surface and avoids churn from duplicate
passes that add noise without adding new signal.
