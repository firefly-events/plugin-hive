# Artifact lifecycle design discussion insight

When lifecycle policy spans both Git-tracked planning files and ignored runtime
files, the document should split "archive" semantics up front. Treat tracked
cleanup as committed `git rm` with Git history as the durable archive, and treat
ignored runtime cleanup as move-to-temp. Keeping that fork explicit prevents the
rest of the design from mixing reviewable branch deletions with nondurable local
temp retention.
