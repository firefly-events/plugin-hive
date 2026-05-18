# Project Maturity Heuristic

Hive captures a `project_maturity` field on every kickoff and persists it to
`.pHive/project-profile.yaml`. The field tells maturity-aware skills (today:
`/meta-optimize`) whether the project has enough signal for metric-driven
recommendations to be meaningful.

Four levels are defined. Use this doc when:

- kickoff asks the user to classify the project,
- a downstream skill (e.g. `/meta-optimize`) re-prompts because the field is
  missing,
- a maintainer wants to revisit the classification by hand.

## Levels

| Level | Signal threshold | What it means |
|-------|------------------|---------------|
| `greenfield` | no source code yet, or only scaffolding | Project hasn't shipped any feature work. Metrics have no baseline to compare against. |
| `early` | some code, no production deploy, limited or no test suite | Project is being built. Metrics are noisy because the surface area is changing every cycle. |
| `established` | shipped to production, has a test suite, regular contributor activity | Project has a stable enough surface that metric-driven recommendations carry signal. |
| `mature` | production for 6+ months, ≥40% test coverage, multi-contributor history, low churn on the public surface | Project's behavior is well understood. Full metric registry is meaningful. |

## Heuristic — answer these four questions

Pick the level that matches the **majority** of answers. When two levels tie,
pick the lower one (greenfield > early > established > mature) — under-claiming
maturity is safer than over-claiming, since maturity-aware skills withhold
recommendations at the low end rather than over-recommending at the high end.

1. **Deployed to production?**
   - no → `greenfield` or `early`
   - yes, recently → `established`
   - yes, ≥6 months → `mature`

2. **Lines of code (source only, exclude vendor/lockfiles)?**
   - <1k → `greenfield`
   - 1k–10k → `early`
   - 10k–100k → `established`
   - >100k → `mature`

3. **Test coverage?**
   - no tests → `greenfield` or `early`
   - some tests, no coverage measurement → `early`
   - tests exist with measured coverage <40% → `established`
   - coverage ≥40% and a CI gate enforces it → `mature`

4. **Age (first commit to today)?**
   - <1 month → `greenfield`
   - 1–6 months → `early`
   - 6–24 months → `established`
   - >24 months → `mature`

## Worked examples

- A fresh `npm init` repo with a README and one config file: **greenfield**.
- A 3-month-old startup MVP with 5k LOC, no production users, integration
  tests partially written: **early**.
- A 14-month-old internal tool with 30k LOC, deployed to staging+prod, 25%
  test coverage, four contributors: **established**.
- A 4-year-old library with 80k LOC, 70% test coverage enforced in CI, used
  by 12 downstream projects: **mature**.

## How `/meta-optimize` uses this

- `greenfield`, `early` → meta-optimize stops with a "gather signal first"
  guidance message instead of recommending metrics. The user can still run
  the cycle in `backlog` mode (human-curated proposals) — the gate is only
  on the metric-driven recommendation path.
- `established`, `mature` → meta-optimize runs the full metric-aware
  recommendation cycle as today.
- field absent → meta-optimize prompts the user to classify once, persists
  the answer to `project-profile.yaml`, then continues with the chosen
  branch.

## Re-classification

Maturity is not immutable. A project moves through levels as it ships,
accumulates tests, and stabilizes its public surface. Re-run `/kickoff` (or
edit `.pHive/project-profile.yaml` directly) to update the field. There is
no automatic promotion — the user owns the classification.
