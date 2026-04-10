# Linear Integration — Per-Phase Operations

How the orchestrator and agents interact with Linear during each phase of the daily ceremony. For the full adapter interface and CLI commands, see `task-tracking-adapter.md`. For copy-paste commands, see `linear-commands.md`.

All placeholder values (`{TEAM}`, `{PROJECT}`, `{PREFIX}`, `{USER_ID}`) come from `hive.config.yaml` → `task_tracking`.

## Phase: Standup

**Goal:** Present the board state. Surface blockers.

1. Query all issues: `linearis issues search "" --project "{PROJECT}" --team {TEAM} --limit 50`
2. Group by status (Backlog / Todo / In Progress / In Review / Done)
3. Identify blockers: issues with `human-intervention` label + non-Done status
4. Identify recently resolved: issues moved to Done since last standup
5. Compare against previous cycle state to detect changes

**Board view format:**
```
STANDUP BOARD — {PROJECT}
Backlog (3)  │ Todo (2)       │ In Progress (1)   │ In Review (1)  │ Done (5)
{TEAM}-60    │ {TEAM}-52      │ {TEAM}-51 [locked] │ {TEAM}-48      │ {TEAM}-45
{TEAM}-61    │ {TEAM}-53      │                    │                │ {TEAM}-46

BLOCKERS: {TEAM}-49 (human-intervention, P1, assigned)
RESOLVED SINCE LAST STANDUP: {TEAM}-44, {TEAM}-47
```

## Phase: Planning

**Goal:** Create Linear tickets for the epic and stories.

1. Create epic parent: `createEpicParent("Epic: {id} — {title}", description)`
2. Record `epic_issue_id` in cycle state
3. For each story: `createStoryIssue(title, description, epic_issue_id)`
4. Record each `stories.{id}.issue_id` in cycle state
5. All stories start as `Todo`

**Hierarchy created:**
```
{TEAM}-40: Epic: {epic-id} — {title} (epic-parent)
  ├── {TEAM}-41: {story-1-title} (story, Todo)
  ├── {TEAM}-42: {story-2-title} (story, Todo)
  └── {TEAM}-43: {story-3-title} (story, Todo)
```

## Phase: Execution

**Goal:** Claim tickets, create branches, start work.

1. For the story being executed:
   - `claimIssue(issueId, userId)` — check assignee, assign, move to In Progress
   - Create branch: `git checkout -b {PREFIX}-{N}-{slug}`
   - Record branch name in cycle state
2. Update cycle state: status = "In Progress", assignee = userId, branch = name
3. If the story is handled by a team lead who spawns teammates, the lead holds the lock — teammates don't individually claim tickets

## Phase: Commit

**Goal:** Reference ticket in commit message for traceability.

```bash
git commit -m "feat: {description}

Refs: {TEAM}-{N}"
```

Linear detects `{TEAM}-{N}` in commits and links them to the issue. No linearis command needed.

## Phase: Test Handoff

**Goal:** Signal that development is done, testing is starting.

```bash
linearis issues update {TEAM}-{N} --status "In Review"
```

Update cycle state: `stories.{id}.status = "In Review"`.

## Phase: Fix Loop

**Goal:** Create bug tickets for test failures, close them when fixed.

For each test failure:
1. `createBugIssue(title, description, parentStoryId, priority)` — bug as sub-issue under the story
2. Record bug in cycle state `linear.bugs[]`

After fixing:
1. Commit the fix: `git commit -m "fix: {description}\n\nFixes: {TEAM}-{bug-N}"`
2. `linearis issues update {TEAM}-{bug-N} --status "Done"`
3. Update cycle state bug entry

**Terminal issues** (can't be fixed by dev):
1. `linearis issues update {TEAM}-{N} --labels "bug,human-intervention" --priority 1`
2. `linearis comments create {TEAM}-{N} --body "BLOCKED: {what was tried, why it can't be fixed, what human needs to do}"`
3. Mark story as BLOCKED in cycle state
4. Notify user directly

## Phase: Final Review

**No Linear operations.** This is a code review gate — the reviewer evaluates the diff. Linear status stays "In Review" until push.

## Phase: Push

**Goal:** Push triggers GitHub auto-link and merge auto-closes.

1. Push the branch: `git push -u origin {PREFIX}-{N}-{slug}`
2. Linear's GitHub integration auto-links the PR to `{TEAM}-{N}`
3. When PR merges: Linear auto-moves the issue to Done
4. **No linearis command needed** — GitHub native integration handles this

## Phase: Session End

**Goal:** Clean up assignments, surface unresolved items.

1. For completed stories: `releaseIssue(issueId)` — clear assignee
2. For blocked stories: leave assigned + human-intervention label (surfaces in next standup)
3. Update cycle state with final statuses
4. Run `linearis issues search "" --project "{PROJECT}" --team {TEAM} --status "In Progress"` — anything still In Progress is an anomaly to flag

## GitHub Native Integration Setup

**One-time manual setup in Linear:**

1. Go to **Settings → Integrations → GitHub**
2. Click **Connect** and authorize Linear for your GitHub account
3. Select repositories that Hive will manage
4. Enable **Auto-link Pull Requests** — Linear detects `{TEAM}-{N}` in branch names and PR descriptions
5. Enable **Auto-close Issues on Merge** — when a linked PR merges, the Linear issue moves to Done
6. **Verify:** Create a test branch `{PREFIX}-5-test`, push it, check that Linear shows the link

**Branch naming is critical.** The branch MUST contain the issue identifier (e.g., `{PREFIX}-42-feature-name`). Without it, Linear can't auto-link.
