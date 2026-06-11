---
name: story-yaml-is-complete-research-brief
description: Read the story YAML before reading any source files — it contains exact line ranges, adapter call shapes, design decisions, and code examples that make most source reads redundant.
applies_to: researcher
---

Story YAMLs in `.pHive/epics/*/stories/*.yaml` carry `context.key_files` with exact line offsets, `code_examples` with target snippets, `references.relevant_excerpt` fields, and `design_decisions` that already resolve architecture questions. For t-2-markNeedsRework-abi, reading the story YAML first (line 143–175) would have surfaced the full adapter implementation spec without re-deriving it from source. Read the YAML as your first action on any story-scoped research task — it dramatically narrows which source ranges actually need Read calls.
