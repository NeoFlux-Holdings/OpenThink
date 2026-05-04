import {
  BaseAgent,
  type AgentMessage,
  type ILLMService,
  type IMcpServer,
  type IStorageService,
  type ITaskQueue,
  type ITerminalSession,
  type IVectorStore
} from "@open-think/core";
import { type WorkersAIBinding, WorkersAIService } from "@open-think/llm";
import { createCloudflareApiMcpServer } from "@open-think/mcp";
import { type VectorizeIndexLike, VectorizeStore } from "@open-think/retrieval";
import {
  InMemoryStorageService,
  type R2BucketLike,
  R2StorageService
} from "@open-think/storage";
import { CloudflareQueue, type QueueLike } from "@open-think/tasks";
import { BrowserTerminalSession, localCloudflaredCommand } from "@open-think/terminal";

export type PersonalAgentCapability =
  | "chat"
  | "coding"
  | "messaging"
  | "files"
  | "memory"
  | "tasks"
  | "terminal"
  | "mcp";

export interface PersonalAgentTask {
  kind: "coding" | "message" | "memory" | "workflow" | "terminal";
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface PersonalAgentOptions {
  agentId?: string;
  agentName?: string;
  platformHost?: string;
  model?: string;
  llm?: ILLMService;
  ai?: WorkersAIBinding;
  storage?: IStorageService;
  r2?: R2BucketLike;
  vectorStore?: IVectorStore;
  vectorize?: VectorizeIndexLike;
  taskQueue?: ITaskQueue<PersonalAgentTask>;
  queue?: QueueLike<PersonalAgentTask>;
  terminal?: ITerminalSession;
  mcpServers?: IMcpServer[];
}

export interface TerminalHandoff {
  browserPath: string;
  localCommand: string;
}

export class PersonalAgent extends BaseAgent {
  readonly id: string;
  readonly name: string;
  private readonly storage: IStorageService;
  private readonly taskQueue: ITaskQueue<PersonalAgentTask> | undefined;
  private readonly terminal: ITerminalSession;
  private readonly vectorStore: IVectorStore | undefined;
  private readonly platformHost: string;

  constructor(options: PersonalAgentOptions) {
    const llm = resolveLlm(options);
    const storage = resolveStorage(options);
    const mcpServers = [createCloudflareApiMcpServer(), ...(options.mcpServers ?? [])];

    super({
      llm,
      storage,
      mcpServers
    });

    this.id = options.agentId ?? crypto.randomUUID();
    this.name = options.agentName ?? "Personal Agent";
    this.storage = storage;
    this.taskQueue = resolveTaskQueue(options);
    this.terminal = options.terminal ?? new BrowserTerminalSession();
    this.vectorStore = resolveVectorStore(options);
    this.platformHost = options.platformHost ?? "beta2.open-think.app";
  }

  capabilities(): PersonalAgentCapability[] {
    return ["chat", "coding", "messaging", "files", "memory", "tasks", "terminal", "mcp"];
  }

  async chat(input: {
    conversationId: string;
    message: string;
    context?: string;
  }): Promise<AgentMessage> {
    return this.run({
      conversationId: input.conversationId,
      prompt: input.message,
      system: [
        `You are ${this.name}, an open-think personal agent.`,
        "You help with coding, messaging, chat, task planning, files, memory, terminal workflows, and Cloudflare operations.",
        "Keep responses concrete, operational, and scoped to the user's own Cloudflare resources.",
        input.context ? `Context:\n${input.context}` : ""
      ]
        .filter(Boolean)
        .join("\n")
    });
  }

  async remember(key: string, value: unknown): Promise<void> {
    await this.storage.put(`memory:${key}`, {
      value,
      updatedAt: new Date().toISOString()
    });
  }

  async recall<T = unknown>(key: string): Promise<T | null> {
    const record = await this.storage.get<{ value: T }>(`memory:${key}`);
    return record?.value ?? null;
  }

  async queueTask(
    kind: PersonalAgentTask["kind"],
    payload: Record<string, unknown>
  ): Promise<{ queued: boolean; reason?: string }> {
    if (!this.taskQueue) {
      return {
        queued: false,
        reason: "Task queue binding is not configured."
      };
    }

    await this.taskQueue.enqueue({
      kind,
      payload,
      createdAt: new Date().toISOString()
    });

    return { queued: true };
  }

  async semanticMemoryQuery(vector: number[], topK = 5) {
    if (!this.vectorStore) return [];
    return this.vectorStore.query(vector, { topK });
  }

  terminalHandoff(): TerminalHandoff {
    return {
      browserPath: "/terminal",
      localCommand: localCloudflaredCommand(this.id, this.platformHost)
    };
  }

  terminalSession(): ITerminalSession {
    return this.terminal;
  }
}

export function createPersonalAgent(options: PersonalAgentOptions): PersonalAgent {
  return new PersonalAgent(options);
}

function resolveLlm(options: PersonalAgentOptions): ILLMService {
  if (options.llm) return options.llm;
  if (options.ai) return new WorkersAIService(options.ai, options.model);
  throw new Error("PersonalAgent requires an ILLMService or Workers AI binding.");
}

function resolveStorage(options: PersonalAgentOptions): IStorageService {
  if (options.storage) return options.storage;
  if (options.r2) return new R2StorageService(options.r2);
  return new InMemoryStorageService();
}

function resolveTaskQueue(
  options: PersonalAgentOptions
): ITaskQueue<PersonalAgentTask> | undefined {
  if (options.taskQueue) return options.taskQueue;
  if (options.queue) return new CloudflareQueue(options.queue);
  return undefined;
}

function resolveVectorStore(options: PersonalAgentOptions): IVectorStore | undefined {
  if (options.vectorStore) return options.vectorStore;
  if (options.vectorize) return new VectorizeStore(options.vectorize);
  return undefined;
}
