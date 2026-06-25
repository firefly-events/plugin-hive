## Copy Deliverables: Hive Marketing Team Launch

### LinkedIn Captions

---

**Variant A (pain-led hook)**

Hook:
Multi-agent workflows are hard to coordinate. You get agents that write, agents that build, agents that review — and none of them talk to each other in a way that produces a finished thing.

Body:
We've been building toward this for a while: a marketing team that lives inside your codebase, not outside it. The marketing-strategist reads your changelog, derives positioning, and hands off a structured campaign brief. Then marketing-copywriter and ad-creative run in parallel — copy and creative land as committed files, not Slack drafts or Notion docs.

This isn't an integration or a plugin chain. It's a coordinated agent squad that ships an artifact you can review in a PR, just like code.

The first run happened automatically. We shipped it as part of Hive v2.13. The campaign brief, copy, and hero prompt are in `.pHive/campaigns/` on the branch right now.

CTA:
See the changelog →

#ClaudeCode #AIAgents #IndieHacker #BuildInPublic #Hive

---

**Variant B (capability-led hook)**

Hook:
We just shipped a marketing team inside our codebase.

Body:
Not a SaaS tool. Not a Zapier flow. A squad of agents — marketing-strategist, marketing-copywriter, ad-creative — that reads a release changelog and produces a review-ready launch package: campaign brief, LinkedIn copy, hero image prompt. All as committed files on a branch.

The marketing-strategist handles positioning and message pillars. It hands a structured brief to copywriter and ad-creative, who run in parallel. When they're done, the artifacts are in `.pHive/campaigns/` and the squad leader flips the task to done.

This is what Hive 2.x is actually for. Not automating one step — automating a whole workflow phase that normally requires humans, handoffs, and a project tracker.

You define the team once. It runs every release.

CTA:
See the changelog →

#ClaudeCode #AIAgents #IndieHacker #BuildInPublic #Hive

---

### Taglines

1. Your codebase ships the code. Now it ships the launch too.
2. Multi-agent SDLC — from changelog to campaign, no humans in the loop.
3. Hive: the team that lives in your repo.

---

### Copy Notes

**Voice decisions:**
- Tone is founder to founder — assumes the reader has shipped something and knows what coordination pain feels like. No onboarding language.
- Avoided "excited to announce" and all variants. Both hooks drop straight into the concrete thing.
- Variant A leads with the pain (coordination chaos) then reveals the solution mid-post. Works well for readers who've tried multi-agent setups and gotten burned.
- Variant B leads with the claim ("we just shipped a marketing team") — more aggressive, better for cold audiences who haven't heard of Hive.

**Ambiguities handled:**
- No changelog URL provided. CTA text is ready but the URL must be attached before publishing. Recommend linking to the GitHub Releases page for plugin-hive.
- Brand system YAML was not present in the repo at time of writing. Voice calibrated from the CHANGELOG tone (direct, technical, outcome-first) and the issue brief instruction (confident, direct, slightly irreverent).

**Recommendations for ad-creative (b3):**
- Variant A's visual should show the coordination chaos → structured output arc — something like a messy graph resolving into a clean pipeline.
- Variant B's visual should anchor on the concrete artifact: a terminal or PR view showing `.pHive/campaigns/` files landing on a branch. Makes the "inside the codebase" claim literal and visual.
- Both: avoid startup-stock-photo energy. Technical founders respond to real UI or code surfaces.
