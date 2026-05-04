import type { DeploymentRequest } from "./deployment-engine";

export interface AgentsSdkRuntimeBindingPlan {
  scriptName: string;
  databaseName: string;
  databaseId?: string;
  bucketName: string;
  queueName: string;
  vectorizeName: string;
}

export interface AgentsSdkRuntimeFile {
  path: string;
  contents: string;
}

export function renderAgentsSdkPersonalAgentRuntime(input: {
  request: DeploymentRequest;
  deploymentId: string;
  bindings: AgentsSdkRuntimeBindingPlan;
}): AgentsSdkRuntimeFile[] {
  return [
    {
      path: "package.json",
      contents: `${JSON.stringify(renderPackageJson(), null, 2)}\n`
    },
    {
      path: "wrangler.jsonc",
      contents: `${JSON.stringify(renderWranglerJsonc(input), null, 2)}\n`
    },
    {
      path: "src/server.ts",
      contents: renderServerTs(input)
    }
  ];
}

function renderPackageJson(): Record<string, unknown> {
  return {
    name: "open-think-personal-agent-sdk",
    version: "0.0.0",
    private: true,
    type: "module",
    scripts: {
      dev: "wrangler dev",
      deploy: "wrangler deploy",
      typecheck: "tsc --noEmit"
    },
    dependencies: {
      "@cloudflare/ai-chat": "^0.6.2",
      agents: "^0.12.3",
      ai: "^6.0.174",
      "workers-ai-provider": "^3.1.13"
    },
    devDependencies: {
      typescript: "latest",
      wrangler: "latest"
    }
  };
}

function renderWranglerJsonc(input: {
  request: DeploymentRequest;
  deploymentId: string;
  bindings: AgentsSdkRuntimeBindingPlan;
}): Record<string, unknown> {
  return {
    name: input.bindings.scriptName,
    main: "src/server.ts",
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat"],
    ai: { binding: "AI" },
    durable_objects: {
      bindings: [{ name: "PersonalChatAgent", class_name: "PersonalChatAgent" }]
    },
    migrations: [
      {
        tag: `${input.deploymentId}-agents-sdk-v1`,
        new_sqlite_classes: ["PersonalChatAgent"]
      }
    ],
    r2_buckets: [
      {
        binding: "AGENT_STORAGE",
        bucket_name: input.bindings.bucketName
      }
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: input.bindings.databaseName,
        database_id: input.bindings.databaseId ?? "replace-with-d1-id"
      }
    ],
    vectorize: [
      {
        binding: "VECTORIZE",
        index_name: input.bindings.vectorizeName
      }
    ],
    queues: {
      producers: [
        {
          binding: "TASK_QUEUE",
          queue: input.bindings.queueName
        }
      ]
    },
    vars: {
      OPEN_THINK_DEPLOYMENT_ID: input.deploymentId,
      OPEN_THINK_STARTER: input.request.starterTemplate,
      OPEN_THINK_AGENT_NAME: input.request.agentName?.trim() || "Personal Agent",
      OPEN_THINK_DEFAULT_MODEL: input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6",
      OPEN_THINK_CF_ACCOUNT_ID: input.request.cloudflareAccountId?.trim() ?? ""
    }
  };
}

function renderServerTs(input: {
  request: DeploymentRequest;
  deploymentId: string;
}): string {
  const agentName = JSON.stringify(input.request.agentName?.trim() || "Personal Agent");
  const deploymentId = JSON.stringify(input.deploymentId);
  const defaultModel = JSON.stringify(input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6");
  const cloudflareAccountId = JSON.stringify(input.request.cloudflareAccountId?.trim() ?? "");

  return `import { AIChatAgent } from "@cloudflare/ai-chat";
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

const generatedAgentName = ${agentName};
const generatedDeploymentId = ${deploymentId};
const generatedDefaultModel = ${defaultModel};
const generatedCloudflareAccountId = ${cloudflareAccountId};
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
        defaultModel: this.runtimeEnv.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel,
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
      model: workersai(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel),
      system: [
        "You are " + (env.OPEN_THINK_AGENT_NAME ?? generatedAgentName) + ", an open-think personal agent running on Cloudflare Agents SDK.",
        "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
        "Use connected MCP tools when they are relevant. For destructive or expensive Cloudflare actions, explain the exact operation and ask for confirmation first.",
        "Deployment id: " + (env.OPEN_THINK_DEPLOYMENT_ID ?? generatedDeploymentId),
        "Cloudflare account id: " + (env.OPEN_THINK_CF_ACCOUNT_ID ?? generatedCloudflareAccountId || "not configured")
      ].join("\\n"),
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
            Authorization: \`Bearer \${this.runtimeEnv.OPEN_THINK_CF_API_TOKEN}\`
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
`;
}
