## Required placeholders

- `{animation_opportunities}`
- `{prior_verdict}`
- `{timestamp}`
- `{file}`
- `{line}`
- `{opportunity}`

Synthesize animation and polish opportunities into a polish report.

Animation opportunities from animations-specialist:
{animation_opportunities}

Prior ui-audit verdict (for context): {prior_verdict}

Produce a polish report using the Work Report format. Add a priority matrix:

## Work Report: Polish Audit — {timestamp}

## Findings
- `{file}:{line}` — {opportunity} [effort: low | medium | high] [impact: high | medium | low]

## Changes Made
(Leave empty — this is a discovery pass, not a fix pass.)

## Remaining Issues
- Opportunities that require design decisions or brand direction before implementation
- Anything that conflicts with existing UX patterns and needs human sign-off

## Summary
One-paragraph assessment: overall polish opportunity, highest-ROI items to tackle first.

## Priority Matrix
| Opportunity | File | Effort | Impact | Recommendation |
|-------------|------|--------|--------|----------------|
| ... | ... | low | high | Do immediately |
| ... | ... | high | low | Defer |
