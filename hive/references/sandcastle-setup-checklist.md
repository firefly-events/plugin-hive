# Sandcastle Setup Checklist

Short pre-flight checklist for Sandcastle + Codex auth mount readiness.
Run `/hive:sandbox-setup` after all items below are confirmed.

---

## 1. Package version

- [ ] `@ai-hero/sandcastle` is pinned to `>=0.5.10 <0.6.0` in `package.json`
- [ ] Run `npm list @ai-hero/sandcastle` to confirm the installed version

> **Why:** 0.5.x introduced the `codex()` provider and the `Output.object()` API used by
> Hive's structured-output path. 0.6.x is not yet validated against this integration.

---

## 2. Container runtime

- [ ] **Podman** (preferred) or **Docker** is installed and on `$PATH`
- [ ] `podman info` (or `docker info`) exits 0
- [ ] Rootless mode is configured for Podman (no `sudo` required)

---

## 3. Sandcastle image

- [ ] Image `sandcastle:spike` is built locally:
  ```bash
  podman build -t sandcastle:spike .pHive/spikes/sandcastle/
  ```
- [ ] `podman image inspect sandcastle:spike` exits 0

---

## 4. Auth directory + file

- [ ] Directory `.sandcastle/codex-config/` exists at repo root
- [ ] `auth.json` is present at `.sandcastle/codex-config/auth.json`
- [ ] File permissions are `0600`:
  ```bash
  stat -c '%a' .sandcastle/codex-config/auth.json   # Linux
  stat -f '%A' .sandcastle/codex-config/auth.json   # macOS
  ```
- [ ] File parses as valid JSON with an `apiKey` field:
  ```bash
  node -e "const f = require('./.sandcastle/codex-config/auth.json'); console.log(f.apiKey ? 'ok' : 'MISSING apiKey')"
  ```

> Run `/hive:sandbox-setup` to create or validate this file automatically.
> If the validation reports malformed JSON or a missing `apiKey`, delete the file and re-run.

---

## 5. Gitignore

- [ ] `.sandcastle/` is in `.gitignore` at repo root
- [ ] `git status` does NOT show `.sandcastle/` as a tracked or staged path

---

## 6. OPENAI_API_KEY

- [ ] `OPENAI_API_KEY` is set in the shell (or in `.sandcastle/.env.local`)
- [ ] `echo ${OPENAI_API_KEY:0:7}` prints `sk-proj` or similar (confirms it is loaded)

---

## 7. Mount verification

After setup, verify the bind-mount resolves correctly inside the container:

```bash
podman run --rm \
  -v "$(pwd)/.sandcastle/codex-config:/home/agent/.codex:ro" \
  sandcastle:spike \
  ls -la /home/agent/.codex/auth.json
```

Expected: one file, permissions `r--------` or `-rw-------` (read-only mount makes it `400`).

---

## 8. userns:false caveat (macOS parallel runs)

The spike harness sets `userns: false` in the Podman provider config:

```ts
const podmanSandbox = podman({
  imageName: "sandcastle:spike",
  userns: false,   // ← required on macOS for parallel runs
  mounts: [...]
});
```

**macOS:** `userns: false` is required when running two or more Sandcastle containers in
parallel. The rootless-Podman `keep-id` user-namespace map setup races on macOS, causing the
second concurrent container init to fail. `userns: false` avoids the race.

**Production Linux:** Do NOT use `userns: false` in production Linux deployments where UID
isolation is a security requirement. In those environments, leave `userns` at its default
(`keep-id`) so each container runs with a non-root UID mapped from the host. Removing
`userns: false` before deploying to Linux is a **moderate security finding** from the
security:impl-audit.

---

## Related references

- Skill: `skills/hive/skills/sandbox-setup/SKILL.md`
- Spike harness: `.pHive/spikes/sandcastle/harness.ts`
- Sandcastle provider docs: `@ai-hero/sandcastle` README (npm)
