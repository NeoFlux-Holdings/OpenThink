import type {
  AgentMessage,
  ILLMService,
  IMcpServer,
  IStorageService
} from "./interfaces/runtime";

export interface AgentRuntime {
  llm: ILLMService;
  storage?: IStorageService;
  mcpServers?: IMcpServer[];
}

export interface AgentRunInput {
  conversationId: string;
  prompt: string;
  system?: string;
}

export class BaseAgent {
  protected readonly runtime: AgentRuntime;

  constructor(runtime: AgentRuntime) {
    this.runtime = runtime;
  }

  async run(input: AgentRunInput): Promise<AgentMessage> {
    const prompt = input.system
      ? `${input.system}\n\nUser request:\n${input.prompt}`
      : input.prompt;
    const content = await this.runtime.llm.generate(prompt, {
      metadata: { conversationId: input.conversationId }
    });

    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content,
      createdAt: new Date().toISOString()
    };

    await this.runtime.storage?.put(
      `conversation:${input.conversationId}:message:${message.id}`,
      message
    );

    return message;
  }

  async listTools() {
    const servers = this.runtime.mcpServers ?? [];
    const tools = await Promise.all(servers.map((server) => server.listTools()));
    return tools.flat();
  }
}
