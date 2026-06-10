# b1-why-chromadb-fix — insights

- The "dictionary changed size during iteration" RuntimeError does not fire at the
  provider *call* (`chromadb_query_fn(topic, limit)` in `query_chromadb`) — it fires
  when the response Mapping is *consumed* inside `_extract_chroma_response`
  (`response.get(...)` / `list(records)`). That is why containment at the extraction
  function works: the crash surfaces lazily, on read, not on call. A fix wrapping the
  call site alone would miss it.
- `_extract_chroma_response` now copies list responses (`list(response)`) instead of
  returning the caller's object, so any iteration-time mutation happens inside the
  try/except scope rather than later in `query_chromadb`'s record loop.
- Catch is deliberately RuntimeError-only. ChromaDB unavailability already has a
  separate path (`available: False` envelope from the node bridge); other exception
  classes propagating is a feature — they indicate real bugs, not flaky providers.
- Diagnostic goes to stderr (`kg_why.chromadb_runtime_error reason=<msg>`), not stdout
  — stdout is the rendered triple output consumed by /hive:why, and the module has no
  logging framework; bare stderr print matches the file's zero-dependency style.
- Repro in tests: a `Mapping` subclass whose `.get` raises is the cleanest stand-in for
  the dict-mutation race — deterministic, no threads, exercises the same code path.
