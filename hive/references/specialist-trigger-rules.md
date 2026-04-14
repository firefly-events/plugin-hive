# Specialist Trigger Rules

Specialist review agents are activated automatically during the review phase of story
execution, based on the story's `key_files`, `tags`, and description. This document is
the canonical table of trigger conditions. It is evaluated by the execute skill step 6b
before invoking the review session.

## Overview

Specialist agents narrow the review focus to dimensions the standard `reviewer` does not
cover deeply (security, performance, accessibility, language idioms, animations). They do
NOT replace the standard reviewer — they run in addition to it.

When session execution is active (step 6b), matched specialists are appended to the
review session's context as `Additional reviewers: [list]`. When TeamCreate is active
(step 6a), matched specialists are spawned as additional teammates for the review step.

## Trigger Rule Table

| Specialist Agent | Trigger Condition | Priority | Notes |
|-----------------|-------------------|----------|-------|
| `security-reviewer` | Story `key_files` match auth/crypto/secrets patterns, OR story `tags` includes `auth`, `security`, `secrets`, OR description mentions authentication, authorization, tokens, passwords, encryption, or input validation | **high** | Always include for any story touching session management, login flows, API keys, or permission systems |
| `performance-reviewer` | Story `key_files` include service files, DB query files, or cache files; OR story `tags` includes `performance`, `latency`, `hot-path`; OR description mentions query optimization, caching, batch operations, or bulk data handling | **medium** | Skip for purely doc/config stories |
| `accessibility-specialist` | Story `key_files` include UI component files (`.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`); OR story `tags` includes `ui`, `frontend`, `accessibility`; OR story type is frontend | **medium** | Activated on any story that renders HTML or produces visible UI elements |
| `idiomatic-reviewer` | Story `key_files` include `.go`, `.rs`, `.hs`, `.ex`, `.exs` files; OR story `tags` includes `idiomatic`, `refactor`, `language-patterns` | **low** | Triggered by language files with strong idiom cultures (Go, Rust, Haskell, Elixir). Skip for TypeScript/JavaScript unless explicitly tagged |
| `animations-specialist` | Story `key_files` include CSS animation/transition files, OR description mentions animation, transition, motion design, or keyframes; OR story `tags` includes `animation`, `motion` | **low** | Only activated when animation work is explicitly in scope |

## Evaluation Procedure

When step 6b runs the specialist check (step 6b-4), apply this procedure:

1. **Read the story spec.** Load `key_files`, `tags`, and `description` fields.
2. **Evaluate each row** in the table above against those fields. Use OR across the condition columns — one match is sufficient to trigger.
3. **Collect matched specialists.** Build a list: `[security-reviewer, accessibility-specialist, ...]`
4. **Append to review session context:**
   ```
   Additional reviewers: security-reviewer, accessibility-specialist
   Each additional reviewer should run their activation protocol after the primary review.
   Load their persona from hive/agents/{agent-name}.md.
   ```
5. **Log the trigger decision:**
   ```
   SPECIALIST CHECK: story={story-id}
     triggered: security-reviewer (tag: auth), accessibility-specialist (file: .tsx)
     skipped: performance-reviewer, idiomatic-reviewer, animations-specialist
   ```

## Pattern Matching Reference

### Auth/crypto/secrets patterns (for `security-reviewer`)

File name patterns: `*auth*`, `*login*`, `*session*`, `*token*`, `*secret*`, `*key*`,
`*password*`, `*crypto*`, `*encrypt*`, `*hash*`, `*permission*`, `*role*`, `*oauth*`,
`*jwt*`, `*saml*`

### Hot-path service patterns (for `performance-reviewer`)

File name patterns: `*service*`, `*repository*`, `*query*`, `*cache*`, `*store*`,
`*batch*`, `*worker*`, `*queue*`, `*index*`

### UI component patterns (for `accessibility-specialist`)

File extensions: `.tsx`, `.jsx`, `.html`, `.vue`, `.svelte`, `.erb`, `.haml`
File name patterns: `*component*`, `*page*`, `*view*`, `*screen*`, `*layout*`

## High-Priority Overrides

Regardless of other trigger conditions, always include `security-reviewer` when:
- The story is in the `memory-autonomy-foundation` epic and touches session management
  (sessions contain authentication credentials)
- The story description contains the words "credential", "API key", or "access token"

## Non-Specialist Notes

The `test-swarm` agents (`test-scout`, `test-architect`, `test-inspector`, `test-sentinel`)
are not specialist review agents — they are part of the test swarm workflow and are
governed by `hive/references/test-swarm-architecture.md`, not this document.

## References

- `skills/execute/SKILL.md` — step 6b-4 calls this rule set during the review phase
- `hive/agents/security-reviewer.md` — specialist persona
- `hive/agents/performance-reviewer.md` — specialist persona
- `hive/agents/accessibility-specialist.md` — specialist persona
- `hive/agents/idiomatic-reviewer.md` — specialist persona
- `hive/agents/animations-specialist.md` — specialist persona
