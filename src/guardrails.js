const { isValidToolCall, isValidFinal } = require("./llm/schema");

/**
 * detectPromptInjection(text)
 *
 * Return array of detected issue codes (empty array if safe).
 * Tests expect prompt injection to be blocked for phrases like:
 * - ignore previous instructions
 * - reveal secrets
 * - override policy
 * - send confidential
 *
 * Suggested return codes:
 * - "PROMPT_INJECTION"
 */
function detectPromptInjection(text) {
  const issues = [];
  const patterns = [
    /ignore previous instructions/i,
    /reveal secrets/i,
    /override policy/i,
    /send confidential/i
  ];

  for (const pattern of patterns) {
    if (pattern.test(text)) {
      issues.push("PROMPT_INJECTION");
      break;
    }
  }

  return issues;
}

/**
 * enforceToolAllowlist(toolName, allowedTools)
 *
 * Return true if allowed, false otherwise.
 */
function enforceToolAllowlist(toolName, allowedTools) {
  return Array.isArray(allowedTools) && allowedTools.includes(toolName);
}

/**
 * validateLlmResponse(obj)
 *
 * Must return:
 * - { ok: true, type: "tool_call" } when obj is a valid tool call
 * - { ok: true, type: "final" } when obj is a valid final response
 * - { ok: false, reason: string } otherwise
 */
function validateLlmResponse(obj) {
  if (isValidToolCall(obj)) return { ok: true, type: "tool_call" };
  if (isValidFinal(obj)) return { ok: true, type: "final" };
  return { ok: false, reason: "Invalid LLM response schema" };
}

module.exports = {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
};