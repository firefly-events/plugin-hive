# State Dir Resolver Research Notes

- Existing shell resolver is more complete than the JS/Python config helpers: it handles paths.state_dir, paths.target_project, missing config fallback, and relative-path canonicalization in one place. Planning should avoid inventing a different precedence model for Node/Python.
- Treat prose as an execution surface. Several SKILL.md and workflow-step files contain shell snippets and direct agent instructions, so a code-only resolver will still leave relocated-state users writing to .pHive.
- Some .pHive literals are semantic locks rather than missed resolver usage, especially migration scripts and DAG executor consumer-flag paths. Those need explicit planner decisions before broad replacement.
