import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import { routeAgentRequest, type AgentContext } from "agents";
import {
  convertToModelMessages,
  generateText,
  isToolUIPart,
  stepCountIs,
  streamText,
  tool,
  type StreamTextOnFinishCallback,
  type ToolSet,
  type UIMessage
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<unknown>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

type RuntimeEnv = Record<string, unknown> & {
  AI: unknown;
  ASSETS?: AssetBinding;
  DB?: D1DatabaseLike;
  OPEN_THINK_AGENT_NAME?: string;
  OPEN_THINK_CF_ACCOUNT_ID?: string;
  OPEN_THINK_CF_API_TOKEN?: string;
  OPEN_THINK_DEFAULT_MODEL?: string;
  OPEN_THINK_DEPLOYMENT_ID?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
  OPEN_THINK_EXECUTOR_MCP_URL?: string;
  OPEN_THINK_EXECUTOR_AUTH_TOKEN?: string;
  OPEN_THINK_EXECUTOR_MCP_AUTO?: string;
  OPEN_THINK_SANDBOX_STATUS?: string;
  OPEN_THINK_CONTAINER_STATUS?: string;
  Sandbox?: unknown;
};

type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all";

const defaultModel = "@cf/moonshotai/kimi-k2.6";
const workersAiFallbackModel = "@cf/moonshotai/kimi-k2.6";
const defaultToolApprovalPolicy: ToolApprovalPolicy = "auto";
const docsMcpServerUrl = "https://docs.mcp.cloudflare.com/mcp";
const cloudflareMcpServerUrl = "https://mcp.cloudflare.com/mcp";
const cloudAgentInstance = {
  schemaVersion: "2026-05-10",
  id: "local",
  label: "Personal Agent",
  kind: "cloud-agent-instance",
  chat: {
    primaryRuntime: "cloudflare-agents-sdk",
    transport: "websocket",
    persistence: "sqlite"
  },
  brain: {
    id: "openthink-gbrain-gstack",
    label: "OpenThink gbrain + gstack",
    stack: "gstack",
    enabledFeatures: ["coreMemory", "profileMemory", "episodicMemory", "semanticMemory", "mcpBridge", "taskQueue", "fileWorkspace", "proactiveRoutines"]
  },
  prompts: {
    systemPromptConfigurable: true,
    soulPromptConfigured: false,
    launchBriefConfigured: false
  },
  skills: [
    {
      id: "gskills",
      label: "Goal, planning, memory, files, tasks, and Cloudflare operations",
      source: "built-in",
      enabled: true
    },
    {
      id: "cloudflare-mcp",
      label: "Cloudflare API and docs MCP",
      source: "cloudflare",
      enabled: true
    },
    {
      id: "executor-mcp",
      label: "Executor MCP execution plane",
      source: "executor",
      enabled: true
    }
  ],
  execution: {
    agentsSdk: { role: "chat-streaming-state-and-tool-orchestration", enabled: true },
    executor: {
      role: "external-execution-plane",
      enabled: true,
      default: true,
      configured: false,
      mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
      authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
      defaultTarget: "first-party Cloudflare Sandbox bridge or self-hosted Executor MCP endpoint",
      recommendedFor: ["code execution", "filesystem work", "browser automation", "OpenAPI tool execution", "subprocesses", "long-running workflow workers"]
    },
    sandbox: {
      role: "cloudflare-sandbox-execution",
      enabled: true,
      default: true,
      configured: false
    },
    containers: {
      role: "custom-runtime-and-long-running-services",
      enabled: true,
      default: true,
      configured: false
    }
  },
  goal: {
    command: "/goal",
    firstClass: true,
    persistence: "D1 memory when DB is bound, otherwise chat state",
    executorAware: true
  },
  subAgents: {
    firstClass: true,
    persistence: "D1 sub_agents and sub_agent_messages when DB is bound",
    modes: ["agents-sdk", "executor", "hybrid"],
    controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"]
  },
  sdk: {
    packageName: "@open-think/core",
    version: "0.3.0",
    clientFactory: "createHostedCloudAgentClient",
    profileEndpoint: "/cloud-agent/profile",
    endpoints: {
      health: "/health",
      manifest: "/manifest",
      goal: "/goal",
      subAgents: "/subagents",
      runtimeContext: "/runtime/context",
      personalAgentSetup: "/personal-agent/setup"
    }
  },
  customization: {
    deployTime: ["agentName", "defaultModel", "thinkingLevel", "personalAgent preset", "enabled gbrain/gstack features", "tool approval policy"],
    runtimeEnv: ["OPEN_THINK_DEFAULT_MODEL", "OPEN_THINK_TOOL_APPROVAL_POLICY", "OPEN_THINK_EXECUTOR_MCP_URL", "OPEN_THINK_EXECUTOR_AUTH_TOKEN", "Cloudflare resource bindings"],
    personalAgent: ["system prompt", "soul prompt", "launch brief", "brain preset", "memory/task/file/MCP feature mix"],
    subAgent: ["name", "purpose", "mode", "brain", "skills", "system prompt", "model"]
  }
} as const;

type SubAgentStatus = "ready" | "working" | "paused" | "archived";
type SubAgentMode = "agents-sdk" | "executor" | "hybrid";

type SubAgent = {
  id: string;
  name: string;
  purpose: string;
  status: SubAgentStatus;
  mode: SubAgentMode;
  model: string;
  brain: string;
  systemPrompt: string;
  skills: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
};

type SubAgentMessage = {
  id: string;
  subAgentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

async function prepareModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(sanitizeMessagesForModel(messages), { ignoreIncompleteToolCalls: true });
}

function sanitizeMessagesForModel(messages: UIMessage[]): UIMessage[] {
  const activeApprovalIndex = activeApprovalContinuationIndex(messages);

  return messages
    .map((message, messageIndex) => {
      const shouldKeepToolParts = messageIndex === activeApprovalIndex;
      if (shouldKeepToolParts || !message.parts.some(isToolUIPart)) return message;

      return {
        ...message,
        parts: message.parts.filter((part) => !isToolUIPart(part))
      } as UIMessage;
    })
    .filter((message) => message.role === "user" || message.parts.length > 0);
}

function activeApprovalContinuationIndex(messages: UIMessage[]) {
  const lastMessageIndex = messages.length - 1;
  const lastMessage = messages[lastMessageIndex];
  if (!lastMessage || lastMessage.role !== "assistant") return -1;

  const toolParts = lastMessage.parts.filter(isToolUIPart);
  const hasApprovalResponse = toolParts.some((part) => {
    const state = uiToolState(part);
    return state === "approval-responded" || state === "approved";
  });
  if (!hasApprovalResponse) return -1;

  const allApprovalsSettled = toolParts.every((part) => {
    const state = uiToolState(part);
    return state === "approval-responded" || state === "approved" || state === "output-available" || state === "output-error";
  });

  return allApprovalsSettled ? lastMessageIndex : -1;
}

function uiToolState(part: UIMessage["parts"][number]) {
  return typeof (part as { state?: unknown }).state === "string"
    ? String((part as { state: string }).state)
    : "";
}

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
        cloudAgentInstance: cloudAgentInstanceState(this.runtimeEnv),
        toolApprovalPolicy: this.toolApprovalPolicy(),
        slashCommands: {
          goal: goalCommandPayload("", this.runtimeEnv)
        },
        subAgents: subAgentCapabilityState(this.runtimeEnv),
        mcpServers: this.getMcpServers()
      });
    }

    if (url.pathname.endsWith("/goal")) {
      return handleGoalRequest(request, this.runtimeEnv);
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
      cloudAgentInstance: cloudAgentInstanceState(this.runtimeEnv),
      slashCommands: {
        goal: goalCommandPayload("", this.runtimeEnv)
      },
      subAgents: subAgentCapabilityState(this.runtimeEnv),
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
        cloudAgentInstanceInstruction(env),
        goalCommandInstruction(),
        "You can create, brief, pause, resume, archive, summarize, and message Cloud Agent Instance sub-agents through built-in sub-agent tools when the owner asks for delegated work.",
        `Use connected MCP tools when they are relevant. Current MCP tool approval policy: ${this.toolApprovalPolicy()}.`,
        `Deployment id: ${env.OPEN_THINK_DEPLOYMENT_ID ?? "local"}`,
        `Cloudflare account id: ${env.OPEN_THINK_CF_ACCOUNT_ID ?? "not configured"}`
      ].join("\n"),
      messages: await prepareModelMessages(this.messages),
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

    const executorUrl = sanitizeHttpsUrl(this.runtimeEnv.OPEN_THINK_EXECUTOR_MCP_URL);
    if (executorUrl) {
      const executorHeaders = this.runtimeEnv.OPEN_THINK_EXECUTOR_AUTH_TOKEN
        ? { Authorization: `Bearer ${this.runtimeEnv.OPEN_THINK_EXECUTOR_AUTH_TOKEN}` }
        : undefined;
      await this.addMcpServer(
        "executor",
        executorUrl,
        executorHeaders ? { transport: { headers: executorHeaders } } : undefined
      ).catch(() => undefined);
    }
  }

  private builtinTools(): ToolSet {
    return {
      getUserTimezone: tool({
        description: "Get the owner's browser timezone, locale, and local time from the connected client.",
        inputSchema: z.object({})
      }),
      setActiveGoal: tool({
        description: "Persist the owner's active /goal brief into D1 memory when the DB binding is available.",
        inputSchema: z.object({
          goal: z.string().min(1).describe("The active goal objective."),
          successCriteria: z.array(z.string()).default([]).describe("How the owner and agent will know the goal is complete."),
          milestones: z.array(z.string()).default([]).describe("Major checkpoints for the goal."),
          nextActions: z.array(z.string()).default([]).describe("Concrete next actions to take."),
          notes: z.string().optional().describe("Optional constraints, risks, or context.")
        }),
        execute: async (input) => this.setActiveGoal(input)
      }),
      createSubAgent: tool({
        description: "Create a D1-tracked Cloud Agent Instance sub-agent for delegated work.",
        inputSchema: z.object({
          name: z.string().min(1).describe("Short sub-agent name."),
          purpose: z.string().min(1).describe("The delegated mission or responsibility."),
          systemPrompt: z.string().optional().describe("Optional custom operating instructions."),
          brain: z.string().optional().describe("Brain or skill preset, for example gbrain + gskills."),
          skills: z.array(z.string()).default([]).describe("Enabled skills or capabilities."),
          mode: z.enum(["agents-sdk", "executor", "hybrid"]).default("hybrid").describe("Preferred execution mode."),
          model: z.string().optional().describe("Optional model override.")
        }),
        execute: async (input) => createSubAgent(this.runtimeEnv, input)
      }),
      updateSubAgentStatus: tool({
        description: "Pause, resume, mark working, or archive a tracked sub-agent.",
        inputSchema: z.object({
          id: z.string().min(1),
          status: z.enum(["ready", "working", "paused", "archived"])
        }),
        execute: async ({ id, status }) => updateSubAgentStatus(this.runtimeEnv, id, status)
      }),
      summarizeSubAgent: tool({
        description: "Refresh and return a concise summary for a tracked sub-agent.",
        inputSchema: z.object({
          id: z.string().min(1)
        }),
        execute: async ({ id }) => refreshSubAgentSummary(this.runtimeEnv, id)
      }),
      sendSubAgentMessage: tool({
        description: "Send a message to a tracked sub-agent and receive its response.",
        inputSchema: z.object({
          id: z.string().min(1),
          message: z.string().min(1)
        }),
        execute: async ({ id, message }) => sendSubAgentMessage(this.runtimeEnv, id, message)
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

  private async setActiveGoal(input: {
    goal: string;
    successCriteria: string[];
    milestones: string[];
    nextActions: string[];
    notes?: string | undefined;
  }): Promise<Record<string, unknown>> {
    const db = this.runtimeEnv.DB;
    const text = formatActiveGoalMemory(input);
    if (!db) {
      return {
        stored: false,
        goal: input.goal,
        memory: text,
        error: "D1 DB binding is not configured; goal remains in conversation state."
      };
    }

    await db.prepare(
      "create table if not exists memories (id text primary key, text text not null, created_at text not null)"
    ).run();
    const storedAt = new Date().toISOString();
    await db.prepare("insert into memories (id, text, created_at) values (?, ?, ?)")
      .bind(crypto.randomUUID(), text, storedAt)
      .run();
    return {
      stored: true,
      table: "memories",
      goal: input.goal,
      memory: text,
      storedAt
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
    if (url.pathname === "/health") {
      return Response.json(hostedAgentHealth(env as RuntimeEnv));
    }

    if (url.pathname === "/manifest") {
      return Response.json(hostedAgentManifest(env as RuntimeEnv));
    }

    if (url.pathname === "/cloud-agent/profile") {
      return Response.json(cloudAgentInstanceState(env as RuntimeEnv));
    }

    if (url.pathname === "/personal-agent/setup") {
      return Response.json({
        status: "ready",
        cloudAgentInstance: cloudAgentInstanceState(env as RuntimeEnv),
        customization: cloudAgentInstanceState(env as RuntimeEnv).customization
      });
    }

    if (url.pathname === "/runtime/context") {
      return Response.json({
        runtime: "cloudflare-agents-sdk",
        cloudAgentInstance: cloudAgentInstanceState(env as RuntimeEnv),
        sdk: cloudAgentInstanceState(env as RuntimeEnv).sdk,
        subAgents: subAgentCapabilityState(env as RuntimeEnv)
      });
    }

    if (url.pathname === "/goal") {
      return handleGoalRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/subagents" && request.method === "GET") {
      return handleSubAgentsList(env as RuntimeEnv);
    }

    if (url.pathname === "/subagents" && request.method === "POST") {
      return handleSubAgentCreate(request, env as RuntimeEnv);
    }

    const subAgentRoute = parseSubAgentRoute(url.pathname);
    if (subAgentRoute) {
      return handleSubAgentRoute(request, env as RuntimeEnv, subAgentRoute);
    }

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
      return Response.json(hostedAgentManifest(env as RuntimeEnv));
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }
};

function hostedAgentHealth(env: RuntimeEnv) {
  return {
    ok: true,
    runtime: "cloudflare-agents-sdk",
    agent: "PersonalChatAgent",
    defaultModel: env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel,
    cloudAgentInstance: cloudAgentInstanceState(env),
    sdk: cloudAgentInstanceState(env).sdk,
    slashCommands: {
      goal: goalCommandPayload("", env)
    },
    subAgents: subAgentCapabilityState(env),
    mcp: {
      toolApprovalPolicy: normalizeToolApprovalPolicy(env.OPEN_THINK_TOOL_APPROVAL_POLICY)
    }
  };
}

function hostedAgentManifest(env: RuntimeEnv) {
  return {
    ...hostedAgentHealth(env),
    status: "ready",
    websocket: "/agents/personal-chat-agent/default",
    chatProtocol: "AIChatAgent/useAgentChat",
    chat: {
      transport: "websocket",
      streaming: "resumable-ui-message-stream",
      persistence: "AIChatAgent SQLite",
      clientHooks: ["useAgent", "useAgentChat"]
    },
    endpoints: [
      "/health",
      "/manifest",
      "/cloud-agent/profile",
      "/goal",
      "/subagents",
      "/subagents/{id}",
      "/subagents/{id}/messages",
      "/subagents/{id}/control",
      "/subagents/{id}/summary",
      "/personal-agent/setup",
      "/runtime/context"
    ]
  };
}

async function handleSubAgentsList(env: RuntimeEnv): Promise<Response> {
  if (!env.DB) {
    return Response.json({
      available: false,
      subAgents: [],
      error: "D1 DB binding is not configured."
    });
  }
  return Response.json({
    available: true,
    subAgents: await listSubAgents(env)
  });
}

async function handleSubAgentCreate(request: Request, env: RuntimeEnv): Promise<Response> {
  const result = await createSubAgent(env, await request.json().catch(() => ({})));
  return Response.json(result, { status: result.ok === false ? 400 : 201 });
}

function parseSubAgentRoute(pathname: string): { id: string; action: string } | null {
  const match = pathname.match(/^\/subagents\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  return {
    id: decodeURIComponent(match[1] ?? ""),
    action: match[2] ?? "detail"
  };
}

async function handleSubAgentRoute(
  request: Request,
  env: RuntimeEnv,
  route: { id: string; action: string }
): Promise<Response> {
  if (route.action === "detail" && request.method === "GET") {
    const subAgent = await getSubAgent(env, route.id);
    if (!subAgent) return Response.json({ error: "Sub-agent not found." }, { status: 404 });
    return Response.json({ subAgent });
  }

  if (route.action === "messages" && request.method === "GET") {
    const subAgent = await getSubAgent(env, route.id);
    if (!subAgent) return Response.json({ error: "Sub-agent not found." }, { status: 404 });
    return Response.json({ subAgent, messages: await listSubAgentMessages(env, route.id) });
  }

  if (route.action === "messages" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const result = await sendSubAgentMessage(env, route.id, String(payload.message ?? payload.text ?? ""));
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "control" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const status = normalizeSubAgentStatus(payload.status ?? payload.action, "ready");
    const result = await updateSubAgentStatus(env, route.id, status);
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "summary" && request.method === "POST") {
    const result = await refreshSubAgentSummary(env, route.id);
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  return Response.json({ error: "Unsupported sub-agent route." }, { status: 404 });
}

async function ensureSubAgentTables(env: RuntimeEnv): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB.prepare(
    "create table if not exists sub_agents (id text primary key, name text not null, purpose text not null, status text not null, mode text not null, model text not null, brain text not null, system_prompt text not null, skills_json text not null, summary text not null, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists sub_agent_messages (id text primary key, sub_agent_id text not null, role text not null, content text not null, created_at text not null)"
  ).run();
  return true;
}

async function createSubAgent(env: RuntimeEnv, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!(await ensureSubAgentTables(env))) {
    return { ok: false, error: "D1 DB binding is not configured." };
  }

  const now = new Date().toISOString();
  const id = "subagent-" + crypto.randomUUID();
  const name = normalizeShortText(input.name, "Research Agent");
  const purpose = normalizeLongText(input.purpose, "Help the main personal agent investigate and advance a delegated objective.");
  const brain = normalizeShortText(input.brain, "gbrain + gskills");
  const mode = normalizeSubAgentMode(input.mode);
  const skills = normalizeStringArray(input.skills);
  const model = normalizeShortText(input.model, String(env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel));
  const systemPrompt = normalizeLongText(
    input.systemPrompt,
    defaultSubAgentSystemPrompt(name, purpose, brain, skills, mode)
  );
  const summary = "Ready. " + purpose;

  await env.DB!.prepare(
    "insert into sub_agents (id, name, purpose, status, mode, model, brain, system_prompt, skills_json, summary, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, name, purpose, "ready", mode, model, brain, systemPrompt, JSON.stringify(skills), summary, now, now)
    .run();

  const subAgent = await getSubAgent(env, id);
  return { ok: true, subAgent };
}

async function listSubAgents(env: RuntimeEnv): Promise<SubAgent[]> {
  if (!(await ensureSubAgentTables(env))) return [];
  const rows = await env.DB!.prepare(
    "select a.*, (select count(*) from sub_agent_messages m where m.sub_agent_id = a.id) as message_count from sub_agents a order by datetime(a.updated_at) desc limit 100"
  ).all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToSubAgent);
}

async function getSubAgent(env: RuntimeEnv, id: string): Promise<SubAgent | null> {
  if (!(await ensureSubAgentTables(env))) return null;
  const row = await env.DB!.prepare(
    "select a.*, (select count(*) from sub_agent_messages m where m.sub_agent_id = a.id) as message_count from sub_agents a where a.id = ? limit 1"
  ).bind(id).first<Record<string, unknown>>();
  return row ? rowToSubAgent(row) : null;
}

async function listSubAgentMessages(env: RuntimeEnv, id: string): Promise<SubAgentMessage[]> {
  if (!(await ensureSubAgentTables(env))) return [];
  const rows = await env.DB!.prepare(
    "select id, sub_agent_id, role, content, created_at from sub_agent_messages where sub_agent_id = ? order by datetime(created_at) asc limit 80"
  ).bind(id).all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToSubAgentMessage);
}

async function updateSubAgentStatus(
  env: RuntimeEnv,
  id: string,
  status: SubAgentStatus
): Promise<Record<string, unknown>> {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  const now = new Date().toISOString();
  await env.DB!.prepare("update sub_agents set status = ?, updated_at = ? where id = ?")
    .bind(status, now, id)
    .run();
  return { ok: true, subAgent: await getSubAgent(env, id) };
}

async function sendSubAgentMessage(
  env: RuntimeEnv,
  id: string,
  rawMessage: string
): Promise<Record<string, unknown>> {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  if (subAgent.status === "archived") return { ok: false, error: "Archived sub-agents cannot receive new messages." };
  if (subAgent.status === "paused") return { ok: false, error: "Paused sub-agents must be resumed before receiving messages." };

  const message = rawMessage.trim();
  if (!message) return { ok: false, error: "Message is required." };

  await setSubAgentStatusOnly(env, id, "working");
  const now = new Date().toISOString();
  await env.DB!.prepare(
    "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), id, "user", message, now).run();

  const history = await listSubAgentMessages(env, id);
  const reply = await runSubAgentModel(env, subAgent, history);
  const repliedAt = new Date().toISOString();
  await env.DB!.prepare(
    "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
  ).bind(crypto.randomUUID(), id, "assistant", reply, repliedAt).run();
  await env.DB!.prepare(
    "update sub_agents set status = ?, summary = ?, updated_at = ? where id = ?"
  ).bind("ready", deriveSubAgentSummary(subAgent, message, reply), repliedAt, id).run();

  return {
    ok: true,
    subAgent: await getSubAgent(env, id),
    message: reply,
    messages: await listSubAgentMessages(env, id)
  };
}

async function refreshSubAgentSummary(env: RuntimeEnv, id: string): Promise<Record<string, unknown>> {
  const subAgent = await getSubAgent(env, id);
  if (!subAgent) return { ok: false, error: "Sub-agent not found." };
  const messages = await listSubAgentMessages(env, id);
  const summary = await summarizeSubAgentMessages(env, subAgent, messages);
  const now = new Date().toISOString();
  await env.DB!.prepare("update sub_agents set summary = ?, updated_at = ? where id = ?")
    .bind(summary, now, id)
    .run();
  return { ok: true, summary, subAgent: await getSubAgent(env, id) };
}

async function setSubAgentStatusOnly(env: RuntimeEnv, id: string, status: SubAgentStatus): Promise<void> {
  await env.DB!.prepare("update sub_agents set status = ?, updated_at = ? where id = ?")
    .bind(status, new Date().toISOString(), id)
    .run();
}

async function runSubAgentModel(
  env: RuntimeEnv,
  subAgent: SubAgent,
  history: SubAgentMessage[]
): Promise<string> {
  if (!env.AI) {
    return "I am configured as " + subAgent.name + ", but the Workers AI binding is not available for sub-agent responses.";
  }

  const workersai = createWorkersAI({ binding: env.AI as never });
  const transcript = history
    .slice(-12)
    .map((message) => message.role.toUpperCase() + ": " + message.content)
    .join("\n\n");
  const result = await generateText({
    model: workersai(resolveSubAgentWorkersAiModel(env, subAgent.model)),
    system: subAgentSystemInstruction(subAgent, env),
    prompt: [
      "Conversation so far:",
      transcript || "No prior messages.",
      "",
      "Respond as the sub-agent. Be concise, concrete, and include next action if useful."
    ].join("\n")
  });
  return result.text.trim() || "No response generated.";
}

async function summarizeSubAgentMessages(
  env: RuntimeEnv,
  subAgent: SubAgent,
  messages: SubAgentMessage[]
): Promise<string> {
  if (!env.AI || messages.length === 0) return deriveSubAgentSummary(subAgent);
  const workersai = createWorkersAI({ binding: env.AI as never });
  const transcript = messages
    .slice(-20)
    .map((message) => message.role.toUpperCase() + ": " + message.content)
    .join("\n\n");
  const result = await generateText({
    model: workersai(resolveSubAgentWorkersAiModel(env, subAgent.model)),
    system: "Summarize this sub-agent state for an operator dashboard in two compact sentences.",
    prompt: transcript
  });
  return result.text.trim() || deriveSubAgentSummary(subAgent);
}

function resolveSubAgentWorkersAiModel(env: RuntimeEnv, requestedModel?: string): string {
  const requested = String(requestedModel ?? "").trim();
  if (requested.startsWith("@cf/")) return requested;

  const configured = String(env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel).trim();
  if (configured.startsWith("@cf/")) return configured;

  return defaultModel.startsWith("@cf/") ? defaultModel : workersAiFallbackModel;
}

function subAgentSystemInstruction(subAgent: SubAgent, env: RuntimeEnv): string {
  return [
    subAgent.systemPrompt,
    "You are a child Cloud Agent Instance coordinated by the main OpenThink personal agent.",
    "Brain: " + subAgent.brain + ". Mode: " + subAgent.mode + ". Skills: " + (subAgent.skills.join(", ") || "none") + ".",
    "Use Agents SDK semantics for chat/state. Use executor-oriented reasoning only when the main runtime exposes OPEN_THINK_EXECUTOR_MCP_URL.",
    sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)
      ? "Executor MCP is configured for execution-heavy work."
      : "Executor MCP is not configured; plan execution but do not claim external executor access."
  ].join("\n");
}

function defaultSubAgentSystemPrompt(
  name: string,
  purpose: string,
  brain: string,
  skills: string[],
  mode: SubAgentMode
): string {
  return [
    "You are " + name + ", a scoped Cloud Agent Instance sub-agent.",
    "Purpose: " + purpose,
    "Use the " + brain + " brain profile with " + (skills.join(", ") || "general reasoning") + ".",
    "Mode: " + mode + ". Keep work bounded, report blockers, and hand concise summaries back to the main personal agent."
  ].join("\n");
}

function deriveSubAgentSummary(subAgent: SubAgent, lastUser?: string, lastReply?: string): string {
  if (lastUser && lastReply) {
    return "Last task: " + compactText(lastUser, 90) + " Response: " + compactText(lastReply, 140);
  }
  return subAgent.summary || "Ready. " + subAgent.purpose;
}

function rowToSubAgent(row: Record<string, unknown>): SubAgent {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Sub-agent"),
    purpose: String(row.purpose ?? ""),
    status: normalizeSubAgentStatus(row.status, "ready"),
    mode: normalizeSubAgentMode(row.mode),
    model: String(row.model ?? defaultModel),
    brain: String(row.brain ?? "gbrain + gskills"),
    systemPrompt: String(row.system_prompt ?? ""),
    skills: parseJsonArray(row.skills_json),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    messageCount: Number(row.message_count ?? 0)
  };
}

function rowToSubAgentMessage(row: Record<string, unknown>): SubAgentMessage {
  const role = String(row.role ?? "assistant");
  return {
    id: String(row.id ?? ""),
    subAgentId: String(row.sub_agent_id ?? ""),
    role: role === "user" || role === "system" ? role : "assistant",
    content: String(row.content ?? ""),
    createdAt: String(row.created_at ?? "")
  };
}

async function handleGoalRequest(request: Request, env?: RuntimeEnv): Promise<Response> {
  if (request.method === "GET") {
    return Response.json(goalCommandPayload("", env));
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await request.json().catch(() => ({}));
  const goal = String(
    (payload as { goal?: unknown; text?: unknown; message?: unknown }).goal ??
      (payload as { goal?: unknown; text?: unknown; message?: unknown }).text ??
      (payload as { goal?: unknown; text?: unknown; message?: unknown }).message ??
      ""
  ).trim();
  return Response.json(goalCommandPayload(goal, env));
}

function goalCommandPayload(goal = "", env?: RuntimeEnv) {
  const trimmedGoal = goal.trim();
  return {
    enabled: true,
    command: "/goal",
    endpoint: "/goal",
    cloudAgentInstance: env ? cloudAgentInstanceState(env) : cloudAgentInstance,
    usage: ["/goal Ship the deployment updater", "/goal"],
    behavior:
      "Turns a requested objective into an active goal brief with success criteria, milestones, next actions, risks, and a resume prompt.",
    prompt: goalCommandPrompt(trimmedGoal)
  };
}

function goalCommandPrompt(goal: string): string {
  if (!goal) {
    return [
      "Goal command received with no goal text.",
      "Review active goals from this conversation and any available memory.",
      "If no active goal is clear, ask the owner for the objective in one concise question."
    ].join("\n");
  }

  return [
    "Goal command received.",
    "",
    "Active goal: " + goal,
    "",
    "Create a concise goal brief with objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal. If those tools are unavailable, keep the goal in conversation state and say what would be persisted when available."
  ].join("\n");
}

function goalCommandInstruction(): string {
  return [
    "Slash command /goal is enabled.",
    "When the owner's message begins with /goal, treat the remaining text as an active goal setup or update.",
    "If the command includes a goal, respond with a compact goal brief: objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "If the command has no goal text, review active goals from conversation and memory when available, then ask for the missing objective only if needed.",
    "Call setActiveGoal after drafting or updating a goal so the brief is persisted when D1 is bound.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal; otherwise keep the goal anchored in the chat state."
  ].join("\n");
}

function cloudAgentInstanceState(env: RuntimeEnv): Record<string, unknown> {
  const executorUrl = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  const sandboxConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_SANDBOX_STATUS);
  const containersConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_CONTAINER_STATUS);
  return {
    ...cloudAgentInstance,
    skills: cloudAgentInstance.skills.map((skill) =>
      skill.id === "executor-mcp"
        ? {
            ...skill,
            enabled: true,
            configured: Boolean(executorUrl),
            status: executorUrl ? "configured" : "default-pending"
          }
        : skill
    ),
    execution: {
      ...cloudAgentInstance.execution,
      executor: {
        ...cloudAgentInstance.execution.executor,
        enabled: true,
        configured: Boolean(executorUrl),
        status: executorUrl ? "configured" : "default-pending",
        mcpServerUrl: executorUrl ? "configured" : null,
        authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN),
        pointsTo:
          "OPEN_THINK_EXECUTOR_MCP_URL. In the OpenThink default architecture this should be a same-account Sandbox/Containers MCP bridge; it may also point to a self-hosted Executor deployment."
      },
      sandbox: {
        ...cloudAgentInstance.execution.sandbox,
        enabled: true,
        configured: sandboxConfigured,
        status: sandboxConfigured ? "configured" : "default-pending"
      },
      containers: {
        ...cloudAgentInstance.execution.containers,
        enabled: true,
        configured: containersConfigured,
        status: containersConfigured ? "configured" : "default-pending"
      }
    }
  };
}

function cloudAgentInstanceInstruction(env: RuntimeEnv): string {
  return [
    "Cloud agent instance profile:",
    JSON.stringify(cloudAgentInstanceState(env), null, 2),
    "Use Cloudflare Agents SDK for chat streaming, resumable state, message persistence, MCP orchestration, and human approvals.",
    "Executor is the default execution-plane contract, but it is callable only when OPEN_THINK_EXECUTOR_MCP_URL is configured or an executor MCP server is connected.",
    "In the default OpenThink architecture, executor MCP points at a first-party Cloudflare Sandbox bridge backed by Containers. It can also point at a self-hosted RhysSullivan/executor MCP endpoint.",
    "Use executor when it is configured and the goal needs code execution, filesystem work, browser automation, subprocesses, OpenAPI execution, or long-running workflow workers.",
    "Treat sub-agents as scoped child Cloud Agent Instances with their own purpose, brain, prompt, skills, status, summary, and interaction thread.",
    "If the executor URL is missing, say the executor plane is enabled by default but not connected yet; do not claim live command/filesystem/browser access.",
    "Agents can be customized through the cloud agent profile: system prompt, soul prompt, launch brief, brain preset, enabled features, skills, and execution plane."
  ].join("\n");
}

function subAgentCapabilityState(env: RuntimeEnv) {
  return {
    enabled: true,
    persistence: env.DB ? "D1 sub_agents and sub_agent_messages" : "unavailable until DB binding is configured",
    endpoints: ["/subagents", "/subagents/{id}", "/subagents/{id}/messages", "/subagents/{id}/control", "/subagents/{id}/summary"],
    controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"],
    modes: ["agents-sdk", "executor", "hybrid"],
    templates: ["research-scout", "builder", "reviewer", "cloud-operator"]
  };
}

function runtimeFlagEnabled(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "enabled" || normalized === "configured" || normalized === "ready";
}

function formatActiveGoalMemory(input: {
  goal: string;
  successCriteria?: string[];
  milestones?: string[];
  nextActions?: string[];
  notes?: string | undefined;
}): string {
  const lines = [
    "Active goal: " + input.goal.trim(),
    listSection("Success criteria", input.successCriteria),
    listSection("Milestones", input.milestones),
    listSection("Next actions", input.nextActions),
    input.notes?.trim() ? "Notes: " + input.notes.trim() : ""
  ].filter(Boolean);
  return lines.join("\n");
}

function listSection(label: string, values?: string[]): string {
  const items = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (items.length === 0) return "";
  return label + ": " + items.join("; ");
}

function normalizeShortText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return compactText(text || fallback, 96);
}

function normalizeLongText(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return compactText(text || fallback, 2000);
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeShortText(item, "")).filter(Boolean).slice(0, 12);
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((item) => normalizeShortText(item, "")).filter(Boolean).slice(0, 12);
  }
  return [];
}

function normalizeSubAgentMode(value: unknown): SubAgentMode {
  const mode = String(value ?? "").trim().toLowerCase();
  if (mode === "agents-sdk" || mode === "executor" || mode === "hybrid") return mode;
  return "hybrid";
}

function normalizeSubAgentStatus(value: unknown, fallback: SubAgentStatus): SubAgentStatus {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "pause") return "paused";
  if (status === "resume") return "ready";
  if (status === "start") return "working";
  if (status === "archive") return "archived";
  if (status === "ready" || status === "working" || status === "paused" || status === "archived") return status;
  return fallback;
}

function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringArray(value);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    return normalizeStringArray(JSON.parse(value));
  } catch {
    return normalizeStringArray(value);
  }
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 3)).trimEnd() + "...";
}

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
  const normalizedName = name
    .replace(/^tool_[a-z0-9]+_/i, "")
    .replace(/[_-]+/g, " ")
    .toLowerCase();
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
