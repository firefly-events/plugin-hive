#!/usr/bin/env node
// plan-agnostic.mjs — runner-agnostic PLAN entrypoint.
//
// The Claude-Code slash command `/plugin-hive:plan` is a Claude-only *skill*: gemini/codex
// never load it, so they IMPLEMENT instead of DECOMPOSE and write zero .pHive YAML. This CLI
// is the port: given an idea, it feeds the DECOMPOSE contract (plan-decompose.prompt.md) to
// ANY runtime via the adapters and lets that model WRITE `.pHive/epics/<id>/epic.yaml` +
// `stories/*.yaml` — the exact filesystem fact Minerva files to Multica.
//
// Usage:
//   node plan-agnostic.mjs --runtime <gemini|codex|claude|...> --model <provider/model> \
//        --cwd <dir> (--idea "<requirement>" | --prompt "<raw>") [--session <id>] \
//        [--epic-id <id>] [--target-codebase <abs>] [--timeout-ms <n>]
//   node plan-agnostic.mjs --print-prompt --idea "<requirement>" [--epic-id <id>]   # dry run
//
// On a first turn pass --idea (or a `/plugin-hive:plan <idea>` string via --prompt): the idea
// is wrapped in the DECOMPOSE contract. On a continuation turn pass --session <id> --prompt
// "<raw answer>": the raw prompt continues the existing session verbatim.
//
// Prints one JSON line to stdout: {"session_id": "...", "result": "..."}.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRunArgs, parseRunOutput } from "./adapters.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_TEMPLATE_PATH = join(__dirname, "plan-decompose.prompt.md");
const DEFAULT_TIMEOUT_MS = Number(process.env.PLAN_AGNOSTIC_TIMEOUT_MS || 600_000);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const boolFlags = new Set(["print-prompt", "dry-run"]);
    if (boolFlags.has(key)) {
      out[key] = true;
    } else {
      out[key] = argv[++i];
    }
  }
  return out;
}

// Strip a `/plugin-hive:plan <idea> --flags` wrapper down to the bare idea, so Minerva's
// existing buildDrivePrompt() output works unchanged on the agnostic path.
export function extractIdeaFromPrompt(prompt) {
  let s = String(prompt ?? "").trim();
  s = s.replace(/^\/(plugin-hive:|hive:)?plan\s+/i, "");
  // Drop trailing `--flag` / `--flag value` tokens (planning flags carry no idea content).
  s = s.replace(/\s--[a-z0-9-]+(\s+[^\s-][^\s]*)?/gi, "").trim();
  return s;
}

export function buildDecomposePrompt({ idea, epicId, targetCodebase }) {
  const template = readFileSync(PROMPT_TEMPLATE_PATH, "utf8");
  return template
    .replace(/__IDEA__/g, idea || "")
    .replace(/__EPIC_ID__/g, epicId || "")
    .replace(/__TARGET_CODEBASE__/g, targetCodebase || "");
}

function spawnRuntime({ cmd, args, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (signal) return reject(new Error(`${cmd} killed by ${signal}${stderr ? `: ${stderr.slice(-500)}` : ""}`));
      if (code !== 0) return reject(new Error(`${cmd} exited ${code}${stderr ? `: ${stderr.slice(-500)}` : ""}`));
      resolve(stdout);
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const isContinuation = Boolean(opts.session);

  // Resolve the turn prompt.
  let prompt;
  if (isContinuation) {
    prompt = opts.prompt ?? opts.idea ?? "";
    if (!prompt) throw new Error("continuation turn requires --prompt");
  } else {
    const rawIdea = opts.idea ?? (opts.prompt ? extractIdeaFromPrompt(opts.prompt) : "");
    if (!rawIdea) throw new Error("initial turn requires --idea (or a /plugin-hive:plan --prompt)");
    const cwd = opts.cwd || process.cwd();
    const targetCodebase = opts["target-codebase"] || (isAbsolute(cwd) ? cwd : process.cwd());
    prompt = buildDecomposePrompt({ idea: rawIdea, epicId: opts["epic-id"], targetCodebase });
  }

  if (opts["print-prompt"] || opts["dry-run"]) {
    process.stdout.write(prompt);
    return;
  }

  const runtime = opts.runtime || "claude";
  const { cmd, args } = buildRunArgs({
    runtime,
    model: opts.model,
    prompt,
    sessionId: opts.session || null,
    cwd: opts.cwd,
  });

  const stdout = await spawnRuntime({
    cmd,
    args,
    cwd: opts.cwd || process.cwd(),
    timeoutMs: Number(opts["timeout-ms"] || DEFAULT_TIMEOUT_MS),
  });

  const { session_id, result } = parseRunOutput({ runtime, stdout });
  process.stdout.write(JSON.stringify({ session_id, result }) + "\n");
}

// Only run when invoked directly (keeps exports importable by tests).
const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`[plan-agnostic] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
