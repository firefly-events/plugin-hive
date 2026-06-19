#!/usr/bin/env node
// Bake .pHive/epics/<id>/stories/*.yaml → public/epics/<id>.json
// Browser-safe consumption via staticFile() in Remotion comps.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EPICS_DIR = path.join(REPO_ROOT, ".pHive", "epics");
const OUT_DIR = path.join(__dirname, "..", "public", "epics");

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error("usage: prebuild-epics.mjs <epicId> [epicId ...]");
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const epicId of targets) {
  const storiesDir = path.join(EPICS_DIR, epicId, "stories");
  if (!fs.existsSync(storiesDir)) {
    console.error(`skip ${epicId}: no stories dir at ${storiesDir}`);
    continue;
  }
  const files = fs
    .readdirSync(storiesDir)
    .filter((f) => f.endsWith(".yaml"))
    .sort();
  const stories = files.map((f) =>
    yaml.load(fs.readFileSync(path.join(storiesDir, f), "utf8")),
  );
  const payload = { epicId, stories };
  const outPath = path.join(OUT_DIR, `${epicId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`baked ${stories.length} stories → public/epics/${epicId}.json`);
}
