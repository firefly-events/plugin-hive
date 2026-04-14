# Session Registry Bootstrap Skill

Initialize the session registry before any Managed Agent sessions are created. This
skill ensures `state/sessions/index.yaml` exists and is in the correct format. Run once
per epic execution — idempotent if the file already exists.

**Input:** Called by the orchestrator at the start of step 6b in `skills/execute/SKILL.md`.
No `$ARGUMENTS` required.

## When to Use

- At the start of any session-based epic execution (step 6b path in execute skill)
- When `HIVE_SESSIONS_ENABLED=1` or `hive.config.yaml sessions.enabled: true`
- Before the first `/v1/sessions` call is made

## When NOT to Use

- When running TeamCreate execution (step 6a) — no session registry needed
- For meta-team cycles (they do not use session execution)

## Procedure

### 1. Check if `state/sessions/` exists

```
stat state/sessions/
```

If the directory does NOT exist: create it.

### 2. Check if `state/sessions/index.yaml` exists

Read `state/sessions/index.yaml`.

**If the file exists and has a valid `sessions:` list:** Bootstrap is already done.
Log `SESSION REGISTRY: already initialized (N sessions recorded)` and exit.

**If the file does not exist or is malformed:** proceed to step 3.

### 3. Write the initial index

Write `state/sessions/index.yaml` with this content (substituting the current
ISO 8601 timestamp for `{NOW}`):

```yaml
created: "{NOW}"
sessions: []
```

Log `SESSION REGISTRY: initialized at state/sessions/index.yaml`.

### 4. Report

Report one line:
```
SESSION REGISTRY: ready — state/sessions/index.yaml ({N} sessions)
```
where N is the count of existing sessions (0 for a fresh init).

## Adding a Session Record

After the registry is bootstrapped, the execute skill (step 6b) adds session records
as it creates sessions. Use this append pattern:

1. Read `state/sessions/index.yaml`
2. Append a new record to the `sessions:` list with `status: pending` and `created_at: {NOW}`
3. Write the file back

Record format: see `hive/references/session-registry-schema.md`.

## Updating a Session Record

To update an existing session (e.g., set `status: active`, update `last_active_at`,
update `sse_last_event_at`):

1. Read `state/sessions/index.yaml`
2. Find the record by `session_id`
3. Update the relevant fields in-place
4. Write the file back

## Key Rules

1. **Always idempotent.** Running bootstrap twice does not corrupt the index — it skips
   if already initialized.
2. **Never delete records.** Session records accumulate as an audit trail. Stuck and
   failed sessions are kept with their status intact.
3. **Write atomically.** Read the whole file, update in memory, write the whole file.
   Do not append raw YAML — always parse and re-serialize.
4. **One index per project.** `state/sessions/index.yaml` is the single source of truth.
   Do not create per-epic index files.

## References

- `hive/references/session-registry-schema.md` — full schema with field definitions and status lifecycle
- `skills/execute/SKILL.md` — calls this skill at start of step 6b
- `hive/references/session-resilience.md` — reads registry to detect stuck sessions
