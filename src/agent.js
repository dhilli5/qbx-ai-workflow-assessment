const { mockLlm } = require("./llm/mockLlm");
const { safeParse } = require("./llm/schema");
const { TOOL_REGISTRY } = require("./tools/tools");
const {
  detectPromptInjection,
  enforceToolAllowlist,
  validateLlmResponse
} = require("./guardrails");

/**
 * runAgentForItem(ticket, config)
 *
 * config:
 *  - maxToolCalls
 *  - maxLlmAttempts
 *
 * Must return:
 * {
 *   id,
 *   status: "DONE" | "NEEDS_CLARIFICATION" | "REJECTED",
 *   plan: string[],
 *   tool_calls: { tool: string, args: object }[],
 *   final: { action: "SEND_EMAIL_DRAFT" | "REQUEST_INFO" | "REFUSE", payload: object },
 *   safety: { blocked: boolean, reasons: string[] }
 * }
 *
 * Behavior enforced by tests:
 * - Prompt injection in ticket.user_request => REJECTED, safety.blocked true, tool_calls []
 * - If mock LLM requests a tool not in allowed_tools => REJECTED
 * - For "latest report" requests => must execute lookupDoc at least once, then DONE with SEND_EMAIL_DRAFT
 * - For default ("Can you help me...") => DONE with REQUEST_INFO
 * - For MALFORMED ticket => retry parsing; ultimately REJECTED cleanly
 *
 * Bounded:
 * - max tool calls per ticket: config.maxToolCalls
 * - max LLM attempts per ticket: config.maxLlmAttempts
 */
async function runAgentForItem(ticket, config) {
  const maxToolCalls = config?.maxToolCalls ?? 3;
  const maxLlmAttempts = config?.maxLlmAttempts ?? 3;

  const plan = [];
  const tool_calls = [];
  const safety = { blocked: false, reasons: [] };

  // Step 1: Prompt injection detection
  const injectionIssues = detectPromptInjection(ticket.user_request);
  if (injectionIssues.length > 0) {
    safety.blocked = true;
    safety.reasons = injectionIssues;
    return {
      id: ticket.id,
      status: "REJECTED",
      plan: ["Blocked due to prompt injection"],
      tool_calls: [],
      final: { action: "REFUSE", payload: { reason: "Security policy violation" } },
      safety
    };
  }

  // Step 2: Build initial messages
  const messages = [
    {
      role: "system",
      content: `You are a helpful assistant. You can use tools or provide a final response.
Available tools: ${ticket.context.allowed_tools.join(", ")}.
Respond with valid JSON only.`
    },
    {
      role: "user",
      content: ticket.user_request
    }
  ];

  // Step 3: Agent loop
  let llmAttempts = 0;
  let toolCallCount = 0;

  while (llmAttempts < maxLlmAttempts) {
    llmAttempts++;

    const llmResponse = await mockLlm(messages);
    const parseResult = safeParse(llmResponse);

    if (!parseResult.ok) {
      // Malformed JSON - retry with stricter message
      plan.push(`Attempt ${llmAttempts}: Malformed JSON, retrying`);
      messages.push({
        role: "system",
        content: "Your previous response was not valid JSON. Please respond with valid JSON only."
      });
      continue;
    }

    const validation = validateLlmResponse(parseResult.value);

    if (!validation.ok) {
      plan.push(`Attempt ${llmAttempts}: Invalid response schema`);
      return {
        id: ticket.id,
        status: "REJECTED",
        plan,
        tool_calls,
        final: { action: "REFUSE", payload: { reason: validation.reason } },
        safety
      };
    }

    if (validation.type === "tool_call") {
      const { tool, args } = parseResult.value;

      // Enforce tool allowlist
      if (!enforceToolAllowlist(tool, ticket.context.allowed_tools)) {
        plan.push(`Tool ${tool} not in allowlist`);
        return {
          id: ticket.id,
          status: "REJECTED",
          plan,
          tool_calls,
          final: { action: "REFUSE", payload: { reason: `Tool ${tool} not allowed` } },
          safety
        };
      }

      // Check tool call limit
      if (toolCallCount >= maxToolCalls) {
        plan.push("Max tool calls reached");
        return {
          id: ticket.id,
          status: "REJECTED",
          plan,
          tool_calls,
          final: { action: "REFUSE", payload: { reason: "Max tool calls exceeded" } },
          safety
        };
      }

      // Execute tool
      try {
        const toolFn = TOOL_REGISTRY[tool];
        if (!toolFn) {
          throw new Error(`Tool ${tool} not found in registry`);
        }

        const result = toolFn(args);
        toolCallCount++;
        tool_calls.push({ tool, args });
        plan.push(`Executed ${tool}`);

        // Add tool result to messages
        messages.push({
          role: "assistant",
          content: `TOOL_RESULT: ${JSON.stringify(result)}`
        });
      } catch (err) {
        plan.push(`Tool ${tool} failed: ${err.message}`);
        messages.push({
          role: "assistant",
          content: `TOOL_ERROR: ${err.message}`
        });
      }
    } else if (validation.type === "final") {
      // Final response
      plan.push("Received final response");
      return {
        id: ticket.id,
        status: "DONE",
        plan,
        tool_calls,
        final: parseResult.value.final,
        safety
      };
    }
  }

  // Max attempts reached
  return {
    id: ticket.id,
    status: "REJECTED",
    plan,
    tool_calls,
    final: { action: "REFUSE", payload: { reason: "Max LLM attempts exceeded" } },
    safety
  };
}

module.exports = {
  runAgentForItem
};