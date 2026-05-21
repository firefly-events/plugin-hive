const DEFAULT_RATE_LIMIT_RETRIES = 2;

function storyParams(story) {
  return {
    title: story.title,
    body: story.description,
    labels: story.labels,
    parent_id: story.parent_id,
  };
}

function authFailureMessage(result, adapter) {
  const message = result?.message || "Task-tracking authentication failed.";
  if (adapter === "multica" && !message.includes("/hive:multica-init")) {
    return `${message} Run /hive:multica-init to configure Multica credentials.`;
  }
  return message;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runDispatchLoop({
  stories,
  dispatch,
  config = {},
  onAuthFailure,
  onRateLimit,
  onWarning,
  sleep = defaultSleep,
  maxRateLimitRetries = DEFAULT_RATE_LIMIT_RETRIES,
}) {
  const adapter = config?.task_tracking?.adapter ?? config?.adapter ?? null;
  const warnings = [];
  const published = [];

  if (!adapter) {
    return { ok: true, aborted: false, published, warnings };
  }

  for (const story of stories) {
    let rateLimitAttempts = 0;

    while (true) {
      const result = await dispatch.invoke(
        "createStory",
        storyParams(story),
        { skill_context: "plan" },
      );

      if (result.ok) {
        story.tracker_id = result.result.id;
        story.tracker_url = result.result.url;
        published.push(story.id);
        break;
      }

      if (result.code === "NO_ADAPTER") {
        return { ok: true, aborted: false, published, warnings };
      }

      if (result.code === "AUTH_FAILURE") {
        const message = authFailureMessage(result, adapter);
        if (onAuthFailure) await onAuthFailure(message, { story, result });
        return { ok: false, aborted: true, code: "AUTH_FAILURE", message, published, warnings };
      }

      if (result.code === "RATE_LIMIT" && result.recoverable) {
        if (rateLimitAttempts >= maxRateLimitRetries) {
          const warning = result.message || "Task-tracking rate limit persisted; skipping story.";
          warnings.push(warning);
          if (onWarning) await onWarning(warning, { story, result });
          break;
        }
        const retryAfterMs = result.retry_after_ms ?? 0;
        rateLimitAttempts += 1;
        if (onRateLimit) await onRateLimit(retryAfterMs, { story, result });
        await sleep(retryAfterMs);
        continue;
      }

      const warning = result.message || `Task-tracking publish failed: ${result.code}`;
      warnings.push(warning);
      if (onWarning) await onWarning(warning, { story, result });
      break;
    }
  }

  return { ok: true, aborted: false, published, warnings };
}
