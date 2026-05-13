// Smoke test against a real GitHub repo via the loaded adapter.
//
// SKIP when GITHUB_TEST_REPO (`owner/repo`) or GITHUB_TOKEN is unset — this
// script is meant to be invoked manually after wiring credentials. CI does
// not run it by default.
//
// Usage:
//   GITHUB_TEST_REPO=owner/repo GITHUB_TOKEN=ghp_xxx \
//     node hive/lib/task-tracking-dispatch/test/smoke-github.mjs

import { TaskTrackingDispatch } from "../index.ts";

if (!process.env.GITHUB_TEST_REPO || !process.env.GITHUB_TOKEN) {
  console.log("SKIP: GITHUB_TEST_REPO and GITHUB_TOKEN required");
  process.exit(0);
}

const [owner, repo] = process.env.GITHUB_TEST_REPO.split("/");
if (!owner || !repo) {
  console.error(
    `GITHUB_TEST_REPO must be 'owner/repo'; got: ${process.env.GITHUB_TEST_REPO}`,
  );
  process.exit(2);
}

const d = new TaskTrackingDispatch();
await d.load({
  adapter: "github",
  state_dir: "/tmp/hive-smoke",
  github: { token: process.env.GITHUB_TOKEN },
});

const create = await d.invoke(
  "createStory",
  {
    title: `Hive smoke test ${new Date().toISOString()}`,
    body: "Created by c-5b smoke test. Safe to delete.",
    labels: [],
    team_value: owner,
    project_value: repo,
  },
  { skill_context: "smoke-github" },
);

console.log("createStory:", JSON.stringify(create, null, 2));
if (!create.ok) process.exit(1);

const storyId = create.result.id;

const update = await d.invoke(
  "updateStatus",
  { id: storyId, state: "closed" },
  { skill_context: "smoke-github" },
);

console.log("updateStatus:", JSON.stringify(update, null, 2));
if (!update.ok) process.exit(1);

console.log("Smoke test PASSED");
