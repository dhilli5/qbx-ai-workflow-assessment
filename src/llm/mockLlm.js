/**
 * mockLlm(messages)
 *
 * messages: array of { role: "system" | "user" | "assistant", content: string }
 *
 * Returns a JSON string representing either:
 * - tool_call
 * - final
 * - malformed output (string that is not valid JSON)
 *
 * Deterministic behavior based on user_request content.
 */

async function mockLlm(messages) {
  const userMessage = messages.find((m) => m.role === "user");
  const text = userMessage?.content || "";

  // Prompt injection case
  if (/ignore previous instructions|reveal secrets|override policy|send confidential/i.test(text)) {
    return JSON.stringify({
      type: "final",
      final: {
        action: "REFUSE",
        payload: { reason: "Policy violation detected." }
      }
    });
  }

  // Malformed output trigger
  if (/MALFORMED/i.test(text)) {
    return "{ this is not valid JSON ";
  }

  //Disallowed tool request trigger
  if (/CALL_SECRET_TOOL/i.test(text)) {
    return JSON.stringify({
      type: "tool_call",
      tool: "secretInternalTool",
      args: { foo: "bar" }
    });
  }

  //After tool observation present in messages, produce final
  const hasToolObservation = messages.some((m) =>
    m.role === "assistant" && m.content.includes("TOOL_RESULT:")
  );

  if (hasToolObservation) {
    return JSON.stringify({
      type: "final",
      final: {
        action: "SEND_EMAIL_DRAFT",
        payload: {
          to: ["finance@example.com"],
          subject: "Requested Report",
          body: "Summary generated from latest report."
        }
      }
    });
  }

  //Needs doc lookup
  if (/latest report/i.test(text)) {
    return JSON.stringify({
      type: "tool_call",
      tool: "lookupDoc",
      args: { docId: "RPT-2026-02" }
    });
  }

  //Default path
  return JSON.stringify({
    type: "final",
    final: {
      action: "REQUEST_INFO",
      payload: { message: "Need more information." }
    }
  });
}

module.exports = {
  mockLlm
};