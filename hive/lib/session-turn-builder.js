/**
 * Session Turn Builder
 *
 * Constructs typed event objects for the Managed Agents /v1/sessions/{id}/events API.
 *
 * Event types:
 *   user.message             — first turn or follow-up text
 *   user.custom_tool_result  — result for a custom tool call
 *   user.tool_confirmation   — allow/deny for a built-in tool use
 */

'use strict';

/**
 * Build a user.message event (first turn or follow-up).
 *
 * @param {string} text - content text
 * @returns {Object} user.message event object
 */
function buildMessage(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('buildMessage: text must be a non-empty string');
  }
  return {
    type: 'user.message',
    content: [{ type: 'text', text }],
  };
}

/**
 * Build the first user.message from assembled prompt content.
 * Alias of buildMessage for clarity at the call site in session-invoke.mjs.
 *
 * @param {string} content - assembled prompt string from session-prompt-builder
 * @param {Array}  [specialists] - optional specialists list; capped at 10 here regardless of call path
 * @returns {Object} user.message event object
 */
function buildFirstMessage(content, specialists) {
  specialists = specialists ? specialists.slice(0, 10) : [];
  return buildMessage(content);
}

/**
 * Build a user.custom_tool_result event.
 *
 * @param {string} customToolUseId - from stop_reason.event_ids lookup
 * @param {string} result - text result from tool execution
 * @returns {Object} user.custom_tool_result event object
 */
function buildCustomToolResult(customToolUseId, result) {
  if (!customToolUseId) throw new Error('buildCustomToolResult: customToolUseId is required');
  return {
    type: 'user.custom_tool_result',
    custom_tool_use_id: customToolUseId,
    content: [{ type: 'text', text: String(result) }],
  };
}

/**
 * Build a user.tool_confirmation event.
 *
 * @param {string} toolUseId - from stop_reason.event_ids lookup
 * @param {string} result - 'allow' or 'deny'
 * @param {string} [denyMessage] - optional reason when result is 'deny'
 * @returns {Object} user.tool_confirmation event object
 */
function buildToolConfirmation(toolUseId, result, denyMessage) {
  if (!toolUseId) throw new Error('buildToolConfirmation: toolUseId is required');
  if (result !== 'allow' && result !== 'deny') {
    throw new Error(`buildToolConfirmation: result must be 'allow' or 'deny', got: ${result}`);
  }
  const event = {
    type: 'user.tool_confirmation',
    tool_use_id: toolUseId,
    result,
  };
  if (result === 'deny' && denyMessage) {
    event.deny_message = denyMessage;
  }
  return event;
}

module.exports = { buildMessage, buildFirstMessage, buildCustomToolResult, buildToolConfirmation };
