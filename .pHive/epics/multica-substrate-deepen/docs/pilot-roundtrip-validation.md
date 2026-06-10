# Pilot Round-Trip Validation — /metrics-check Export

**Date:** 2026-05-27  
**Story:** w4-5-pilot-roundtrip-validation  
**Validator:** developer agent (d9946f9a)  
**Workspace:** plugin-hive (21c6d282-d6b4-4b25-8d0d-a85e96038416)

---

## Summary

**Overall verdict: PARTIAL PASS — cold path works, warm idempotent path broken by server API gap.**

The Mode D-a skills export mechanism is structurally sound. reconcileSkills successfully materialized `metrics-check` in Multica on the first run. However, a server-side gap (GET `/api/skills` does not return `content_hash` or `visibility`) causes the idempotent warm path to fire an unnecessary update on every re-run. This is a defect against W4.3's acceptance criterion "Warm idempotent path: re-run with no source changes → no upserts fire."

---

## Acceptance Criteria Results

### 1. Pilot round-trip executed end-to-end against spike workspace
**PASS**

reconcileSkills was invoked via `hive/lib/multica-bootstrap/index.mjs` against the live `plugin-hive` workspace. The POST to `/api/skills` succeeded.

```
reconcileSkills result: { created: ["metrics-check"], patched: [], skipped: [], removed: [] }
```

### 2. metrics-check skill present in Multica skill table after /hive:multica-init
**PASS**

Skill row confirmed via `multica skill list` and `multica skill get`:

```
id:   999cf272-76fb-49f3-bff1-7e089d9d92c4
name: metrics-check
workspace_id: 21c6d282-d6b4-4b25-8d0d-a85e96038416
created_at: 2026-05-27T19:54:54Z
```

Note: The installed plugin (v2.9.0) does not include reconcileSkills. Bootstrap was run by calling the library directly from the epic branch. The multica-init SKILL.md on `feat/multica-substrate-deepen` correctly documents Step 9 (`reconcileSkills`), but it will only execute when the plugin is rebuilt and published from this branch.

### 3. Skill content matches in-repo SKILL.md after normalization
**PASS**

Stored `content` field extracted the SKILL.md portion (everything before the first `<!-- substrate: -->` marker). Normalized comparison (strip trailing whitespace per line, strip trailing blank lines) confirmed exact match:

- Repo `skills/metrics-check/SKILL.md` normalized length: **18,159 chars**
- Stored content skill portion normalized length: **18,159 chars**
- Match: **True**

### 4. All substrate_deps present as skill_files
**PARTIAL PASS — with API gap finding**

The three `substrate_deps` declared in `.pHive/multica/skills-export.yaml` are present in the bundled `content` field, confirmed by `<!-- substrate: ... -->` markers:

```
<!-- substrate: hive/references/skill-prelude.md -->
<!-- substrate: hive/references/story-yaml-schema.md -->
<!-- substrate: hive/references/cross-cutting-concerns.md -->
```

However, `multica skill files list 999cf272-76fb-49f3-bff1-7e089d9d92c4` returned `[]`. The W4.3 bundling protocol stores substrate deps inline in `content` (not as separate `skill_files` table rows). The acceptance criterion language "present as skill_files" is satisfied by their presence in the bundled content payload, but if downstream consumers expect them as discrete `skill_files` rows, this is a gap to address in a future story.

### 5. Visibility flag correctly set
**INCONCLUSIVE — server API does not return visibility field**

`.pHive/multica/skills-export.yaml` sets `visibility: private`. The POST body sent `visibility: "private"`. However, the server's GET response for both `skill list` and `skill get` does not include a `visibility` field. Cannot confirm the value was persisted.

W0.3 spike finding doc (`s0-3-skill-import.md`) was not written prior to this story. Recommended follow-up: author W0.3 finding doc documenting the absence of `visibility` in GET responses and whether a patch endpoint exists.

### 6. Validation finding documented
**PASS** — this document.

---

## Defect Found: Warm Idempotent Path Broken

**Severity:** Medium (every re-run fires an unnecessary PUT)

**Root cause:** `reconcileSkills.diffSkill` compares `content_hash` and `visibility`. The server GET `/api/skills?workspace_id=...` response does not include these fields. On re-run, `existing.content_hash` is `undefined`; `desired.content_hash` is the computed SHA-256. The diff always returns `['content_hash']` as changed, triggering a PUT.

**Evidence:**
```
First run:  { created: ["metrics-check"], patched: [], skipped: [], removed: [] }  ✅
Re-run:     { created: [], patched: ["metrics-check"], skipped: [], removed: [] }  ❌
```

**Fix options (for defect story against W4.3):**
1. If the server stores and returns `content_hash`: verify field name in GET response.
2. If the server does not return `content_hash`: store it client-side (e.g., in `.pHive/multica/skills-state.yaml`) and use that for drift detection.
3. Fetch and compare raw content as fallback when `content_hash` is absent in GET response.

---

## Mode D-a Pattern Verdict

The structural pattern is validated:
- `skills-export.yaml` manifest → `reconcileSkills` → Multica skill row with bundled substrate content
- Content bundling (SKILL.md + substrate deps via `<!-- substrate: ... -->` markers) works correctly
- Cold-path creation works

The mechanism requires one defect fix (idempotent warm path) before it is production-ready for CI-gated drift detection (W4.4). Future skills can be added to `skills-export.yaml` without re-validating the bundling mechanism, but the idempotent path fix is a prerequisite for W4.4.

---

## Metric

`multica.skills_export_pilot_roundtrip_pass`:  
**0.5** (partial — cold path PASS, warm path FAIL, visibility INCONCLUSIVE)  
Target was 1 (full boolean pass). Recommend target revision to account for discovered server API gaps, or file defect story and re-verify after fix.
