# Standup Slack Output Format

This document specifies the markdown conventions for `/hive:standup --format slack` output. The output is designed to paste directly into a Slack message or be delivered verbatim by a cron-driven bot.

## Guiding Constraints

- **No ANSI escape codes.** No color sequences, bold/dim terminal formatting, or cursor control. Plain UTF-8 only.
- **Markdown only.** Slack renders a subset of markdown in messages. Stick to constructs that render reliably: headings, bullets, inline code, fenced code blocks.
- **No interactive prompts.** The output ends after the report body. No "Proceed to planning?" or similar CTAs.
- **No emojis required.** Emoji is optional and may be used sparingly. Operators can strip them if their Slack workspace convention disfavors emoji in bot messages. The overnight section uses 🌙 by convention; all other sections are emoji-free by default.

## Heading Levels

| Level | Usage |
|-------|-------|
| `##` | Top-level report sections (e.g., `## Standup — 2026-05-24`) |
| `###` | Sub-sections within a report (e.g., `### In Progress`, `### Blocked`) |

Do not use `#` (H1) — Slack renders it identically to H2 but it signals document-root, which reads oddly in a message context.

## Lists

Use `-` bullet lists. Nested items use two-space indent. Avoid numbered lists in standup output — ordering implies priority, which is not always intended.

## Tabular Data

Slack does not render markdown tables. Render tabular content as fenced code blocks instead:

````
```
STORY                   STATUS      NEXT STEP
alpha-epic/s-01         in-progress implement
alpha-epic/s-02         blocked     waiting on s-01
```
````

Use fixed-width alignment where practical. Column headers in ALL CAPS.

## Line Length

Soft cap at 120 characters per line. Slack wraps long lines on mobile; staying under 120 keeps the report readable without horizontal scrolling on desktop.

## Section Order

Emit sections in this order (omit empty sections entirely — no placeholder headers):

1. Overnight (if commits were pulled)
2. Completed
3. In Progress
4. Blocked / Failed
5. Dependency Graph
6. Institutional Knowledge (Metrics Health, if applicable)

The closing "Ready for Planning?" prompt is **omitted** in slack format.

## Empty-State Collapse

If a section has no content, omit it entirely — including its heading. Do not render `### Completed\n(none)`. Silence is correct for empty sections.

## Example Output Shape

```markdown
## Standup — 2026-05-24 · GREEN

### In Progress
- [alpha-epic] s-02: Add --format flag — last step: implement, next: test

### Dependency Graph
```
s-01 (done) → s-02 (in-progress) → s-03 (pending)
s-04 (independent)
```

### Institutional Knowledge
- [researcher] additive-schema-changes: new fields must be optional with defaults
```
