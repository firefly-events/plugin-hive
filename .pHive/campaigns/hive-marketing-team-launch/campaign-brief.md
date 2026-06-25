## Campaign Brief: Hive Marketing Team — Agent-Powered Launch Campaigns

> **Flayr template selection:** `createPost` (LinkedIn post draft) + one `generateImage` hero (16:9, LinkedIn). No other templates.

---

### Positioning

Hive just shipped a marketing team made of agents. `marketing-strategist`, `marketing-copywriter`, and `ad-creative` wire into `/ship` — type one flag, and Hive turns your release changelog into a complete, review-ready LinkedIn campaign: positioning brief, ad copy, and hero image prompt, all without a human marketer. Built for solo technical founders and eng-led teams who ship software but not marketing.

---

### Audience Segments

| Segment | Job-to-be-done | Pain point | Preferred channel |
|---------|---------------|------------|-------------------|
| **Solo technical founder** | Ship a real product launch alongside every meaningful release | No time or budget for marketing; releases go unannounced | LinkedIn (authority + reach to investors/customers) |
| **Eng leader / AI-toolchain builder** | Adopt Claude Code / agentic workflows that handle non-engineering work | Marketing is a bottleneck; engineering is not | LinkedIn (professional peer network, Claude Code community) |

**Primary segment for this launch:** Solo technical founder (tightest pain, most direct buyer of Hive).

---

### Message Pillars

1. **Every release deserves a launch** — Engineers ship constantly; only a few releases ever get announced. The marketing team closes that gap: one flag in `/ship` triggers the full campaign pipeline. Supporting evidence: opt-in `--campaign` flag wired into the `/ship` step-9 hook.

2. **The marketing team is agents, not headcount** — `marketing-strategist` derives positioning, `marketing-copywriter` writes copy, `ad-creative` produces the visual prompt — all from your changelog, automatically. Supporting evidence: three dedicated agent personas, parallel Phase 2 execution, consumer-gated by design.

3. **Already inside Hive — no integration tax** — No new tool, no API key, no third-party SaaS. If you're running Hive, you already have a marketing team. Supporting evidence: consumer-gated hook, double-opt-in safety (consumer-app project + explicit flag).

---

### Go-to-Market Plan

- **Pre-launch:** None required — this is a feature announcement, not a product launch. The post is the entire campaign.
- **Launch:** Single LinkedIn post (organic). Target: technical founders and Claude Code builders already in the Hive orbit. Publish immediately after artifacts are ready.
- **Post-launch:** Monitor comments for adoption questions; respond in-thread. No paid amplification at this stage.

---

### Channel Mix

| Channel | Format | Audience segment | Priority |
|---------|--------|-----------------|----------|
| LinkedIn | Organic post (`createPost`) | Technical founder + eng leader | Primary |
| LinkedIn | Hero image (`generateImage`, 16:9) | Visual hook for feed scroll-stop | Support |

**All other channels deferred.** This is a single-platform launch. No Twitter/X, no email, no paid.

---

### Flayr Template Selection

**Selected (use these only):**
- `createPost` — LinkedIn post (hook + body + CTA + hashtags). Full caption draft, paste-ready for Flayr.
- `generateImage` — One 16:9 LinkedIn hero. Image-gen prompt, on-brand, paste-ready for Flayr.

**Not selected:** Do not use any other Flayr templates for this campaign.

---

### Success Metrics

- Post published within 24 hours of artifacts being approved
- Engagement rate ≥ 3% (likes + comments / impressions) in first 48 hours
- ≥ 5 genuine comments from technical-founder or eng-leader profiles
- ≥ 1 inbound "how do I try this?" DM or comment

---

### Handoffs

**→ marketing-copywriter (b2):**
- Write the **LinkedIn caption** using Pillar 1 as the hook, Pillar 2 as the body, Pillar 3 as the close.
- Format: hook line (scroll-stop, plain-spoken, no em-dash opener), 3–4 body paragraphs of ≤ 3 lines each, CTA line, hashtag block.
- CTA label: **"See the changelog →"** | Destination URL: the Hive CHANGELOG entry for v2.13.0 (or the GitHub release page — use the repo URL from the codebase, do not fabricate).
- Tone: confident, direct, slightly irreverent — a founder talking to founders. No marketing-speak. No "excited to announce."
- Write 2 caption variants (Variant A: opens with the pain; Variant B: opens with the capability).
- Hashtags: `#ClaudeCode` `#AIAgents` `#IndieHacker` `#BuildInPublic` `#Hive` (max 5).

**→ ad-creative (b3):**
- Produce **one 16:9 LinkedIn hero** as a Flayr `generateImage` paste-ready prompt.
- Visual concept: dark background (Hive neutral #495057 or near-black), three glowing agent cards labeled `marketing-strategist`, `marketing-copywriter`, `ad-creative` arranged in a left-to-right workflow chain, connected by a thin flow arrow. Hive primary blue (#3B5BDB) as accent. Clean, typographic, no stock-photo feel.
- Brand tokens: primary #3B5BDB, neutral #495057, surface #F8F9FA, font Inter Bold for labels.
- Deliver as a verbatim `generateImage` Flayr prompt block. No placeholder text.
- Read `hive/references/brand-system-schema.yaml` for the canonical palette reference.
- Note: `.pHive/brand/brand-system.yaml` did not exist at brief-writing time; use schema defaults above.

---

### Strategic Risks

- **Scope creep in copy:** marketing-copywriter may try to write for multiple channels. Hard constraint: LinkedIn only.
- **Brand system gap:** `.pHive/brand/brand-system.yaml` not yet generated; brand tokens used in this brief are from the schema defaults. ad-creative should flag if actual brand system exists by the time it runs.
- **Flayr template availability:** `hive/references/flayr-prompt-templates.md` was not found in the repo at brief-writing time. ad-creative must produce a structurally valid `generateImage` prompt using the description in the issue brief as the template reference.
- **Consumer-scope guard:** Both b2 and b3 have an internal guard that halts on Hive-internal epics. This campaign's issue brief includes an explicit override; both agents should read and honor it.
