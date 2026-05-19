# Design discussion — GHCR sandcastle image distribution

**Epic:** `ghcr-sandcastle-image`
**Methodology:** classic
**Scale:** small-medium (3 stories; new workflow + 2 patches)

## Goal

Pre-build the sandcastle container image once on `.sandcastle/**` change (and weekly), push to GHCR (`ghcr.io/firefly-events/sandcastle`), and have `Hive dispatch` pull instead of build. Eliminates ~3-5 min build cost per dispatch run and the duplicated build steps between Hive Worker (cron) + Hive dispatch (event).

## Proposed approach

### gi-1 — `build-sandcastle-image.yml`

New workflow. Triggers:
- `push` to `main` with paths `.sandcastle/**`
- `workflow_dispatch` (manual)
- `schedule: weekly` (catch upstream base-image CVE fixes)

Steps:
1. Checkout (sparse — only `.sandcastle/`)
2. Login to GHCR via `GITHUB_TOKEN` (built-in).
3. `docker build` from `.sandcastle/Containerfile` with both `--build-arg AGENT_UID="$(id -u)"` and `--build-arg AGENT_GID="$(id -g)"` for runtime parity.
4. Tag as `ghcr.io/firefly-events/sandcastle:latest` AND `:sha-<short-sha>` for traceability.
5. `docker push` both tags.
6. Optional: smoke test (`docker run --rm <image> which claude && which codex`).

Permissions block: `contents: read`, `packages: write`.

### gi-2 — Hive dispatch pulls from GHCR

Update `skills/sandcastle-gh-init/assets/hive-dispatch.yml.tpl` + .example mirror + in-repo `.github/workflows/hive-dispatch.yml`:

- Replace the `Build sandcastle image` step with a `Pull sandcastle image` step:
  ```bash
  docker pull ghcr.io/firefly-events/sandcastle:latest
  docker tag ghcr.io/firefly-events/sandcastle:latest sandcastle:hive
  ```
- The bridge still references `sandcastle:hive` so the retag preserves contract.
- Fallback: if pull fails, log the failure and build locally (back-compat for repos that haven't enabled GHCR).
- Image-name override: new workflow input `image_ref` defaulting to `ghcr.io/firefly-events/sandcastle:latest`; consumers can point at their own GHCR fork.

### gi-3 — Docs + version bump

- README "Unattended mode" section: add a sentence about the GHCR image flow.
- `hive/references/sandcastle-gh-dispatch.md`: new "Image distribution" subsection (between §3 Branching model and §4 Auth).
- `CHANGELOG.md`: new `[2.5.0] - 2026-05-19` section. MINOR bump — substantial architectural change consumer-visible.
- Bump `.claude-plugin/plugin.json` + `marketplace.json` + README badge: 2.4.2 → 2.5.0.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| GHCR auth on first push fails (`packages: write` permission missing in workflow) | Medium | Document explicitly in gi-1; sample workflow YAML includes the permissions block verbatim. |
| Consumer forks plugin-hive but GHCR image stays at firefly-events/sandcastle | Low | gi-2 adds `image_ref` workflow input; consumers point at their own image. |
| Cron Hive Worker still does its own local build → drift between cron image and GHCR image | Low | Out of scope this epic. Cron is going away; current divergence is acceptable. |
| Weekly rebuild schedule misses an urgent CVE | Low | `workflow_dispatch` trigger lets a maintainer force-rebuild on demand. |
| Image pull fails mid-run (GHCR transient outage) | Low | gi-2 fallback: local build if pull fails. |

## Open questions

1. Should the workflow auto-prune old `:sha-*` tags? Defer — not blocking; manual cleanup is fine for the first 6 months.
2. Should `:latest` move on every successful push, or only after a manual promote step? **Recommendation:** move on every push (continuous-delivery shape; the build is content-deterministic).

## Scale assessment

Small-medium. 3 stories, ~7 files. No H/V needed.
