#!/usr/bin/env bash
# s5 fresh-clone payload + read-safety verification. Usage: verify-payload.sh <branch>
set -euo pipefail
BRANCH="${1:-feat/plugin-hygiene-remediation}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone -q --branch "$BRANCH" --single-branch "file://$(git rev-parse --show-toplevel)" "$TMP/c"
cd "$TMP/c"
python3 -c "import subprocess,os;fs=[f for f in subprocess.check_output(['git','ls-files','-z']).split(b'\0') if f];print('files',len(fs),'bytes',sum(os.path.getsize(f) for f in fs if os.path.exists(f)))"
for t in .pHive/metrics .pHive/test-scenarios .pHive/multica .pHive/project-profile.yaml .pHive/hive.config.yaml; do
  [ "$(git ls-files "$t" | wc -l)" -gt 0 ] || { echo "FAIL keep-tracked missing: $t"; exit 1; }
done
[ "$(git ls-files '.pHive/episodes/' | wc -l)" -eq 0 ] || { echo "FAIL episodes leaked"; exit 1; }
echo "VERIFY OK"
