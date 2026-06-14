# State Dir Resolver Design Discussion Insights

- For state relocation design docs, separate "runtime state lookup" from "semantic/default-location contract" before proposing file edits. DAG executor opt-in files, migration scripts, and protected-path guards look like hardcodes but may be intentional locks.
- A resolver proposal is clearer when it names the reference implementation first. Here, `hooks/common.sh` is the behavioral contract; Node and Python should mirror it rather than independently interpreting `paths.state_dir`.
- Prose inventories need an executable-instruction filter. Global markdown replacement would create noise; the actionable class is `SKILL.md` and workflow text that tells agents to read, write, create, copy, or pass state paths.
