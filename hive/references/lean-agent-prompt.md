# Lean Agent Prompt Contract

A minimal-footprint contract for dispatched-agent prompts. It exists to bound context
and side-effect surface for a single-story dispatch — it is a prompt-construction
discipline, not a runtime component. Any skill that assembles a prompt for a spawned
agent (solo `Agent(name:)` spawn, per-story team dispatch, sandcastle/multica dispatch)
should shape that prompt to this contract.

## The contract

1. **Read only named files.** The prompt enumerates the exact files the agent needs
   (story YAML `key_files`, `files_to_modify`, the research brief). The agent reads
   those and nothing else it wasn't told to open. It does not go spelunking the repo
   for context that should have been in the prompt.
2. **At most one named build/test invocation.** If the story needs a build or test
   run to verify its acceptance criteria, the prompt names the single command to run
   (e.g. `node --test tests/hive-references/foo.test.js`). The agent does not chain
   exploratory build/test invocations beyond the one named command.
3. **Write the output artifact first.** Before reporting completion, the artifact
   (file edit, generated doc, patch) exists on disk. Status reporting is a summary of
   what was written, never a substitute for having written it.
4. **Hard scope box.** The story's `files_to_modify` is the complete list of files the
   agent may touch. No unsolicited refactoring, no drive-by cleanup outside that list.
5. **No sub-spawning.** A lean-prompt agent does not spawn further agents. If the work
   genuinely needs decomposition, that decomposition happens at the dispatch layer
   (story splitting, stage sequencing) — not by letting a single dispatched agent
   fan out on its own.

## Explicitly deferred

This contract does **not** include automatic dispatch fallback after N connection
failures (e.g. "auto-apply after 3 dropped connections to a spawned agent"). No
failure-counting infrastructure exists in the dispatch layer today, and building one
is out of scope for this reference — it is deferred until a concrete failure-retry
story defines the counting and threshold semantics.

## Where this applies

`execute-dispatch` (see `skills/hive/skills/execute-dispatch/SKILL.md`) resolves
*which* dispatch mode and runner path a story uses; it does not itself assemble
agent prompts. Whichever downstream surface builds the actual prompt for a resolved
`mode_decision` (team template in `skills/execute/references/team-execution.md`,
solo spawn template in `skills/hive/skills/agent-spawn/SKILL.md`, or a
sandcastle/multica/cc-workflows dispatch payload) should shape that prompt to this
contract.
