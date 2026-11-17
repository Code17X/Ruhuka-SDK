export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmContext {
  entityTypes: string[];
  remainingToolCalls: number;
  // Trusted server/test injection only. An empty key explicitly selects mock mode.
  apiKey?: string;
  fetch?: typeof globalThis.fetch;
  signal?: AbortSignal;
}

export interface LlmResult {
  reply: string | null;
  toolCalls: ToolCall[];
}

/** One provider step. Tool execution and authorization belong to ai-chat.ts. */
export async function chatWithTools(
  messages: ChatMessage[],
  tools: readonly ToolDefinition[],
  context: LlmContext,
): Promise<LlmResult> {
  const apiKey = context.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) {
    let lastUser = messages.length - 1;
    while (lastUser >= 0 && messages[lastUser].role !== "user") lastUser--;
    const turn = messages.slice(lastUser + 1);
    const calls = turn.flatMap((message) => message.tool_calls ?? []);
    const called = new Set(calls.map((call) => call.function.name));
    const listed = new Set(
      calls
        .filter((call) => call.function.name === "list_accessible_entities")
        .map(
          (call) =>
            (JSON.parse(call.function.arguments) as { entityType: string })
              .entityType,
        ),
    );
    const request = (
      name: string,
      args: Record<string, unknown>,
    ): LlmResult => ({
      reply: null,
      toolCalls: [
        {
          id: `mock_${lastUser}_${calls.length}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    });
    if (context.remainingToolCalls > 0) {
      if (!called.has("get_current_user_context"))
        return request("get_current_user_context", {});
      // Generic deterministic fixture: enumerate configured types, with requested
      // types first. This is a scoped data preview, not simulated reasoning.
      const question = messages[lastUser]?.content?.toLowerCase() ?? "";
      const types = [...context.entityTypes].sort(
        (a, b) =>
          Number(question.includes(b)) - Number(question.includes(a)) ||
          a.localeCompare(b),
      );
      const next = types.find((type) => !listed.has(type));
      if (next)
        return request("list_accessible_entities", {
          entityType: next,
          limit: 50,
        });
    }
    const records: string[] = [];
    for (const message of turn) {
      if (message.role !== "tool" || !message.content) continue;
      const result = JSON.parse(message.content) as { entities?: unknown[] };
      for (const entity of result.entities ?? [])
        records.push(JSON.stringify(entity));
    }
    return {
      reply: records.length
        ? `Mock assistant: Here are the authorized records retrieved this turn (a limited preview, not a complete analysis):\n${records.join("\n")}`
        : "Mock assistant: I could not retrieve any authorized entity records for this request.",
      toolCalls: [],
    };
  }

  const response = await (context.fetch ?? globalThis.fetch)(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: context.signal ?? AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages,
        tools,
        tool_choice: context.remainingToolCalls > 0 ? "auto" : "none",
        parallel_tool_calls: false,
        temperature: 0,
        max_completion_tokens: 2048,
        store: false,
      }),
    },
  );
  // Never surface upstream bodies, which can contain prompts or credentials.
  if (!response.ok) throw new Error("AI provider request failed");
  const body = (await response.json()) as {
    choices?: {
      finish_reason?: string;
      message?: { content?: unknown; tool_calls?: unknown };
    }[];
  };
  const choice = body.choices?.[0];
  const message = choice?.message;
  if (!message || !["stop", "tool_calls"].includes(choice?.finish_reason ?? ""))
    throw new Error("Invalid AI provider response");
  const calls = message.tool_calls ?? [];
  if (!Array.isArray(calls) || calls.length > 10)
    throw new Error("Invalid AI tool calls");
  const ids = new Set<string>();
  for (const call of calls) {
    if (
      !call ||
      typeof call !== "object" ||
      call.type !== "function" ||
      typeof call.id !== "string" ||
      !call.id ||
      call.id.length > 200 ||
      ids.has(call.id) ||
      typeof call.function?.name !== "string" ||
      typeof call.function?.arguments !== "string" ||
      call.function.arguments.length > 8192
    )
      throw new Error("Invalid AI tool call");
    ids.add(call.id);
  }
  if (
    message.content !== null &&
    message.content !== undefined &&
    typeof message.content !== "string"
  )
    throw new Error("Invalid AI reply");
  const reply = typeof message.content === "string" ? message.content : null;
  if ((!calls.length && !reply?.trim()) || (reply?.length ?? 0) > 64_000)
    throw new Error("Invalid AI reply");
  return { reply, toolCalls: calls as ToolCall[] };
}
