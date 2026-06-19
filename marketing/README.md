# marketing/

Remotion compositions for Hive. Renders launch video + ongoing release/social clips from real `.pHive/` data.

## Install

```bash
cd marketing
npm install
```

## Use

| Command | Purpose |
|---------|---------|
| `npm run studio` | Live preview in browser |
| `npm run still` | Render single PNG (smoke test) |
| `npm run render` | Render MP4 |

## Compositions

- **StoryReplay** — animates story timeline from a real epic in `.pHive/epics/`. Pattern 2 (replay-from-logs) reference impl.

## Why isolated

Root `plugin-hive/` ships no `node_modules` per BYO policy. `marketing/` has its own `package.json` so launching the studio never pollutes the plugin runtime.
