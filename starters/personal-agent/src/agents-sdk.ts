import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest, type AgentContext } from "agents";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText,
  tool,
  type StreamTextOnFinishCallback,
  type ToolSet
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

type RuntimeEnv = Record<string, unknown> & {
  AI: unknown;
  ASSETS?: AssetBinding;
  OPEN_THINK_AGENT_NAME?: string;
  OPEN_THINK_CF_ACCOUNT_ID?: string;
  OPEN_THINK_CF_API_TOKEN?: string;
  OPEN_THINK_DEFAULT_MODEL?: string;
  OPEN_THINK_DEPLOYMENT_ID?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
};

type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all";

const defaultModel = "@cf/moonshotai/kimi-k2.6";
const defaultToolApprovalPolicy: ToolApprovalPolicy = "auto";
const docsMcpServerUrl = "https://docs.mcp.cloudflare.com/mcp";
const cloudflareMcpServerUrl = "https://mcp.cloudflare.com/mcp";

export class PersonalChatAgent extends AIChatAgent<RuntimeEnv> {
  maxPersistedMessages = 200;
  waitForMcpConnections = { timeout: 10_000 };
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
        toolApprovalPolicy: this.toolApprovalPolicy(),
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
      chat: {
        transport: "websocket",
        streaming: "resumable-ui-message-stream",
        persistence: "AIChatAgent SQLite",
        clientHooks: ["useAgent", "useAgentChat"],
        streamResponse: "toUIMessageStreamResponse"
      },
      mcp: {
        state: "mcp/state",
        add: "mcp/add",
        toolApprovalPolicy: this.toolApprovalPolicy()
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
        `Use connected MCP tools when they are relevant. Current MCP tool approval policy: ${this.toolApprovalPolicy()}.`,
        `Deployment id: ${env.OPEN_THINK_DEPLOYMENT_ID ?? "local"}`,
        `Cloudflare account id: ${env.OPEN_THINK_CF_ACCOUNT_ID ?? "not configured"}`
      ].join("\n"),
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages"
      }),
      tools: {
        ...this.mcpToolsWithApprovalPolicy(),
        ...this.builtinTools()
      },
      stopWhen: stepCountIs(5),
      ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      onFinish
    });

    return result.toUIMessageStreamResponse({ sendReasoning: false });
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

  private builtinTools(): ToolSet {
    return {
      getUserTimezone: tool({
        description: "Get the owner's browser timezone, locale, and local time from the connected client.",
        inputSchema: z.object({})
      }),
      confirmCloudflareOperation: tool({
        description:
          "Request owner approval before a destructive, expensive, or security-sensitive Cloudflare operation. This checkpoint does not execute the operation by itself.",
        inputSchema: z.object({
          operation: z.string().describe("The Cloudflare operation that needs approval"),
          risk: z.string().describe("Why approval is needed"),
          resources: z.array(z.string()).default([]).describe("Cloudflare resources affected by the operation")
        }),
        needsApproval: async () => true,
        execute: async ({ operation, risk, resources }) => ({
          approved: true,
          operation,
          risk,
          resources,
          approvedAt: new Date().toISOString()
        })
      })
    };
  }

  private mcpToolsWithApprovalPolicy(): ToolSet {
    const policy = this.toolApprovalPolicy();
    const tools = this.mcp.getAITools();
    return Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => {
        if (policy === "allow-all") {
          const { needsApproval: _needsApproval, ...withoutApproval } = definition;
          return [name, withoutApproval];
        }
        return [
          name,
          {
            ...definition,
            needsApproval: async () =>
              policy === "ask-every-time" || shouldAutoRequireToolApproval(name, definition)
          }
        ];
      })
    ) as ToolSet;
  }

  private toolApprovalPolicy(): ToolApprovalPolicy {
    return normalizeToolApprovalPolicy(this.runtimeEnv.OPEN_THINK_TOOL_APPROVAL_POLICY);
  }

  private get runtimeEnv(): RuntimeEnv {
    return this.agentEnv;
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    const routed = await routeAgentRequest(request, env, { cors: true });
    if (routed) return routed;

    const url = new URL(request.url);
    if (
      env.ASSETS &&
      (url.pathname === "/" ||
        url.pathname === "/index.html" ||
        url.pathname.startsWith("/assets/") ||
        url.pathname.endsWith(".js") ||
        url.pathname.endsWith(".css"))
    ) {
      return (env.ASSETS as AssetBinding).fetch(request);
    }

    if (url.pathname === "/") {
      return Response.json({
        runtime: "cloudflare-agents-sdk",
        agent: "PersonalChatAgent",
        websocket: "/agents/personal-chat-agent/default",
        chatProtocol: "AIChatAgent/useAgentChat",
        chat: {
          transport: "websocket",
          streaming: "resumable-ui-message-stream",
          persistence: "AIChatAgent SQLite",
          clientHooks: ["useAgent", "useAgentChat"]
        },
        mcp: {
          toolApprovalPolicy: normalizeToolApprovalPolicy(env.OPEN_THINK_TOOL_APPROVAL_POLICY)
        }
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

function normalizeToolApprovalPolicy(value: unknown): ToolApprovalPolicy {
  const normalized = String(value ?? defaultToolApprovalPolicy)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  if (normalized === "ask-every-time" || normalized === "ask-everytime") return "ask-every-time";
  if (normalized === "allow-all" || normalized === "allowall") return "allow-all";
  return defaultToolApprovalPolicy;
}

function shouldAutoRequireToolApproval(name: string, definition: ToolSet[string]): boolean {
  const description =
    typeof (definition as { description?: unknown }).description === "string"
      ? String((definition as { description?: unknown }).description)
      : "";
  const normalizedName = name.replace(/^tool_[a-z0-9]+_/i, "").toLowerCase();
  const descriptionText = description.toLowerCase();
  const safeReadPattern =
    /\b(get|list|read|search|find|lookup|describe|inspect|query|fetch|check|status|audit|analyze|summarize)\b/;
  const riskyActionPattern =
    /\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy)\b/;
  const riskyPattern =
    /\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy|access|dns|route|worker|r2|d1|queue|vectorize)\b/;

  if (safeReadPattern.test(normalizedName) && !riskyActionPattern.test(normalizedName)) return false;
  if (riskyPattern.test(`${normalizedName} ${descriptionText}`)) return true;
  return !safeReadPattern.test(descriptionText);
}
