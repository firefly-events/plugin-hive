# Planning Queue Design Discussion Insights

- Treat Hermes "plugin" work as two surfaces when routines are involved: directory plugins can package tools through `PluginContext.register_tool(...)`, but long-running Slack/Multica polling belongs to the gateway unless a routine registration API exists.
- For human-gate workflows, a label and a structured comment carry different responsibilities. The label is the operational scan signal; the comment is the durable question payload and context.
- When a locked design intentionally breaks a repo convention, keep the locked value as the default and make the name configurable instead of reopening the decision.
