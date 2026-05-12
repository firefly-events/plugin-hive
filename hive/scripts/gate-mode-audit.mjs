#!/usr/bin/env node
// gate-mode-audit.mjs — cross-run telemetry aggregator for paths.gate_mode flip decision.
// Reads .pHive/metrics/events/*.jsonl, applies thresholds from hive/references/gate-lift-telemetry.md,
// writes recommendation to .pHive/meta-team/gate-mode-recommendation.md when thresholds cross.
//
// Usage: node hive/scripts/gate-mode-audit.mjs [--state-dir <path>] [--window-days N] [--dry-run]

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// v1 implements gate_lift_fired thresholds only (JSONL events).
// backendDefaultsThreshold is reserved for v2 — requires parsing a-34's
// stdout backend_resolution log lines out of stop-hook transcripts, which
// is a separate pipeline (see hive/references/gate-lift-telemetry.md).
const DEFAULTS = {
  stateDir: ".pHive",
  windowDays: 30,
  gateLiftFlipThreshold: 0.20,
  backendDefaultsThreshold: 0.50, // v2 — not active in v1 aggregator
  gateLiftKeepThreshold: 0.05,
  dryRun: false,
};

function parseArgs(argv) {
  const out = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--state-dir") out.stateDir = argv[++i];
    else if (argv[i] === "--window-days") out.windowDays = parseInt(argv[++i], 10);
    else if (argv[i] === "--dry-run") out.dryRun = true;
  }
  return out;
}

// totalRuns counts unique run_id where present; falls back to stop-<uuid>
// filenames when an event lacks run_id. This biases the denominator toward
// "all sessions in window" rather than "/plan or /execute invocations only",
// which is conservative — gate_lift_rate skews LOW, so the keep-warning
// recommendation is harder to trip than the flip-to-hard one. v2 may
// narrow this by filtering stop-hook events to ones whose transcript
// references /plan or /execute invocations.
async function readEvents(stateDir, windowMs) {
  const dir = path.join(stateDir, "metrics", "events");
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { gateLifts: [], epicCreates: [], totalRuns: 0 };
  }
  const cutoff = Date.now() - windowMs;
  const gateLifts = [];
  const epicCreates = [];
  const seenRuns = new Set();
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(dir, name);
    let stat;
    try { stat = await fs.stat(full); } catch { continue; }
    if (stat.mtimeMs < cutoff) continue;
    let text;
    try { text = await fs.readFile(full, "utf8"); } catch { continue; }
    let fileHadRun = false;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      if (evt.event === "gate_lift_fired") gateLifts.push(evt);
      else if (evt.event === "epic_create_on_fly") epicCreates.push(evt);
      if (evt.run_id) { seenRuns.add(evt.run_id); fileHadRun = true; }
    }
    if (!fileHadRun && name.startsWith("stop-")) seenRuns.add(name);
  }
  return { gateLifts, epicCreates, totalRuns: seenRuns.size };
}

function buildRecommendation({ gateLifts, epicCreates, totalRuns }, thresholds) {
  if (totalRuns === 0) {
    return {
      flip: false,
      recommendations: [],
      details: { totalRuns: 0, gateLifts: 0, epicCreates: 0, gateLiftRate: 0 },
      reason: "no runs in window — insufficient data",
    };
  }
  const gateLiftRate = gateLifts.length / totalRuns;
  const recommendations = [];
  if (gateLiftRate > thresholds.gateLiftFlipThreshold) {
    recommendations.push({
      kind: "flip-to-hard",
      reason: `gate_lift_fired rate ${(gateLiftRate * 100).toFixed(1)}% > ${(thresholds.gateLiftFlipThreshold * 100).toFixed(0)}% threshold`,
    });
  } else if (gateLiftRate < thresholds.gateLiftKeepThreshold) {
    recommendations.push({
      kind: "keep-warning",
      reason: `gate_lift_fired rate ${(gateLiftRate * 100).toFixed(1)}% < ${(thresholds.gateLiftKeepThreshold * 100).toFixed(0)}% threshold — warning is safe`,
    });
  }
  return {
    flip: recommendations.some((r) => r.kind === "flip-to-hard"),
    recommendations,
    details: {
      totalRuns,
      gateLifts: gateLifts.length,
      epicCreates: epicCreates.length,
      gateLiftRate,
    },
  };
}

async function writeRecommendation(stateDir, recommendation, opts) {
  if (recommendation.recommendations.length === 0) return null;
  if (opts.dryRun) return "<dry-run>";
  const dir = path.join(stateDir, "meta-team");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, "gate-mode-recommendation.md");
  const ts = new Date().toISOString();
  const body = [
    `# Gate-Mode Recommendation`,
    ``,
    `Generated: ${ts}`,
    `Window: rolling ${opts.windowDays} days`,
    `Total runs in window: ${recommendation.details.totalRuns}`,
    `gate_lift_fired count: ${recommendation.details.gateLifts}`,
    `epic_create_on_fly count: ${recommendation.details.epicCreates}`,
    `gate_lift rate: ${(recommendation.details.gateLiftRate * 100).toFixed(1)}%`,
    ``,
    `## Recommendations`,
    ``,
    ...recommendation.recommendations.map((r) => `- **${r.kind}**: ${r.reason}`),
    ``,
    `Advisory — operator approves the flip before changing the shipped default.`,
    `See \`hive/references/gate-lift-telemetry.md\` for threshold definitions.`,
    ``,
  ].join("\n");
  await fs.writeFile(out, body, "utf8");
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  const events = await readEvents(opts.stateDir, opts.windowDays * 24 * 60 * 60 * 1000);
  const recommendation = buildRecommendation(events, opts);
  const written = await writeRecommendation(opts.stateDir, recommendation, opts);
  console.log(JSON.stringify({ ...recommendation, written }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
