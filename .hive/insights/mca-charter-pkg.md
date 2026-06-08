# mca-charter-pkg insights

- Root dependency governance needs to include optional bridge tools when code
  directly imports them. `openai` is optional for core Hive, but
  `hive/lib/openai-image-mcp-server.js` calls `requireModule('openai')`; leaving
  it out would preserve the same implicit-install pattern this story is closing.
- `tsx` is not just a test helper in this repo. Adapter entrypoints use `tsx`
  shebangs or `npx tsx`, so the root manifest should treat it as bridge runtime
  support rather than burying it only in per-adapter devDependencies.
