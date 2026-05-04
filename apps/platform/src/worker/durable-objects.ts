import type { AgentMessage } from "@open-think/core";
import type { WorkersAIBinding } from "@open-think/llm";
import { generateAgentReply } from "@/lib/model-router";

interface DurableObjectStorageLike {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

interface ContainerPort {
  hostname: string;
  port: number;
}

interface ContainerRuntimeLike {
  start(options?: { entrypoint?: string[]; keepAlive?: number }): Promise<void>;
  getTcpPort(port: number): Promise<ContainerPort>;
  monitor?(): Promise<{ status: string }>;
}

interface DurableObjectContextLike {
  storage: DurableObjectStorageLike;
  container?: ContainerRuntimeLike;
}

interface WorkerEnv {
  NEXT_PUBLIC_PLATFORM_HOST?: string;
  AI?: WorkersAIBinding;
  AI_GATEWAY_ENDPOINT?: string;
  AI_GATEWAY_API_KEY?: string;
}

export class ChatDO {
  constructor(
    private readonly ctx: DurableObjectContextLike,
    private readonly env: WorkerEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId") ?? "default";

    if (request.method === "GET") {
      const messages = await this.messages(conversationId);
      return Response.json({ messages });
    }

    if (request.method === "POST") {
      const payload = (await request.json().catch(() => ({}))) as { message?: string; userId?: string };
      const content = payload.message?.trim();

      if (!content) {
        return Response.json({ error: "Message is required." }, { status: 400 });
      }

      const userMessage = await this.append(conversationId, {
        role: "user",
        content,
        metadata: {
          userId: payload.userId ?? "unknown"
        }
      });
      const replyInput: Parameters<typeof generateAgentReply>[0] = {
        userId: payload.userId ?? "unknown",
        message: content,
        env: this.env as unknown as Record<string, unknown>
      };
      if (this.env.AI) replyInput.workersAI = this.env.AI;
      const reply = await generateAgentReply(replyInput);
      const assistantMessage = await this.append(conversationId, {
        role: "assistant",
        content: reply,
        metadata: {
          userMessageId: userMessage.id
        }
      });

      return Response.json({ message: assistantMessage });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  private async append(
    conversationId: string,
    input: Pick<AgentMessage, "role" | "content"> & {
      metadata?: Record<string, unknown>;
    }
  ): Promise<AgentMessage> {
    const message: AgentMessage = {
      id: crypto.randomUUID(),
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString()
    };
    if (input.metadata) message.metadata = input.metadata;
    await this.ctx.storage.put(`conversation:${conversationId}:message:${message.id}`, message);
    return message;
  }

  private async messages(conversationId: string): Promise<AgentMessage[]> {
    const records = await this.ctx.storage.list<AgentMessage>({
      prefix: `conversation:${conversationId}:message:`
    });

    return [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class TerminalDO {
  constructor(
    private readonly ctx: DurableObjectContextLike,
    private readonly env: WorkerEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname.endsWith("/start")) {
      const port = await this.startTerminal();
      await this.ctx.storage.put("terminal:status", {
        status: "running",
        port,
        updatedAt: new Date().toISOString()
      });
      return Response.json({ status: "running", port });
    }

    if (request.method === "POST" && url.pathname.endsWith("/write")) {
      const payload = (await request.json().catch(() => ({}))) as { data?: string };
      const status = await this.ctx.storage.get("terminal:status");
      if (!status) {
        return Response.json({ error: "Terminal has not been started." }, { status: 409 });
      }
      await this.ctx.storage.put("terminal:last-write", {
        data: payload.data ?? "",
        updatedAt: new Date().toISOString()
      });
      return Response.json({ ok: true, forwarded: true });
    }

    if (request.method === "GET") {
      const status = await this.ctx.storage.get("terminal:status");
      return Response.json(
        status ?? {
          status: "hibernating",
          localCommand: `cloudflared access ssh --hostname personal-agent.${this.env.NEXT_PUBLIC_PLATFORM_HOST ?? "beta2.open-think.app"}`
        }
      );
    }

    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  async startTerminal(): Promise<ContainerPort> {
    if (this.ctx.container) {
      await this.ctx.container.start({
        entrypoint: ["/bin/bash"],
        keepAlive: 600
      });
      return this.ctx.container.getTcpPort(8080);
    }

    throw new Error("Cloudflare Container runtime is required for TerminalDO.");
  }
}

export class AgentDO {
  constructor(
    private readonly ctx: DurableObjectContextLike,
    private readonly env: WorkerEnv
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const agentId = url.searchParams.get("agentId") ?? "default";

    if (request.method === "GET") {
      const config = await this.ctx.storage.get(`agent:${agentId}:config`);
      return Response.json(
        config ?? {
          id: agentId,
          status: "ready",
          model: "@cf/meta/llama-3.1-8b-instruct",
          host: this.env.NEXT_PUBLIC_PLATFORM_HOST ?? "beta2.open-think.app"
        }
      );
    }

    if (request.method === "PUT") {
      const config = await request.json();
      await this.ctx.storage.put(`agent:${agentId}:config`, {
        ...config,
        updatedAt: new Date().toISOString()
      });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }
}
