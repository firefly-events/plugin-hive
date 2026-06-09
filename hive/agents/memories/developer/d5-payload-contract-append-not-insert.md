# d-5: Payload contract section goes at END of wireframe-protocol.md — not between touchpoints

When adding the "Handoff Payload Contract" section to wireframe-protocol.md, the correct
insertion point is AFTER "Integration with Workflows" (end of file), NOT between existing
touchpoint blocks. Research confirmed this: inserting between Touchpoint Execution Context
and Integration with Workflows would split logically coupled sections.

The researcher's recommended location was "append after 'Integration with Workflows'
(line 99, end of file) to avoid splitting touchpoint execution context from the touchpoints."
This is the right call. The payload-contract section describes a _different concern_ (bundled
artifact shape) than the interactive approval touchpoints; it belongs in its own appended
section rather than interrupting the touchpoint flow.

Lesson: when a reference doc has well-scoped sequential sections (Touchpoint 1 → Touchpoint 2
→ Story YAML → Execution Context → Integration), always append a new orthogonal concern at
the end rather than trying to find a logical insertion point between existing sections.
