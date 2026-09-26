### Phase B3: Structured Outline (large scope only)

9. **Produce structured outline.** `SendMessage` to the technical writer with the `structured-outline` skill (`skills/hive/skills/structured-outline/SKILL.md`, which enforces all mandatory parts and the completeness gate — Risk Registry and Elicitation are not optional). Input: H/V plans + design discussion + user feedback + research brief. Output: a ~1000-line structured outline with detailed approach, file manifest, risk registry, and elicitation questions. The outline now builds ON the vertical slice plan — each phase in the outline maps to a vertical slice.

9b. **Collaborative review gate (if enabled).** If `hive.config.yaml → planning.collaborative_review` is `true` (default), and `--lite` is NOT active, run the collaborative review gate on the structured outline. This is the most critical review — all active team agents review the full outline. The TPM validates sequencing, the researcher confirms technical accuracy, the architect (if present) stress-tests feasibility, and the UI designer (if present) validates UI approach. Collect feedback, have the writer revise if needed. If `false`, skip and proceed directly.

   **UI Designer SCALE_CALL revision (step 9b only) — two-gate precedence rule:** If ui-designer emits a `SCALE_CALL` field in their step 9b review response, apply **last gate wins**:
   - **Revised to `pre-exec`:** delete any existing ui-designer escalation entry in cycle state, then write the step 9b `ESCALATION:` block as a fresh entry. Log: `"ui-designer scale call revised at step 9b to pre-exec — writing fresh escalation"`
   - **Revised to `in-planning`:** delete any existing ui-designer escalation entry in cycle state (step 4b pre-exec call is superseded). Log: `"ui-designer scale call revised at step 9b to in-planning — escalation removed"`
   - **No step 9b revision:** step 4b value stands unchanged; no action needed

10. **Present structured outline to user.** Show the full document, including a summary of team review findings. The elicitation section (Part 7) contains the agent team's own stress-test of the plan — the user reads the team's answers to evaluate whether the thinking is sound. The user then:
    - Flags any elicitation answers that seem weak or wrong
    - Responds to the decision points (Part 8) — numbered affirm/change items
    - Provides final sign-off or requests revisions

    This sign-off gate is always local to the orchestrator, including when the
    structured outline was produced by CC-Workflows-dispatched or
    Multica-dispatched planning personas. Do not let Workflow tool completion,
    Multica issue completion, or episode markers imply sign-off.

    Incorporate feedback into the planning context before proceeding.

    **S2.1 seam 3 — waiting-on-user `phase_blocked` emission.** Before presenting the document and pausing for input, emit one `phase_blocked` triple keyed to this gate. The emit is fire-and-forget (CLI swallows knob==off + missing-sqlite; do NOT branch on its exit code):

    ```bash
    python3 -m hive.lib.kg_emit_cli \
      --subject "{epic_id}" \
      --predicate "phase_blocked" \
      --object "waiting-user-input-structured-outline-sign-off" \
      --source-epic "{epic_id}" \
      --source-agent "orchestrator"
    ```

    Apply the same pattern at the two other waiting-on-user pauses in /plan: design-discussion review (Phase B) gate uses `--object "waiting-user-input-design-discussion"`, and H/V plan review gate uses `--object "waiting-user-input-hv-plan-review"`. Gate-name slugs are kebab-stable so /meta-optimize can group by gate. Add no new error handling — the CLI is silent on failure by design.
