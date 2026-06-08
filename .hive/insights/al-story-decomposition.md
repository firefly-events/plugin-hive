# Artifact Lifecycle Story Decomposition Insights

- Keep the executable cleanup scope narrower than the inventory. The research inventory names many tracked artifacts as age-archivable, but D1/D2 turn those into registry/reporting work only; stories that mix report-only tracked classes with untracked eviction make the implementation look larger and risk violating the design gate.
- Treat `archive_action` vocabulary as a safety boundary, not just naming. Separating `evict`, `retire`, and `report` lets downstream stories test that OS-temp movement is transient cleanup and that tracked deletion remains deferred.
- Scan scope needs its own story because it crosscuts every artifact class. Without a separate resolved-state-dir plus legacy `.pHive` diagnostic slice, each cleanup story would have to rediscover the same duplicate/skipped-artifact behavior.
