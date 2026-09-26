import type { AiMessage, AiToolRequest, AiToolResult, UserRole } from "@adaptive/shared";

export interface AiProvider {
  generate(input: {role: UserRole; messages: AiMessage[]; tools: AiToolRequest[]}):
    Promise<{text: string; toolRequests: AiToolRequest[]}>;
}

export interface AiTool {
  name: string;
  description: string;
  execute(input: unknown): Promise<AiToolResult>;
}

export class MockAiProvider implements AiProvider {
  async generate(input: {role: UserRole; messages: AiMessage[]; tools: AiToolRequest[]}) {
    const last = input.messages.at(-1)?.content ?? "";
    return {text: `Mock ${input.role} assistant received: ${last}`, toolRequests: []};
  }
}

export class AiOrchestrator {
  constructor(private readonly provider: AiProvider) {}
  generate(input: {role: UserRole; messages: AiMessage[]}) {
    return this.provider.generate({...input, tools: []});
  }
}
