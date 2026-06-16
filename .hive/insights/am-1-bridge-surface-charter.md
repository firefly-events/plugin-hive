# Insights — am-1-bridge-surface-charter

## `_surfaceScopes` in package.json

The root `package.json` has no official per-dep annotation field. Used a `_surfaceScopes`
key (npm ignores unknown root keys) to document which bridge surface owns each dep.
Keeps the policy machine-searchable without splitting into a sidecar file. Future stories
adding bridge deps should append to `_surfaceScopes`, not leave deps bare.

## "Bridged-indefinite" vs "deferred" disposition matters

Existing surfaces say "deferred" — meaning a Python port is planned. The actual-manual
runner is explicitly "bridged-indefinite" because the Playwright Node ABI is the point:
the browser control plane is Node-native and the MLX HTTP call is already in-runner.
Calling it "deferred" would be dishonest about the migration plan and invite am-5 (Python
sidecar story) to accidentally absorb the wrong slice. Use "bridged-indefinite" for any
surface where the Node/Python split is deliberate by design, not tech-debt.

## Python-first carve-out is load-bearing policy, not a nicety

The charter entry explicitly states "grounding/verify logic that can be Python should be."
This creates a legal obligation for am-4 (runner impl) to put parsing + truth-signal
evaluation helpers in Python rather than Node. Without that line in the charter, am-4 has
no guidance and will default to putting everything in Node (it's faster to implement).
