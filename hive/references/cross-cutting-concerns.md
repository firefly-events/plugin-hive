# Cross-Cutting Concerns

Cross-cutting concerns are project-specific requirements that apply to every (or most) stories — things like caching strategy, data migrations, analytics, test infrastructure, and accessibility. They're configured per-project and injected into planning and implementation.

## How It Works

1. **Project configuration:** Each project defines its concerns in `cross-cutting-concerns.yaml` at `.pHive/cross-cutting-concerns.yaml`. This file is loaded during `/hive:plan` and `/hive:execute`.

2. **During planning (`/hive:plan`):** The analyst and architect agents receive the concerns as context. For each story, they evaluate which concerns apply and add a `cross_cutting` section to the story YAML listing the relevant concerns and what actions they require.

3. **During execution (`/hive:execute`):** The developer, tester, and reviewer agents receive the active concerns for their story. Concerns become part of the acceptance criteria — a story isn't done until its concerns are addressed.

4. **Agent-ready checklist:** Check #9 (new) validates that all applicable cross-cutting concerns have been addressed in the story spec.

## Configuration File

Place `cross-cutting-concerns.yaml` at `.pHive/cross-cutting-concerns.yaml`. Hive loads it during plan and execute commands.

```yaml
# cross-cutting-concerns.yaml
# Project-specific cross-cutting concerns for Hive story planning and execution.
# Each concern is evaluated per-story during planning. The analyst marks which
# apply and what action is needed.

concerns:

  - id: caching
    name: Cache Strategy
    description: >
      Evaluate whether this story's data should be cached. Consider read
      frequency, data freshness requirements, and cache invalidation.
    applies_when: "Story involves data fetching, API calls, or repeated reads"
    planning_prompt: >
      Does this story fetch data that could be cached? If yes, specify:
      cache layer (in-memory, disk, Redis), TTL, and invalidation strategy.
    implementation_checklist:
      - "Cache layer identified (or explicitly marked as no-cache-needed)"
      - "TTL defined for cached data"
      - "Cache invalidation on data mutation implemented"

  - id: data-migration
    name: Data Schema Migration
    description: >
      If the story changes data models, a migration is needed. This applies
      to both backend databases and local storage schemas.
    applies_when: "Story adds, removes, or modifies fields on a data model"
    planning_prompt: >
      Does this story change any data model? If yes, specify: which models,
      what changes, migration type (additive/destructive), rollback strategy.
    implementation_checklist:
      - "Migration file created (if schema changed)"
      - "Rollback strategy documented"
      - "Existing data handled (backfill or default values)"

  - id: analytics
    name: Analytics Instrumentation
    description: >
      New user-facing features need analytics events. Define what to track
      before implementation so events ship with the feature.
    applies_when: "Story adds user-facing UI, interactions, or flows"
    planning_prompt: >
      What user actions in this story should be tracked? Define event names,
      properties, and which analytics service receives them.
    implementation_checklist:
      - "Analytics events defined (name, properties)"
      - "Events instrumented in code"
      - "Events verified in analytics dashboard or logs"

  - id: test-tags
    name: Test Accessibility Tags
    description: >
      UI components need test identifiers so automated test frameworks
      (Maestro, MTS, Appium) can find and interact with them.
    applies_when: "Story creates or modifies UI components"
    planning_prompt: >
      Which new UI components need test tags? Define tag naming convention
      and ensure all interactive elements are tagged.
    implementation_checklist:
      - "All new interactive UI components have testTag/accessibilityIdentifier"
      - "Tag names follow project convention"
      - "Maestro/MTS flows can locate all new components by tag"

  - id: accessibility
    name: Accessibility Standards
    description: >
      All UI must meet WCAG 2.1 AA. This includes contrast ratios, touch
      targets, screen reader labels, and semantic structure.
    applies_when: "Story creates or modifies UI components"
    planning_prompt: >
      Does this story meet WCAG 2.1 AA? Check: contrast ratios, touch
      targets (min 44×44), screen reader labels, focus order.
    implementation_checklist:
      - "Contrast ratios meet WCAG AA (4.5:1 text, 3:1 large text)"
      - "Touch targets minimum 44×44px"
      - "Screen reader labels on all non-text elements"
      - "Logical focus/tab order"

  - id: maestro-test
    name: Maestro Test Flow
    description: >
      Every ticket must have a Maestro test flow that exercises the
      feature on a real device.
    applies_when: "Story adds or changes user-facing behavior"
    planning_prompt: >
      What Maestro flow is needed? Define the user journey to test,
      expected assertions, and device target.
    implementation_checklist:
      - "Maestro flow file created in .maestro/"
      - "Flow exercises the primary user journey"
      - "Assertions verify expected outcomes"
      - "Flow runs successfully on connected device"
```

## Integration Points

### During `/hive:plan`

The analyst agent reads `cross-cutting-concerns.yaml` and for each story:

1. Evaluates each concern's `applies_when` condition against the story
2. For applicable concerns, runs the `planning_prompt` to determine specific actions
3. Adds a `cross_cutting` section to the story YAML:

```yaml
cross_cutting:
  - concern: caching
    action: "Cache event list in-memory with 5min TTL, invalidate on event create/update"
  - concern: test-tags
    action: "Add testTag to EventCard, CategoryChip, CreateEventButton"
  - concern: accessibility
    action: "Ensure category chip carousel meets contrast and touch target minimums"
  - concern: maestro-test
    action: "Create flow: open events → select category → verify filtered results"
```

### During `/hive:execute`

The developer agent sees the `cross_cutting` section alongside acceptance criteria. Each concern's `implementation_checklist` items become additional acceptance criteria for the story.

The reviewer agent validates that all cross-cutting checklist items are addressed.

### Agent-Ready Checklist

Added as check #9:

| # | Check | What to look for |
|---|-------|-----------------|
| 9 | **Cross-cutting concerns** | Are all applicable concerns identified in `cross_cutting` section? Are actions specific (not just "handle caching")? |

## Customization

The concerns YAML is project-specific. Different projects have different concerns:

- **Mobile app:** caching, migrations, analytics, test-tags, accessibility, maestro (see `examples/cross-cutting-concerns.mobile-app.yaml` for a complete sample)
- **Web SaaS:** caching, migrations, analytics, accessibility, SEO, rate-limiting
- **API service:** caching, migrations, logging, rate-limiting, auth-scopes
- **CLI tool:** none (or just "test coverage")

The analyst agent evaluates `applies_when` per-story — not every concern applies to every story. A pure backend story won't trigger accessibility or test-tags.
