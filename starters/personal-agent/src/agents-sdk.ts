import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest, type AgentContext } from "agents";
import {
  convertToModelMessages,
  streamText,
  type StreamTextOnFinishCallback,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";

type RuntimeEnv = Record<string, unknown> & {
  AI: unknown;
  OPEN_THINK_AGENT_NAME?: string;
  OPEN_THINK_CF_ACCOUNT_ID?: string;
  OPEN_THINK_CF_API_TOKEN?: string;
  OPEN_THINK_DEFAULT_MODEL?: string;
  OPEN_THINK_DEPLOYMENT_ID?: string;
};

const defaultModel = "@cf/moonshotai/kimi-k2.6";
const docsMcpServerUrl = "https://docs.mcp.cloudflare.com/mcp";
const cloudflareMcpServerUrl = "https://mcp.cloudflare.com/mcp";

export class PersonalChatAgent extends AIChatAgent<RuntimeEnv> {
  maxPersistedMessages = 200;
  private readonly agentEnv: RuntimeEnv;

  constructor(ctx: AgentContext, env: RuntimeEnv) {
    super(ctx, env);
    this.agentEnv = env;
  }

  async onStart(): Promise<void> {
    await this.ensureDefaultMcpServers();
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith("/health")) {
      return Response.json({
        ok: true,
        runtime: "cloudflare-agents-sdk",
        agent: "PersonalChatAgent",
        defaultModel: this.runtimeEnv.OPEN_THINK_DEFAULT_MODEL ?? defaultModel,
        mcpServers: this.getMcpServers()
      });
    }

    if (url.pathname.endsWith("/mcp/add") && request.method === "POST") {
      const payload = await request.json().catch(() => ({}));
      const name = sanitizeMcpName(payload.name);
      const serverUrl = sanitizeHttpsUrl(payload.url ?? payload.serverUrl);
      if (!name) return Response.json({ error: "name is required" }, { status: 400 });
      if (!serverUrl) return Response.json({ error: "url must be HTTPS" }, { status: 400 });

      const headers = sanitizeHeaders(payload.headers);
      const result = await this.addMcpServer(
        name,
        serverUrl,
        headers ? { transport: { headers } } : undefined
      );

      return Response.json({
        id: result.id,
        state: result.state,
        authUrl: "authUrl" in result ? result.authUrl : null
      });
    }

    if (url.pathname.endsWith("/mcp/state")) {
      return Response.json(this.getMcpServers());
    }

    return Response.json({
      runtime: "cloudflare-agents-sdk",
      websocket: "/agents/personal-chat-agent/default",
      chatProtocol: "AIChatAgent/useAgentChat",
      mcp: {
        state: "mcp/state",
        add: "mcp/add"
      }
    });
  }

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ): Promise<Response> {
    await this.ensureDefaultMcpServers();

    const env = this.runtimeEnv;
    const workersai = createWorkersAI({ binding: env.AI as never });
    const result = streamText({
      model: workersai(env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel),
      system: [
        `You are ${env.OPEN_THINK_AGENT_NAME ?? "Personal Agent"}, an open-think personal agent running on Cloudflare Agents SDK.`,
        "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
        "Use connected MCP tools when they are relevant. For destructive or expensive Cloudflare actions, explain the exact operation and ask for confirmation first.",
        `Deployment id: ${env.OPEN_THINK_DEPLOYMENT_ID ?? "local"}`,
        `Cloudflare account id: ${env.OPEN_THINK_CF_ACCOUNT_ID ?? "not configured"}`
      ].join("\n"),
      messages: await convertToModelMessages(this.messages),
      tools: this.mcp.getAITools(),
      ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      onFinish
    });

    return result.toUIMessageStreamResponse();
  }

  private async ensureDefaultMcpServers(): Promise<void> {
    await this.addMcpServer("cloudflare-docs", docsMcpServerUrl).catch(() => undefined);

    if (this.runtimeEnv.OPEN_THINK_CF_API_TOKEN) {
      await this.addMcpServer("cloudflare-api", cloudflareMcpServerUrl, {
        transport: {
          headers: {
            Authorization: `Bearer ${this.runtimeEnv.OPEN_THINK_CF_API_TOKEN}`
          }
        }
      }).catch(() => undefined);
    }
  }

  private get runtimeEnv(): RuntimeEnv {
    return this.agentEnv;
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    const routed = await routeAgentRequest(request, env, { cors: true });
    if (routed) return routed;

    if (new URL(request.url).pathname === "/") {
      return Response.json({
        runtime: "cloudflare-agents-sdk",
        agent: "PersonalChatAgent",
        websocket: "/agents/personal-chat-agent/default",
        chatProtocol: "AIChatAgent/useAgentChat"
      });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
};

function sanitizeMcpName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function sanitizeHttpsUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? "").trim());
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeHeaders(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!/^[a-z0-9-]+$/i.test(key)) continue;
    if (typeof rawValue !== "string") continue;
    headers[key] = rawValue;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}
