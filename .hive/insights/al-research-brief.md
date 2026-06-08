# al-research-brief insights

- For artifact-lifecycle planning briefs, separate "Git-tracked archive" from "filesystem move archive" early. The distinction prevents the document from treating committed `.pHive` planning state and ignored runtime state as one cleanup problem.
- Preserve verbatim machine-read sections exactly when requested. In this task, `inconsistency_risk_signals` is consumed by grill, so renaming, summarizing, or changing bullet shape would create downstream risk.
