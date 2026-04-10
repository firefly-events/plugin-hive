---
name: additive-schema-changes
description: "schema changes must be additive (new optional fields only) to avoid breaking existing content"
type: pattern
last_verified: 2026-04-06
ttl_days: 90
source: agent
---

Adding required fields to an existing schema breaks all files that don't
have them. Always add new fields as optional with sensible defaults.
