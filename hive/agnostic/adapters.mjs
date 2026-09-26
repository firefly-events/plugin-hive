// adapters.mjs — runner-agnostic PLAN adapters.
//
// Two adapters let the ported /plugin-hive:plan DECOMPOSE flow run on ANY CLI runtime:
//
//   1. buildRunArgs()    — per-runtime ARG adapter: maps a logical planning turn
//                          ({runtime, model, prompt, sessionId, cwd}) to the concrete
//                          argv for that CLI.  claude uses `-p --model ... --output-format
//                          json`; opencode (gemini/codex/kimi/grok) uses `run --model ...
//                          --format json --auto`.
//   2. parseRunOutput()  — OUTPUT adapter: normalizes each CLI's stdout to the single
//                          shape Minerva's driver contract expects: {session_id, result}.
//                          claude emits one JSON object; opencode emits NDJSON events.
//
// Pure + dependency-free so it is unit-testable without spawning any model.

import { randomUUID } from "node:crypto";

// Logical runtimes Heimdall may route planning to, mapped to the CLI "kind" that
// actually executes them. Anything not claude runs through opencode's provider layer.
const OPENCODE_RUNTIMES = new Set(["opencode", "gemini", "codex", "kimi", "grok", "openai", "google", "xai"]);

/** Resolve a Heimdall/route runtime label to the CLI kind that runs it. */
export function resolveRuntimeKind(runtime) {
  const r = String(runtime ?? "").toLowerCase().trim();
  if (r === "claude" || r === "anthropic") return "claude";
  if (OPENCODE_RUNTIMES.has(r)) return "opencode";
  // Unknown runtime → treat as opencode provider/model passthrough (opencode accepts
  // arbitrary provider/model strings); callers that want a hard claude fallback should
  // gate on resolveRuntimeKind upstream.
  return "opencode";
}

/** Default per-kind binary; overridable via env for localized installs. */
export function runtimeBin(kind) {
  if (kind === "claude") return process.env.CLAUDE_BIN || "claude";
  return process.env.OPENCODE_BIN || "opencode";
}

/**
 * Per-runtime ARG adapter.
 * @param {{runtime:string, model?:string, prompt:string, sessionId?:string|null, cwd?:string}} input
 * @returns {{cmd:string, args:string[], kind:string}}
 */
export function buildRunArgs(input) {
  const { runtime, model, prompt, sessionId, cwd } = input;
  if (typeof prompt !== "string" || prompt.length === 0) {
    throw new Error("buildRunArgs: prompt must be a non-empty string");
  }
  const kind = resolveRuntimeKind(runtime);
  const cmd = runtimeBin(kind);

  if (kind === "claude") {
    const sessionArgs = sessionId ? ["--resume", sessionId] : ["--session-id", randomUUID()];
    const args = [
      "-p",
      ...(model ? ["--model", model] : []),
      "--output-format",
      "json",
      "--permission-mode",
      "bypassPermissions",
      ...sessionArgs,
      prompt,
    ];
    return { cmd, args, kind };
  }

  // opencode: `opencode run --model <provider/model> --format json --auto [--session <id>]
  //            [--dir <cwd>] <prompt>`.  --auto auto-approves the write-file permission so the
  //  DECOMPOSE turn can actually persist the .pHive YAML unattended.
  const args = [
    "run",
    ...(model ? ["--model", model] : []),
    "--format",
    "json",
    "--auto",
    ...(sessionId ? ["--session", sessionId] : []),
    ...(cwd ? ["--dir", cwd] : []),
    prompt,
  ];
  return { cmd, args, kind };
}

/**
 * OUTPUT adapter — normalize a runtime's stdout to {session_id, result}.
 * @param {{runtime:string, stdout:string}} input
 * @returns {{session_id:string|null, result:string}}
 */
export function parseRunOutput(input) {
  const { runtime, stdout } = input;
  const kind = resolveRuntimeKind(runtime);
  const raw = typeof stdout === "string" ? stdout : "";

  if (kind === "claude") {
    // Single JSON object: { session_id, result, ... }
    const obj = JSON.parse(raw);
    return { session_id: obj.session_id ?? null, result: obj.result ?? "" };
  }

  // opencode: NDJSON stream of events. session_id = last sessionID seen; result =
  // concatenation of the assistant `text` parts (the model's final prose). Tool-use and
  // step events are ignored for the result string (the load-bearing output is the files
  // written to disk, not this text — but we surface the text so a caller can log it and so
  // completion/question extraction has something to read).
  let sessionId = null;
  const texts = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try {
      ev = JSON.parse(t);
    } catch {
      continue; // tolerate non-JSON log noise interleaved on stdout
    }
    if (ev && typeof ev === "object") {
      if (typeof ev.sessionID === "string") sessionId = ev.sessionID;
      else if (ev.part && typeof ev.part.sessionID === "string") sessionId = ev.part.sessionID;
      if (ev.type === "text" && ev.part && typeof ev.part.text === "string") {
        texts.push(ev.part.text);
      }
    }
  }
  return { session_id: sessionId, result: texts.join("\n").trim() };
}
