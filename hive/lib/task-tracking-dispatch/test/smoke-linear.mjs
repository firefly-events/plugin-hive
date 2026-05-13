// Smoke test against a real Linear workspace via the loaded adapter.
//
// SKIP when LINEAR_API_KEY or LINEAR_TEST_TEAM is unset — this script is
// meant to be invoked manually after wiring credentials. CI does not run
// it by default.
//
// Usage:
//   LINEAR_API_KEY=lin_xxx LINEAR_TEST_TEAM=ENG \
//     node hive/lib/task-tracking-dispatch/test/smoke-linear.mjs

import { TaskTrackingDispatch } from "../index.ts";

if (!process.env.LINEAR_API_KEY || !process.env.LINEAR_TEST_TEAM) {
  console.log("SKIP: LINEAR_API_KEY and LINEAR_TEST_TEAM required");
  process.exit(0);
}

const team = process.env.LINEAR_TEST_TEAM;
const project = process.env.LINEAR_TEST_PROJECT ?? null;

const d = new TaskTrackingDispatch();
await d.load({
  adapter: "linear",
  state_dir: "/tmp/hive-smoke",
  linear: { api_key: process.env.LINEAR_API_KEY, team },
});

const create = await d.invoke(
  "createStory",
  {
    title: `Hive smoke test ${new Date().toISOString()}`,
    body: "Created by c-5b smoke test. Safe to delete.",
    labels: [],
    team_value: team,
    project_value: project,
  },
  { skill_context: "smoke-linear" },
);

console.log("createStory:", JSON.stringify(create, null, 2));
if (!create.ok) process.exit(1);

const storyId = create.result.id;

const update = await d.invoke(
  "updateStatus",
  { id: storyId, state: "canceled" },
  { skill_context: "smoke-linear" },
);

console.log("updateStatus:", JSON.stringify(update, null, 2));
if (!update.ok) process.exit(1);

console.log("Smoke test PASSED");
