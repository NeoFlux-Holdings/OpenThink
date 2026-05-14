import { AIChatAgent } from "@cloudflare/ai-chat";
import type { OnChatMessageOptions } from "@cloudflare/ai-chat";
import { getSandbox, proxyToSandbox, Sandbox } from "@cloudflare/sandbox";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Agent, getAgentByName, routeAgentRequest, type AgentContext } from "agents";
import { McpAgent } from "agents/mcp";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  isTextUIPart,
  isToolUIPart,
  stepCountIs,
  streamText,
  tool,
  type StreamTextOnFinishCallback,
  type StreamTextTransform,
  type TextStreamPart,
  type ToolSet,
  type UIMessageChunk,
  type UIMessageStreamWriter,
  type UIMessage
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";

export { Sandbox };

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

interface R2ObjectLike {
  key: string;
  size?: number;
  uploaded?: Date | string;
}

interface R2BucketLike {
  list(options?: { prefix?: string; limit?: number }): Promise<{ objects?: R2ObjectLike[] }>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: Record<string, unknown>): Promise<unknown>;
}

interface QueueBindingLike {
  send(message: unknown): Promise<unknown>;
}

interface WorkersAiBindingLike {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface VectorizeIndexLike {
  upsert?(vectors: VectorizeVectorLike[]): Promise<unknown>;
  insert?(vectors: VectorizeVectorLike[]): Promise<unknown>;
  query?(vector: number[], options?: Record<string, unknown>): Promise<unknown>;
}

interface VectorizeVectorLike {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

type RuntimeEnv = Record<string, unknown> & {
  AI: unknown;
  ASSETS?: AssetBinding;
  DB?: D1DatabaseLike;
  AGENT_STORAGE?: R2BucketLike;
  TASK_QUEUE?: QueueBindingLike;
  OPEN_THINK_AGENT_NAME?: string;
  OPEN_THINK_CF_ACCOUNT_ID?: string;
  OPEN_THINK_CF_API_TOKEN?: string;
  OPEN_THINK_DEFAULT_MODEL?: string;
  OPEN_THINK_DEPLOYMENT_ID?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
  OPEN_THINK_EXECUTOR_MCP_URL?: string;
  OPEN_THINK_EXECUTOR_AUTH_TOKEN?: string;
  OPEN_THINK_EXECUTOR_MCP_AUTO?: string;
  OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE?: string;
  OPEN_THINK_GITHUB_TOKEN?: string;
  OPEN_THINK_UPDATE_REPOSITORY?: string;
  OPEN_THINK_UPDATE_BRANCH?: string;
  OPEN_THINK_SANDBOX_STATUS?: string;
  OPEN_THINK_CONTAINER_STATUS?: string;
  SANDBOX_TRANSPORT?: string;
  VECTORIZE?: unknown;
  Sandbox?: unknown;
  WORKSPACE_MCP?: unknown;
};

type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all" | "full-auto";

const defaultModel = "@cf/moonshotai/kimi-k2.6";
const workersAiFallbackModel = "@cf/moonshotai/kimi-k2.6";
const memoryEmbeddingModel = "@cf/baai/bge-base-en-v1.5";
const memoryEmbeddingDimensions = 768;
const defaultToolApprovalPolicy: ToolApprovalPolicy = "auto";
const defaultUpdateRepository = "NeoFlux-Holdings/OpenThink";
const docsMcpServerUrl = "https://docs.mcp.cloudflare.com/mcp";
const cloudflareMcpServerUrl = "https://mcp.cloudflare.com/mcp";
const cloudflareCodeModeMcpUrl = "https://mcp.cloudflare.com/mcp?codemode=search_and_execute";
const defaultSandboxId = "default";
const sandboxWorkspaceRoot = "/workspace";
const workspaceDefaultSkills = [
  "cloudflare-agents",
  "workers-best-practices",
  "mcp-code-mode",
  "workflows",
  "llms-full"
];
const cloudflareSkillSources = [
  "https://github.com/cloudflare/skills",
  "https://developers.cloudflare.com/llms-full.txt",
  "https://developers.cloudflare.com/agents/",
  "https://developers.cloudflare.com/workers/best-practices/workers-best-practices/"
];
const workspaceSkillSources = [
  {
    id: "cloudflare-skills",
    label: "Cloudflare Skills",
    url: "https://github.com/cloudflare/skills",
    category: "cloudflare",
    defaultEnabled: true
  },
  {
    id: "cloudflare-llms-full",
    label: "Cloudflare llms-full",
    url: "https://developers.cloudflare.com/llms-full.txt",
    category: "cloudflare",
    defaultEnabled: true
  },
  {
    id: "cloudflare-agents-docs",
    label: "Cloudflare Agents Docs",
    url: "https://developers.cloudflare.com/agents/",
    category: "cloudflare",
    defaultEnabled: true
  },
  {
    id: "cloudflare-workers-best-practices",
    label: "Workers Best Practices",
    url: "https://developers.cloudflare.com/workers/best-practices/workers-best-practices/",
    category: "cloudflare",
    defaultEnabled: true
  },
  {
    id: "aihero-skills",
    label: "AI Hero Skills",
    url: "https://www.aihero.dev/skills.md",
    category: "community",
    defaultEnabled: false
  },
  {
    id: "anthropic-skills",
    label: "Anthropic Skills",
    url: "https://github.com/anthropics/skills",
    category: "anthropic",
    defaultEnabled: false
  },
  {
    id: "openai-skills",
    label: "OpenAI Skills",
    url: "https://github.com/openai/skills",
    category: "openai",
    defaultEnabled: false
  }
] as const;
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
  codeMode: {
    enabled: true,
    default: true,
    cloudflareApiMcpUrl: cloudflareCodeModeMcpUrl,
    portalQuery: "codemode=search_and_execute",
    toolShape: "search-and-execute"
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
      role: "first-party-or-external-execution-plane",
      enabled: true,
      default: true,
      configured: false,
      mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
      authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
      defaultTarget: "same-Worker Cloudflare Sandbox/Containers RPC bridge, with optional self-hosted Executor MCP endpoint",
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
    persistence: "D1 sub_agents and sub_agent_messages plus native OpenThinkSubAgent facets when Agents SDK runtime is active",
    modes: ["agents-sdk", "executor", "hybrid"],
    controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"],
    nativeRuntime: "Cloudflare Agents subAgent() typed RPC through OpenThinkSubAgent when package runtime is active",
    mcpRpc: "OpenThinkWorkspaceMcp same-Worker MCP server is registered through addMcpServer(WORKSPACE_MCP)."
  },
  workspace: {
    firstClass: true,
    defaultWorkspace: "default",
    orchestrator: {
      enabled: true,
      autoSpunUp: true,
      className: "WorkspaceOrchestrator",
      coordination: "native-sub-agent-rpc"
    },
    contextStore: {
      primary: "D1 workspace_context",
      semantic: "Vectorize semantic recall when AI and VECTORIZE bindings are connected",
      vectorizeBinding: "VECTORIZE"
    },
    defaultSkills: workspaceDefaultSkills,
    cloudflareSkillSources,
    skillSources: workspaceSkillSources,
    approvalModes: ["auto", "ask-every-time", "allow-all", "full-auto"]
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
      skills: "/skills",
      memory: "/memory",
      artifacts: "/artifacts",
      files: "/files",
      tasks: "/tasks",
      browserSnapshot: "/browser/snapshot",
      browserDiagnostics: "/browser/diagnostics",
      browserSessions: "/browser/sessions",
      contributions: "/contributions",
      learning: "/learning",
      executor: "/executor",
      runtimeContext: "/runtime/context",
      personalAgentSetup: "/personal-agent/setup",
      workspace: "/workspace",
      mcp: {
        servers: "/mcp/servers",
        state: "/mcp/state",
        add: "/mcp/add",
        tools: "/mcp/tools",
        call: "/mcp/call",
        observability: "/mcp/observability"
      }
    }
  },
  customization: {
    deployTime: ["agentName", "defaultModel", "thinkingLevel", "personalAgent preset", "enabled gbrain/gstack features", "tool approval policy"],
    runtimeEnv: [
      "OPEN_THINK_DEFAULT_MODEL",
      "OPEN_THINK_TOOL_APPROVAL_POLICY",
      "OPEN_THINK_EXECUTOR_MCP_URL",
      "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
      "OPEN_THINK_SANDBOX_STATUS",
      "OPEN_THINK_CONTAINER_STATUS",
      "Cloudflare resource bindings"
    ],
    personalAgent: ["system prompt", "soul prompt", "launch brief", "brain preset", "memory/task/file/MCP feature mix"],
    subAgent: ["name", "purpose", "mode", "brain", "skills", "system prompt", "model"],
    workspace: [
      "workspace name",
    "orchestrator prompt",
    "approval policy",
    "gbrain/gstack feature mix",
    "Cloudflare/community/OpenAI/Anthropic skill catalog preload",
    "shared context retention"
  ]
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

type WorkspaceState = {
  id: string;
  name: string;
  purpose: string;
  approvalPolicy: ToolApprovalPolicy;
  orchestratorStatus: "ready" | "working" | "paused";
  contextSummary: string;
  skills: string[];
  updatedAt: string;
};

type WorkspaceContextItem = {
  id: string;
  workspaceId: string;
  kind: string;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

type WorkspaceCoordinationInput = {
  objective?: string | undefined;
  latestUserRequest?: string | undefined;
  subAgents?: SubAgent[] | undefined;
  workspace?: WorkspaceState | undefined;
  runtime?: Record<string, unknown> | undefined;
};

type WorkspaceCoordinationBrief = {
  workspaceId: string;
  summary: string;
  nextActions: string[];
  risks: string[];
  subAgentBriefs: string[];
  updatedAt: string;
};

type PersonalChatAgentStub = {
  getChatHistory(): Promise<UIMessage[]>;
  listManagedSubAgents(): Promise<Record<string, unknown>>;
  createManagedSubAgent(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  sendManagedSubAgentMessage(id: string, message: string): Promise<Record<string, unknown>>;
  summarizeManagedSubAgent(id: string): Promise<Record<string, unknown>>;
  controlManagedSubAgent(id: string, status: SubAgentStatus): Promise<Record<string, unknown>>;
  getMcpServers(): Record<string, unknown>;
  onRequest(request: Request): Promise<Response>;
};

async function prepareModelMessages(messages: UIMessage[]) {
  return convertToModelMessages(sanitizeMessagesForModel(messages), { ignoreIncompleteToolCalls: true });
}

function suppressToolInputStreamingTransform<TOOLS extends ToolSet>(): StreamTextTransform<TOOLS> {
  return () =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, controller) {
        if (part.type === "tool-input-start" || part.type === "tool-input-delta") return;
        controller.enqueue(part);
      }
    });
}

function sanitizeMessagesForModel(messages: UIMessage[]): UIMessage[] {
  const activeApprovalIndex = activeApprovalContinuationIndex(messages);

  const strippedMessages = messages
    .map((message, messageIndex) => {
      const shouldKeepToolParts = messageIndex === activeApprovalIndex;
      if (shouldKeepToolParts || !message.parts.some(isToolUIPart)) return stripEmptyTextParts(message);

      return {
        ...message,
        parts: message.parts.filter((part) => !isToolUIPart(part) && !isEmptyTextPart(part))
      } as UIMessage;
    })
    .filter((message) => message.role === "user" || message.parts.length > 0);

  return mergeAdjacentUserMessages(strippedMessages);
}

function stripEmptyTextParts(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.filter((part) => !isEmptyTextPart(part))
  } as UIMessage;
}

function isEmptyTextPart(part: UIMessage["parts"][number]) {
  return isTextUIPart(part) && part.text.trim().length === 0;
}

function mergeAdjacentUserMessages(messages: UIMessage[]): UIMessage[] {
  const merged: UIMessage[] = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous?.role === "user" && message.role === "user") {
      merged[merged.length - 1] = mergeUserMessages(previous, message);
      continue;
    }
    merged.push(message);
  }
  return merged;
}

function mergeUserMessages(left: UIMessage, right: UIMessage): UIMessage {
  const text = [textPartContent(left.parts), textPartContent(right.parts)].filter(Boolean).join("\n\n");
  const nonTextParts = [...left.parts, ...right.parts].filter((part) => !isTextUIPart(part));
  return {
    ...right,
    parts: [
      ...(text ? [{ type: "text", text } as UIMessage["parts"][number]] : []),
      ...nonTextParts
    ]
  } as UIMessage;
}

function textPartContent(parts: UIMessage["parts"]) {
  return parts
    .filter(isTextUIPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function safeChatHistory(messages: readonly UIMessage[]) {
  const seen = new Map<string, number>();
  return Array.from(messages)
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .map((message, index) => {
      const id = message.id || `${message.role}:${index}`;
      const count = seen.get(id) ?? 0;
      seen.set(id, count + 1);
      return {
        ...message,
        id: count === 0 ? id : `${id}:${count}`,
        parts: Array.isArray(message.parts) ? message.parts.filter((part) => !isEmptyTextPart(part)) : []
      } as UIMessage;
    })
    .filter((message) => message.parts.length > 0);
}

function isAgentMessagesReadPath(pathname: string) {
  return pathname.endsWith("/get-messages") || pathname.endsWith("/chat-history");
}

function isRenderableUiChunk(chunk: UIMessageChunk) {
  if (chunk.type === "text-delta") return chunk.delta.trim().length > 0;
  return (
    chunk.type === "tool-input-available" ||
    chunk.type === "tool-input-error" ||
    chunk.type === "tool-approval-request" ||
    chunk.type === "tool-output-available" ||
    chunk.type === "tool-output-error" ||
    chunk.type === "tool-output-denied"
  );
}

function writeTextFallback(writer: UIMessageStreamWriter<UIMessage>, text: string) {
  const id = "fallback-" + crypto.randomUUID();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

function activeApprovalContinuationIndex(messages: UIMessage[]) {
  let lastMessageIndex = -1;
  let lastMessage: UIMessage | undefined;
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) continue;
    if (message.role === "user") return -1;
    if (message.role === "assistant" && message.parts.length > 0) {
      lastMessageIndex = messageIndex;
      lastMessage = message;
      break;
    }
  }
  if (!lastMessage) return -1;

  const toolParts = lastMessage.parts.filter(isToolUIPart);
  if (toolParts.length === 0) return -1;

  const lastToolPartIndex = lastMessage.parts.reduce((lastIndex, part, partIndex) => {
    return isToolUIPart(part) ? partIndex : lastIndex;
  }, -1);
  const hasAssistantTextAfterLastTool = lastMessage.parts.slice(lastToolPartIndex + 1).some((part) => {
    return isTextUIPart(part) && part.text.trim().length > 0;
  });
  if (hasAssistantTextAfterLastTool) return -1;

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

export class WorkspaceOrchestrator extends Agent<RuntimeEnv> {
  async coordinate(input: WorkspaceCoordinationInput): Promise<WorkspaceCoordinationBrief> {
    const now = new Date().toISOString();
    const workspace = input.workspace ?? defaultWorkspaceState(input.runtime as RuntimeEnv | undefined);
    const activeSubAgents = (input.subAgents ?? []).filter((subAgent) => subAgent.status !== "archived");
    const workingSubAgents = activeSubAgents.filter((subAgent) => subAgent.status === "working");
    const objective = compactText(input.objective || input.latestUserRequest || workspace.purpose, 180);
    const subAgentBriefs = activeSubAgents.slice(0, 8).map((subAgent) => {
      return subAgent.name + " [" + subAgent.status + "]: " + compactText(subAgent.summary || subAgent.purpose, 140);
    });

    return {
      workspaceId: workspace.id,
      summary:
        "Workspace " +
        workspace.name +
        " is coordinating " +
        activeSubAgents.length +
        " active workstream" +
        (activeSubAgents.length === 1 ? "" : "s") +
        " for: " +
        objective,
      nextActions: [
        workingSubAgents.length > 0
          ? "Collect progress from " + workingSubAgents.length + " working sub-agent" + (workingSubAgents.length === 1 ? "" : "s") + "."
          : "Assign the next bounded task to a specialist sub-agent when delegation helps.",
        "Keep durable context in workspace_context and brief the main chat only with decision-ready summaries.",
        "Use Cloudflare Code Mode MCP for broad API inspection before mutating Cloudflare resources."
      ],
      risks: [
        workspace.approvalPolicy === "full-auto" || workspace.approvalPolicy === "allow-all"
          ? "Full-auto approval requires scoped Cloudflare tokens and spend/resource guardrails."
          : "Approval prompts can interrupt long-running plans; use full-auto only for trusted scoped goals.",
        "Vectorize semantic recall is advertised only when the binding and embedding pipeline are connected."
      ],
      subAgentBriefs,
      updatedAt: now
    };
  }
}

export class OpenThinkSubAgent extends Agent<RuntimeEnv> {
  private readonly runtimeEnv: RuntimeEnv;

  constructor(ctx: AgentContext, env: RuntimeEnv) {
    super(ctx, env);
    this.runtimeEnv = env;
  }

  async respond(input: { subAgent: SubAgent; history: SubAgentMessage[] }): Promise<Record<string, unknown>> {
    const reply = await runSubAgentModel(this.runtimeEnv, input.subAgent, input.history);
    const lastUser = [...input.history].reverse().find((message) => message.role === "user")?.content;
    const summary = deriveSubAgentSummary(input.subAgent, lastUser, reply);
    const report = {
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      summary,
      reportedAt: new Date().toISOString()
    };
    await this.reportToParent(report).catch(() => undefined);
    return {
      reply,
      summary,
      report,
      native: {
        className: "OpenThinkSubAgent",
        parentPath: this.parentPath,
        selfPath: this.selfPath
      }
    };
  }

  async summarize(input: { subAgent: SubAgent; messages: SubAgentMessage[] }): Promise<Record<string, unknown>> {
    const summary = await summarizeSubAgentMessages(this.runtimeEnv, input.subAgent, input.messages);
    const report = {
      subAgentId: input.subAgent.id,
      subAgentName: input.subAgent.name,
      summary,
      reportedAt: new Date().toISOString()
    };
    await this.reportToParent(report).catch(() => undefined);
    return { summary, report };
  }

  private async reportToParent(report: Record<string, unknown>): Promise<void> {
    const parent = await this.parentAgent(PersonalChatAgent).catch(() => null);
    if (!parent) return;
    await parent.recordSubAgentReport(report).catch(() => undefined);
  }
}

export class OpenThinkWorkspaceMcp extends McpAgent<RuntimeEnv> {
  server = new McpServer({ name: "openthink-workspace", version: "0.3.0" });
  private readonly runtimeEnv: RuntimeEnv;

  constructor(ctx: AgentContext, env: RuntimeEnv) {
    super(ctx, env);
    this.runtimeEnv = env;
  }

  async init(): Promise<void> {
    this.server.tool(
      "workspace_status",
      "Return the durable workspace, active goal context, sub-agent rollup, and executor readiness.",
      {
        objective: z.string().optional().describe("Optional objective to frame the status around.")
      },
      async ({ objective }) => observedMcpTool(this.runtimeEnv, "workspace-orchestrator", "workspace_status", "durable-object-rpc", async () => {
        const workspace = await workspaceState(this.runtimeEnv);
        const subAgents = await listSubAgents(this.runtimeEnv).catch(() => []);
        const activeSubAgents = subAgents.filter((subAgent) => subAgent.status !== "archived");
        const executor = executorCapabilityState(this.runtimeEnv);
        const summary = [
          "Workspace " + workspace.name + " is " + workspace.orchestratorStatus + ".",
          objective ? "Objective: " + compactText(objective, 240) : "Purpose: " + compactText(workspace.purpose, 240),
          "Active sub-agents: " + activeSubAgents.length + ".",
          "Executor: " + String(executor.status ?? "unknown") + " via " + String(executor.transport ?? "unknown") + "."
        ].join(" ");
        return {
          content: [{ type: "text", text: summary }]
        };
      })
    );

    this.server.tool(
      "coordinate_workspace",
      "Ask the workspace orchestrator to produce a decision-ready project brief.",
      {
        objective: z.string().optional().describe("Current goal or project objective."),
        latestUserRequest: z.string().optional().describe("Latest owner request to incorporate.")
      },
      async (input) => observedMcpTool(this.runtimeEnv, "workspace-orchestrator", "coordinate_workspace", "durable-object-rpc", async () => {
        const workspace = await workspaceState(this.runtimeEnv);
        const subAgents = await listSubAgents(this.runtimeEnv).catch(() => []);
        const orchestrator = await this.subAgent(WorkspaceOrchestrator, workspace.id);
        const brief = await orchestrator.coordinate({
          ...input,
          workspace,
          subAgents,
          runtime: cloudAgentInstanceState(this.runtimeEnv)
        });
        await recordWorkspaceContext(this.runtimeEnv, {
          workspaceId: workspace.id,
          kind: "mcp-orchestrator-brief",
          summary: brief.summary,
          metadata: {
            nextActions: brief.nextActions,
            risks: brief.risks,
            subAgentBriefs: brief.subAgentBriefs
          }
        });
        return {
          content: [
            {
              type: "text",
              text: [
                brief.summary,
                "Next actions: " + brief.nextActions.join(" | "),
                "Risks: " + brief.risks.join(" | ")
              ].join("\n")
            }
          ]
        };
      })
    );

    this.server.tool(
      "record_workspace_context",
      "Store a durable workspace note or bottom-up sub-agent report without adding it to the main chat transcript.",
      {
        summary: z.string().min(1).describe("Decision-ready summary to store."),
        kind: z.string().optional().describe("Context kind, for example note, sub-agent-report, risk, or decision.")
      },
      async ({ summary, kind }) => observedMcpTool(this.runtimeEnv, "workspace-orchestrator", "record_workspace_context", "durable-object-rpc", async () => {
        const workspace = await workspaceState(this.runtimeEnv);
        const record = await recordWorkspaceContext(this.runtimeEnv, {
          workspaceId: workspace.id,
          kind: compactText(kind || "mcp-note", 80),
          summary: compactText(summary, 4000),
          metadata: { source: "workspace-mcp" }
        });
        return {
          content: [{ type: "text", text: record ? "Stored workspace context." : "Workspace context was not stored because D1 is unavailable." }]
        };
      })
    );

    this.server.tool(
      "send_subagent_message",
      "Send a top-down message to a tracked sub-agent and return its bottom-up report.",
      {
        id: z.string().min(1).describe("Tracked sub-agent id."),
        message: z.string().min(1).describe("Message or task for the sub-agent.")
      },
      async ({ id, message }) => observedMcpTool(this.runtimeEnv, "workspace-orchestrator", "send_subagent_message", "durable-object-rpc", async () => {
        const result = await sendSubAgentMessage(this.runtimeEnv, id, message, async (subAgent, history) => {
          const child = await this.subAgent(OpenThinkSubAgent, id);
          return child.respond({ subAgent, history });
        });
        const response = typeof result.response === "string"
          ? result.response
          : JSON.stringify(result.response ?? result);
        return {
          content: [{ type: "text", text: compactText(response, 4000) }]
        };
      })
    );
  }
}

export class PersonalChatAgent extends AIChatAgent<RuntimeEnv> {
  maxPersistedMessages = 200;
  waitForMcpConnections = { timeout: 1_500 };
  private readonly agentEnv: RuntimeEnv;
  private runtimeWarmup: Promise<void> | undefined;

  constructor(ctx: AgentContext, env: RuntimeEnv) {
    super(ctx, env);
    this.agentEnv = env;
  }

  async onStart(): Promise<void> {
    void this.startRuntimeWarmup();
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
          goal: goalCommandPayload("", this.runtimeEnv),
          train: trainCommandPayload("")
        },
        subAgents: subAgentCapabilityState(this.runtimeEnv),
        workspace: await workspaceState(this.runtimeEnv),
        mcpServers: this.getMcpServers()
      });
    }

    if (url.pathname.endsWith("/chat-history")) {
      return Response.json({ messages: this.getChatHistory() });
    }

    if (url.pathname.endsWith("/workspace")) {
      return handleWorkspaceRequest(request, this.runtimeEnv, this);
    }

    if (url.pathname.endsWith("/goal")) {
      return handleGoalRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/skills")) {
      return handleSkillsRequest(this.runtimeEnv);
    }

    if (url.pathname.endsWith("/memory")) {
      return handleMemoryRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/artifacts")) {
      return handleArtifactsRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/files")) {
      return handleFilesRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/tasks")) {
      return handleTasksRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/browser/snapshot")) {
      if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      return Response.json(await captureBrowserSnapshotArtifact(
        this.runtimeEnv,
        await request.json().catch(() => ({}))
      ));
    }

    if (url.pathname.endsWith("/browser/diagnostics")) {
      return handleBrowserDiagnosticsRequest(request, this.runtimeEnv);
    }

    const browserSessionRoute = parseBrowserSessionRoute(url.pathname);
    if (browserSessionRoute) {
      return handleBrowserSessionsRequest(request, this.runtimeEnv, browserSessionRoute);
    }

    if (url.pathname.endsWith("/contributions")) {
      return handleContributionRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/learning")) {
      return handleLearningRequest(request, this.runtimeEnv);
    }

    if (url.pathname.endsWith("/executor")) {
      return Response.json(executorCapabilityState(this.runtimeEnv));
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

    if (url.pathname.endsWith("/mcp/observability")) {
      return Response.json(await mcpObservabilityState(this.runtimeEnv, {
        includeSeries: url.searchParams.get("series") === "1"
      }));
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
        goal: goalCommandPayload("", this.runtimeEnv),
        train: trainCommandPayload("")
      },
      subAgents: subAgentCapabilityState(this.runtimeEnv),
      workspace: await workspaceState(this.runtimeEnv),
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
    await this.waitForRuntimeWarmup(1_500);

    const env = this.runtimeEnv;
    const workersai = createWorkersAI({ binding: env.AI as never });
    const model = workersai(env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel);
    const system = [
      `You are ${env.OPEN_THINK_AGENT_NAME ?? "Personal Agent"}, an open-think personal agent running on Cloudflare Agents SDK.`,
      "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
      "If several user messages are queued without an assistant answer, treat them as one latest turn and answer the newest actionable request first.",
      "Do not continue stale deployment or tool work unless the newest user message explicitly asks you to continue it.",
      cloudAgentInstanceInstruction(env),
      goalCommandInstruction(),
      trainCommandInstruction(),
      "You can create, brief, pause, resume, archive, summarize, and message Cloud Agent Instance sub-agents through built-in sub-agent tools when the owner asks for delegated work.",
      `Use connected MCP tools when they are relevant. Current MCP tool approval policy: ${this.toolApprovalPolicy()}.`,
      `Deployment id: ${env.OPEN_THINK_DEPLOYMENT_ID ?? "local"}`,
      `Cloudflare account id: ${env.OPEN_THINK_CF_ACCOUNT_ID ?? "not configured"}`
    ].join("\n");
    const modelMessages = await prepareModelMessages(this.messages);
    const result = streamText({
      model,
      system,
      messages: modelMessages,
      tools: {
        ...this.mcpToolsWithApprovalPolicy(),
        ...this.builtinTools()
      },
      experimental_transform: suppressToolInputStreamingTransform(),
      stopWhen: stepCountIs(5),
      ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
      onFinish
    });

    const stream = createUIMessageStream<UIMessage>({
      execute: async ({ writer }) => {
        const delayedFinishChunks: UIMessageChunk[] = [];
        let sawRenderableChunk = false;
        let sawTextChunk = false;
        for await (const chunk of result.toUIMessageStream<UIMessage>({ sendReasoning: false })) {
          if (chunk.type === "finish") {
            delayedFinishChunks.push(chunk);
            continue;
          }
          if (isRenderableUiChunk(chunk)) sawRenderableChunk = true;
          if (chunk.type === "text-delta" && chunk.delta.trim()) sawTextChunk = true;
          writer.write(chunk);
        }

        if (!sawRenderableChunk && !options?.abortSignal?.aborted) {
          const fallback = await generateText({
            model,
            system,
            messages: modelMessages,
            maxOutputTokens: 256,
            temperature: 0.2,
            ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {})
          });
          writeTextFallback(
            writer,
            fallback.text.trim() || "I did not receive model output. Send the request again if needed."
          );
        } else if (sawRenderableChunk && !sawTextChunk && !options?.abortSignal?.aborted) {
          writeTextFallback(
            writer,
            "Tool work completed. I did not receive a final assistant summary, so review the tool summary above or send a follow-up to continue."
          );
        }

        for (const chunk of delayedFinishChunks) writer.write(chunk);
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  private async ensureDefaultMcpServers(): Promise<void> {
    if (this.runtimeEnv.WORKSPACE_MCP) {
      await this.addMcpServer("workspace-orchestrator", this.runtimeEnv.WORKSPACE_MCP as never, {
        props: {
          workspaceId: defaultWorkspaceId,
          parentAgent: "PersonalChatAgent"
        }
      }).catch(() => undefined);
    }

    await this.addMcpServer("cloudflare-docs", docsMcpServerUrl).catch(() => undefined);

    if (this.runtimeEnv.OPEN_THINK_CF_API_TOKEN) {
      await this.addMcpServer("cloudflare-api", cloudflareApiMcpUrl(this.runtimeEnv), {
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

  private async ensureWorkspaceOrchestrator(): Promise<void> {
    await ensureWorkspaceTables(this.runtimeEnv);
    await this.subAgent(WorkspaceOrchestrator, "default").catch(() => undefined);
  }

  private startRuntimeWarmup(): Promise<void> {
    if (!this.runtimeWarmup) {
      this.runtimeWarmup = this.initializeRuntime().catch(() => {
        this.runtimeWarmup = undefined;
      });
    }
    return this.runtimeWarmup;
  }

  private async waitForRuntimeWarmup(timeoutMs: number): Promise<void> {
    const warmup = this.startRuntimeWarmup();
    await Promise.race([
      warmup,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  private async initializeRuntime(): Promise<void> {
    await this.ensureDefaultMcpServers();
    await this.ensureWorkspaceOrchestrator();
  }

  async listManagedSubAgents(): Promise<Record<string, unknown>> {
    return { subAgents: await listSubAgents(this.runtimeEnv) };
  }

  async createManagedSubAgent(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result = await createSubAgent(this.runtimeEnv, input);
    const id = String((result.subAgent as { id?: unknown } | undefined)?.id ?? "");
    if (result.ok && id) {
      await this.subAgent(OpenThinkSubAgent, id).catch(() => undefined);
      await recordWorkspaceContext(this.runtimeEnv, {
        workspaceId: defaultWorkspaceId,
        kind: "sub-agent-created",
        summary: "Created native-backed sub-agent " + String((result.subAgent as { name?: unknown })?.name ?? id) + ".",
        metadata: { subAgentId: id, nativeClass: "OpenThinkSubAgent" }
      });
    }
    return {
      ...result,
      native: result.ok && id ? { className: "OpenThinkSubAgent", facetName: id } : null
    };
  }

  async sendManagedSubAgentMessage(id: string, message: string): Promise<Record<string, unknown>> {
    return sendSubAgentMessage(this.runtimeEnv, id, message, async (subAgent, history) => {
      const child = await this.subAgent(OpenThinkSubAgent, id);
      return child.respond({ subAgent, history });
    });
  }

  async summarizeManagedSubAgent(id: string): Promise<Record<string, unknown>> {
    const subAgent = await getSubAgent(this.runtimeEnv, id);
    if (!subAgent) return { ok: false, error: "Sub-agent not found." };
    const messages = await listSubAgentMessages(this.runtimeEnv, id);
    const child = await this.subAgent(OpenThinkSubAgent, id).catch(() => null);
    const nativeSummary = child ? await child.summarize({ subAgent, messages }).catch(() => null) : null;
    const summary = typeof nativeSummary?.summary === "string"
      ? nativeSummary.summary
      : await summarizeSubAgentMessages(this.runtimeEnv, subAgent, messages);
    const now = new Date().toISOString();
    await this.runtimeEnv.DB!.prepare("update sub_agents set summary = ?, updated_at = ? where id = ?")
      .bind(summary, now, id)
      .run();
    return { ok: true, summary, subAgent: await getSubAgent(this.runtimeEnv, id), native: nativeSummary };
  }

  async controlManagedSubAgent(id: string, status: SubAgentStatus): Promise<Record<string, unknown>> {
    return updateSubAgentStatus(this.runtimeEnv, id, status);
  }

  async recordSubAgentReport(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const summary = normalizeLongText(input.summary, "");
    if (!summary) return { ok: false, error: "summary is required." };
    await recordWorkspaceContext(this.runtimeEnv, {
      workspaceId: defaultWorkspaceId,
      kind: "sub-agent-report",
      summary,
      metadata: input
    });
    return { ok: true };
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
        execute: async (input) => this.createManagedSubAgent(input)
      }),
      updateSubAgentStatus: tool({
        description: "Pause, resume, mark working, or archive a tracked sub-agent.",
        inputSchema: z.object({
          id: z.string().min(1),
          status: z.enum(["ready", "working", "paused", "archived"])
        }),
        execute: async ({ id, status }) => this.controlManagedSubAgent(id, status)
      }),
      summarizeSubAgent: tool({
        description: "Refresh and return a concise summary for a tracked sub-agent.",
        inputSchema: z.object({
          id: z.string().min(1)
        }),
        execute: async ({ id }) => this.summarizeManagedSubAgent(id)
      }),
      sendSubAgentMessage: tool({
        description: "Send a message to a tracked sub-agent and receive its response.",
        inputSchema: z.object({
          id: z.string().min(1),
          message: z.string().min(1)
        }),
        execute: async ({ id, message }) => this.sendManagedSubAgentMessage(id, message)
      }),
      coordinateWorkspace: tool({
        description:
          "Ask the default workspace orchestrator to summarize project state, sub-agent progress, risks, and next actions without polluting chat context.",
        inputSchema: z.object({
          objective: z.string().optional().describe("Current goal, plan, or project objective."),
          latestUserRequest: z.string().optional().describe("Latest owner request to incorporate into the workspace brief.")
        }),
        execute: async (input) => this.coordinateWorkspace(input)
      }),
      sandbox_ping: tool({
        description: "Check whether the first-party Cloudflare Sandbox executor is reachable.",
        inputSchema: z.object({
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'.")
        }),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_ping", input)
      }),
      sandbox_exec: tool({
        description:
          "Run a bounded shell command inside the first-party Cloudflare Sandbox workspace. Use this for code execution, package probes, and filesystem work when the executor plane is configured.",
        inputSchema: z.object({
          command: z.string().min(1).describe("Shell command to run inside the sandbox."),
          cwd: z.string().optional().describe("Workspace-relative or /workspace path."),
          timeoutMs: z.number().int().min(1000).max(300000).default(30000),
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'."),
          env: z.record(z.string(), z.string()).optional().describe("Temporary environment variables for the command.")
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_exec", input)
      }),
      sandbox_diff: tool({
        description:
          "Capture the current Git diff from the first-party Cloudflare Sandbox workspace, summarize it, and store it as a reviewable .diff artifact when artifact storage is bound.",
        inputSchema: z.object({
          cwd: z.string().optional().describe("Workspace-relative or /workspace path. Defaults to /workspace."),
          pathspec: z.union([z.string(), z.array(z.string())]).optional().describe("Optional git pathspec or pathspec list to limit the diff."),
          staged: z.boolean().default(false).describe("Capture staged changes with git diff --cached."),
          timeoutMs: z.number().int().min(1000).max(300000).default(30000),
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'."),
          artifactKey: z.string().optional().describe("Optional R2 artifact key. Defaults to diffs/<workspace>/<timestamp>.diff.")
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_diff", input)
      }),
      sandbox_read_file: tool({
        description: "Read a text file from the first-party Cloudflare Sandbox workspace.",
        inputSchema: z.object({
          path: z.string().min(1).describe("Workspace-relative or /workspace path."),
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'.")
        }),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_read_file", input)
      }),
      sandbox_write_file: tool({
        description: "Write a text file into the first-party Cloudflare Sandbox workspace.",
        inputSchema: z.object({
          path: z.string().min(1).describe("Workspace-relative or /workspace path."),
          content: z.string().describe("Text content to write."),
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'.")
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_write_file", input)
      }),
      sandbox_list_files: tool({
        description: "List files under a first-party Cloudflare Sandbox workspace directory.",
        inputSchema: z.object({
          path: z.string().optional().describe("Workspace-relative or /workspace path. Defaults to /workspace."),
          recursive: z.boolean().default(false),
          limit: z.number().int().min(1).max(1000).default(200),
          sandboxId: z.string().optional().describe("Optional sandbox instance id. Defaults to 'default'.")
        }),
        execute: async (input) => callSandboxExecutorTool(this.runtimeEnv, "sandbox_list_files", input)
      }),
      browser_snapshot: tool({
        description:
          "Capture a Cloudflare Browser Rendering snapshot from a URL or HTML, then store a browser-session artifact with screenshot and rendered HTML preview data.",
        inputSchema: z.object({
          url: z.string().url().optional().describe("Public URL to render with Cloudflare Browser Rendering."),
          html: z.string().optional().describe("Raw HTML to render instead of a URL."),
          artifactKey: z.string().optional().describe("Optional R2 artifact key. Defaults to browser/<host>/<timestamp>.browser.json."),
          viewport: z.object({
            width: z.number().int().min(240).max(3840).optional(),
            height: z.number().int().min(240).max(2400).optional(),
            deviceScaleFactor: z.number().min(1).max(4).optional()
          }).optional(),
          fullPage: z.boolean().default(true),
          waitUntil: z.enum(["load", "domcontentloaded", "networkidle0", "networkidle2"]).optional()
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
        execute: async (input) => captureBrowserSnapshotArtifact(this.runtimeEnv, input)
      }),
      browser_session: tool({
        description:
          "Create, inspect, or close a live Cloudflare Browser Run session and return human-readable Live View / DevTools links for takeover.",
        inputSchema: z.object({
          action: z.enum(["list", "create", "get", "close", "listTargets", "createTarget", "getTarget", "closeTarget"]).default("create"),
          sessionId: z.string().optional().describe("Browser Run session ID for get/close/target operations."),
          targetId: z.string().optional().describe("Browser tab target ID for getTarget/closeTarget."),
          url: z.string().url().optional().describe("Optional page URL to open in a new tab."),
          keepAliveMs: z.number().int().min(30_000).max(600_000).default(600_000),
          targets: z.boolean().default(true).describe("Include initial target metadata when creating a session."),
          artifactKey: z.string().optional().describe("Optional R2 artifact key for the live session manifest."),
          recording: z.boolean().optional().describe("Request Cloudflare Browser Run session recording when supported.")
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
        execute: async (input) => browserSessionOperation(this.runtimeEnv, input)
      }),
      confirmCloudflareOperation: tool({
        description:
          "Request owner approval before a destructive, expensive, or security-sensitive Cloudflare operation. This checkpoint does not execute the operation by itself.",
        inputSchema: z.object({
          operation: z.string().describe("The Cloudflare operation that needs approval"),
          risk: z.string().describe("Why approval is needed"),
          resources: z.array(z.string()).default([]).describe("Cloudflare resources affected by the operation")
        }),
        needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy()),
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

  private async coordinateWorkspace(input: {
    objective?: string | undefined;
    latestUserRequest?: string | undefined;
  }): Promise<Record<string, unknown>> {
    const workspace = await workspaceState(this.runtimeEnv);
    const subAgents = await listSubAgents(this.runtimeEnv).catch(() => []);
    const orchestrator = await this.subAgent(WorkspaceOrchestrator, workspace.id);
    const brief = await orchestrator.coordinate({
      ...input,
      workspace,
      subAgents,
      runtime: cloudAgentInstanceState(this.runtimeEnv)
    });
    await recordWorkspaceContext(this.runtimeEnv, {
      workspaceId: workspace.id,
      kind: "orchestrator-brief",
      summary: brief.summary,
      metadata: {
        nextActions: brief.nextActions,
        risks: brief.risks,
        subAgentBriefs: brief.subAgentBriefs
      }
    });
    return { ok: true, workspace, brief };
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
        if (isFullAutoApprovalPolicy(policy)) {
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

  getChatHistory(): UIMessage[] {
    try {
      return safeChatHistory(Array.isArray(this.messages) ? this.messages : []);
    } catch {
      return [];
    }
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    const url = new URL(request.url);

    if (request.method === "GET" && isAgentMessagesReadPath(url.pathname)) {
      const agent = await defaultPersonalAgent(env as RuntimeEnv);
      const messages = agent ? await agent.getChatHistory().catch(() => []) : [];
      return Response.json({ messages });
    }

    const routed = await routeAgentRequest(request, env, { cors: true }).catch((error) => {
      if (url.pathname.startsWith("/agents/")) {
        return Response.json(
          {
            error: "Agents SDK route failed",
            detail: error instanceof Error ? error.message : String(error),
            path: url.pathname
          },
          { status: 500 }
        );
      }
      throw error;
    });
    if (routed) return routed;

    const sandboxProxy = await maybeProxySandboxRequest(request, env as RuntimeEnv);
    if (sandboxProxy) return sandboxProxy;

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
        subAgents: subAgentCapabilityState(env as RuntimeEnv),
        workspace: await workspaceState(env as RuntimeEnv)
      });
    }

    if (url.pathname === "/workspace") {
      return handleWorkspaceRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/goal") {
      return handleGoalRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/skills") {
      return handleSkillsRequest(env as RuntimeEnv);
    }

    if (url.pathname === "/memory") {
      return handleMemoryRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/artifacts") {
      return handleArtifactsRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/files") {
      return handleFilesRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/tasks") {
      return handleTasksRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/browser/snapshot") {
      if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
      return Response.json(await captureBrowserSnapshotArtifact(
        env as RuntimeEnv,
        await request.json().catch(() => ({}))
      ));
    }

    if (url.pathname === "/browser/diagnostics") {
      return handleBrowserDiagnosticsRequest(request, env as RuntimeEnv);
    }

    const browserSessionRoute = parseBrowserSessionRoute(url.pathname);
    if (browserSessionRoute) {
      return handleBrowserSessionsRequest(request, env as RuntimeEnv, browserSessionRoute);
    }

    if (url.pathname === "/contributions") {
      return handleContributionRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/learning") {
      return handleLearningRequest(request, env as RuntimeEnv);
    }

    const learningRoute = parseLearningSuggestionRoute(url.pathname);
    if (learningRoute) {
      return handleLearningSuggestionRequest(request, env as RuntimeEnv, learningRoute.id);
    }

    if (url.pathname === "/executor") {
      return Response.json(executorCapabilityState(env as RuntimeEnv));
    }

    if (url.pathname === "/mcp/servers") {
      return Response.json({
        servers: mcpServerCatalog(env as RuntimeEnv),
        note: "Package runtime registers MCP servers through the Agents SDK mcp registry. Use /agents/.../mcp/state for live connection state."
      });
    }

    if (url.pathname === "/mcp/state") {
      const agent = await defaultPersonalAgent(env as RuntimeEnv);
      return Response.json(agent ? agent.getMcpServers() : {});
    }

    if (url.pathname === "/mcp/observability") {
      return Response.json(await mcpObservabilityState(env as RuntimeEnv, {
        includeSeries: url.searchParams.get("series") === "1"
      }));
    }

    if (url.pathname === "/mcp/add" && request.method === "POST") {
      const agent = await defaultPersonalAgent(env as RuntimeEnv);
      if (!agent) {
        return Response.json({ error: "PersonalChatAgent is not reachable." }, { status: 503 });
      }
      return agent.onRequest(request);
    }

    if (url.pathname === "/mcp/tools") {
      return handleMcpToolsRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/mcp/call") {
      return handleMcpCallRequest(request, env as RuntimeEnv);
    }

    if (url.pathname === "/subagents" && request.method === "GET") {
      const agent = await defaultPersonalAgent(env as RuntimeEnv);
      if (agent) return Response.json(await agent.listManagedSubAgents());
      return handleSubAgentsList(env as RuntimeEnv);
    }

    if (url.pathname === "/subagents" && request.method === "POST") {
      const agent = await defaultPersonalAgent(env as RuntimeEnv);
      if (agent) {
        const payload = await request.json().catch(() => ({}));
        return Response.json(await agent.createManagedSubAgent(payload as Record<string, unknown>));
      }
      return handleSubAgentCreate(request, env as RuntimeEnv);
    }

    const subAgentRoute = parseSubAgentRoute(url.pathname);
    if (subAgentRoute) {
      return handleSubAgentRoute(request, env as RuntimeEnv, subAgentRoute, await defaultPersonalAgent(env as RuntimeEnv));
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

async function defaultPersonalAgent(env: RuntimeEnv): Promise<PersonalChatAgentStub | null> {
  const namespace = (env as { PersonalChatAgent?: unknown }).PersonalChatAgent;
  if (!namespace) return null;
  const agent = await getAgentByName(namespace as never, "default", { routingRetry: { maxAttempts: 3 } }).catch(() => null);
  return agent as PersonalChatAgentStub | null;
}

function hostedAgentHealth(env: RuntimeEnv) {
  return {
    ok: true,
    runtime: "cloudflare-agents-sdk",
    agent: "PersonalChatAgent",
    defaultModel: env.OPEN_THINK_DEFAULT_MODEL ?? defaultModel,
    cloudAgentInstance: cloudAgentInstanceState(env),
    sdk: cloudAgentInstanceState(env).sdk,
    slashCommands: {
      goal: goalCommandPayload("", env),
      train: trainCommandPayload("")
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
      "/runtime/context",
      "/workspace",
      "/skills",
      "/memory",
      "/artifacts",
      "/files",
      "/tasks",
      "/browser/snapshot",
      "/browser/diagnostics",
      "/browser/sessions",
      "/browser/sessions/{sessionId}",
      "/browser/sessions/{sessionId}/targets",
      "/browser/sessions/{sessionId}/targets/{targetId}",
      "/learning",
      "/executor",
      "/mcp/servers",
      "/mcp/state",
      "/mcp/add",
      "/mcp/tools",
      "/mcp/call",
      "/mcp/observability"
    ]
  };
}

async function handleSkillsRequest(env: RuntimeEnv): Promise<Response> {
  const profile = cloudAgentInstanceState(env);
  return Response.json({
    available: true,
    status: "configured",
    skills: profile.skills,
    workspaceSkills: workspaceDefaultSkills,
    sources: workspaceSkillSources.map((source) => source.url),
    sourceCatalog: workspaceSkillSources,
    install: {
      available: false,
      note: "Deploy-time skill catalog presets are active now. Runtime promotion happens through Train/Learning suggestions and the Artifacts/Sandbox workspace lane."
    }
  });
}

async function handleMemoryRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const query = normalizeLongText(url.searchParams.get("q") ?? url.searchParams.get("query"), "");
    const limit = Number(url.searchParams.get("limit") ?? 50);
    return Response.json(query ? await memorySearch(env, query, limit) : await memoryList(env, limit));
  }
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const payload = await request.json().catch(() => ({}));
  const text = normalizeLongText((payload as { text?: unknown; memory?: unknown }).text ?? (payload as { memory?: unknown }).memory, "");
  if (!text) return Response.json({ error: "text is required" }, { status: 400 });
  return Response.json(await memoryPut(env, text));
}

async function handleArtifactsRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!env.AGENT_STORAGE) {
    return Response.json({
      available: false,
      artifacts: [],
      status: "not-configured",
      note: "Bind AGENT_STORAGE to R2 to enable artifact listing and canvas/library previews."
    });
  }

  const url = new URL(request.url);
  if (request.method === "GET") {
    const key = url.searchParams.get("key");
    if (key) {
      const versionKey = normalizeArtifactVersionKey(url.searchParams.get("version"), key);
      const object = await env.AGENT_STORAGE.get(versionKey || key);
      if (!object) return Response.json({ error: "Artifact not found." }, { status: 404 });
      const versions = url.searchParams.get("versions")
        ? await artifactVersions(env, key)
        : [];
      return Response.json({
        key,
        versionKey: versionKey || key,
        title: artifactTitleFromKey(key),
        type: artifactTypeFromKey(key),
        text: await object.text(),
        versions
      });
    }
    const list = await env.AGENT_STORAGE.list({ limit: 50 });
    const versionCounts = artifactVersionCounts(list.objects ?? []);
    return Response.json({
      available: true,
      status: "configured",
      artifacts: (list.objects ?? []).map((object) => ({
        key: object.key,
        title: artifactTitleFromKey(object.key),
        size: object.size ?? null,
        uploaded: object.uploaded ? String(object.uploaded) : null,
        type: artifactTypeFromKey(object.key),
        versions: versionCounts.get(object.key) ?? 1
      })).filter((artifact) => !artifact.key.startsWith(artifactVersionPrefix))
    });
  }

  if (request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const key = normalizeArtifactKey((payload as { key?: unknown }).key);
    const text = normalizeLongText((payload as { text?: unknown; content?: unknown }).text ?? (payload as { content?: unknown }).content, "");
    if (!key || !text) return Response.json({ error: "key and text are required." }, { status: 400 });
    const previous = await env.AGENT_STORAGE.get(key);
    let previousVersionKey: string | null = null;
    if (previous) {
      previousVersionKey = artifactVersionKey(key);
      await env.AGENT_STORAGE.put(previousVersionKey, await previous.text(), {
        httpMetadata: { contentType: contentTypeFromArtifactKey(key) }
      });
    }
    await env.AGENT_STORAGE.put(key, text, {
      httpMetadata: { contentType: contentTypeFromArtifactKey(key) }
    });
    return Response.json({ ok: true, key, previousVersionKey });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function handleFilesRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (!env.AGENT_STORAGE) {
    if (request.method === "GET" && !new URL(request.url).searchParams.get("key")) {
      return Response.json({
        available: false,
        files: [],
        status: "not-configured",
        note: "Bind AGENT_STORAGE to R2 to enable the hosted file workspace."
      });
    }
    return Response.json({
      available: false,
      files: [],
      status: "not-configured",
      note: "Bind AGENT_STORAGE to R2 to enable the hosted file workspace."
    }, { status: 503 });
  }

  const url = new URL(request.url);
  const key = normalizeArtifactKey(url.searchParams.get("key"));

  if (request.method === "GET") {
    if (key) {
      const object = await env.AGENT_STORAGE.get(key);
      if (!object) return Response.json({ error: "File not found." }, { status: 404 });
      const text = await object.text();
      if (url.searchParams.get("json") === "1") {
        return Response.json({
          available: true,
          key,
          text,
          type: artifactTypeFromKey(key),
          contentType: contentTypeFromArtifactKey(key)
        });
      }
      return new Response(text, {
        headers: { "Content-Type": contentTypeFromArtifactKey(key) }
      });
    }

    const list = await env.AGENT_STORAGE.list({ limit: 100 });
    return Response.json({
      available: true,
      status: "configured",
      files: (list.objects ?? [])
        .filter((object) => !object.key.startsWith(artifactVersionPrefix))
        .map((object) => ({
          key: object.key,
          title: artifactTitleFromKey(object.key),
          type: artifactTypeFromKey(object.key),
          size: object.size ?? null,
          uploaded: object.uploaded ? String(object.uploaded) : null
        }))
    });
  }

  if (request.method === "PUT" || request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await request.json().catch(() => ({}));
      const payloadKey = normalizeArtifactKey((payload as { key?: unknown }).key ?? key);
      const text = normalizeLongText((payload as { text?: unknown; content?: unknown }).text ?? (payload as { content?: unknown }).content, "");
      if (!payloadKey || !text) return Response.json({ error: "key and text are required." }, { status: 400 });
      await env.AGENT_STORAGE.put(payloadKey, text, {
        httpMetadata: { contentType: contentTypeFromArtifactKey(payloadKey) }
      });
      return Response.json({ ok: true, key: payloadKey, stored: true });
    }

    if (!key) return Response.json({ error: "key query parameter is required." }, { status: 400 });
    const body = await request.text();
    await env.AGENT_STORAGE.put(key, body, {
      httpMetadata: { contentType: contentTypeFromArtifactKey(key) }
    });
    return Response.json({ ok: true, key, stored: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function handleTasksRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "GET") {
    return Response.json(await listTasks(env));
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await request.json().catch(() => ({}));
  const title = normalizeLongText(
    (payload as { title?: unknown; task?: unknown; message?: unknown }).title ??
      (payload as { task?: unknown; message?: unknown }).task ??
      (payload as { message?: unknown }).message,
    "Agent task"
  );
  const now = new Date().toISOString();
  const task = {
    id: "task_" + crypto.randomUUID(),
    title,
    status: env.TASK_QUEUE ? "queued" : "recorded",
    payload,
    createdAt: now,
    updatedAt: now
  };

  if (!env.TASK_QUEUE && !env.DB) {
    return Response.json({
      available: false,
      queued: false,
      error: "TASK_QUEUE or DB binding is required to accept tasks."
    }, { status: 503 });
  }

  if (env.DB) {
    await ensureTaskTable(env);
    await env.DB.prepare(
      "insert into agent_tasks (id, title, status, payload_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?)"
    ).bind(task.id, task.title, task.status, JSON.stringify(payload), now, now).run();
  }

  if (env.TASK_QUEUE) {
    await env.TASK_QUEUE.send({
      taskId: task.id,
      title: task.title,
      payload,
      agent: env.OPEN_THINK_AGENT_NAME ?? "PersonalChatAgent",
      queuedAt: now
    });
  }

  return Response.json({
    ok: true,
    available: true,
    queued: Boolean(env.TASK_QUEUE),
    task,
    note: env.TASK_QUEUE ? undefined : "TASK_QUEUE is not bound; task was recorded in D1 only."
  }, { status: 202 });
}

async function handleContributionRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "GET") {
    return Response.json(contributionCapabilityState(env));
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!env.OPEN_THINK_GITHUB_TOKEN) {
    return Response.json(
      {
        error: "OPEN_THINK_GITHUB_TOKEN is required to open upstream pull requests.",
        ...contributionCapabilityState(env)
      },
      { status: 409 }
    );
  }

  const payload = await request.json().catch(() => ({}));
  const title = normalizeLongText((payload as { title?: unknown }).title, "");
  if (!title) return Response.json({ error: "title is required." }, { status: 400 });

  const repository = githubRepository(env);
  const baseBranch = normalizeGithubBranch((payload as { baseBranch?: unknown }).baseBranch, githubBranch(env));
  const branchName = normalizeGithubBranch(
    (payload as { branchName?: unknown }).branchName,
    "open-think/agent-" + slugify(title) + "-" + Date.now().toString(36)
  );
  const body = normalizeLongText(
    (payload as { body?: unknown; summary?: unknown }).body ?? (payload as { summary?: unknown }).summary,
    "Agent-authored contribution prepared by OpenThink."
  );
  const changes = await contributionChangesFromPayload(payload as Record<string, unknown>, env, {
    repository,
    baseBranch
  });
  if (changes.length === 0) {
    return Response.json({ error: "Provide changes or artifactKeys to create a pull request." }, { status: 400 });
  }

  try {
    const pullRequest = await createGithubContributionPullRequest(env, {
      repository,
      baseBranch,
      branchName,
      title,
      body,
      changes
    });
    await recordContributionPullRequest(env, {
      id: crypto.randomUUID(),
      title,
      branchName,
      url: pullRequest.html_url,
      status: "open",
      createdAt: new Date().toISOString()
    });

    return Response.json({
      ok: true,
      repository,
      baseBranch,
      branchName,
      pullRequest
    }, { status: 201 });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "GitHub pull request creation failed.",
        repository,
        baseBranch,
        branchName
      },
      { status: 502 }
    );
  }
}

async function handleLearningRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  if (request.method === "POST") {
    return Response.json(await createLearningSuggestion(env, await request.json().catch(() => ({}))), { status: 201 });
  }
  if (request.method !== "GET") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const memories = await memoryList(env, 20);
  const suggestions = await learningSuggestions(env, memories.memories);
  const pendingSuggestions = suggestions.filter((suggestion) => suggestion.status === "pending");
  const pendingMemoryCount = pendingSuggestions.filter((suggestion) => suggestion.kind === "memory").length;
  const pendingSkillCount = pendingSuggestions.filter((suggestion) => suggestion.kind === "skill").length;
  return Response.json({
    available: true,
    status: env.DB ? "curated" : "preview",
    trainMode: {
      command: "/train",
      available: true,
      teachMode: true,
      behavior: "Draft explicit editable steps before execution, then offer to save successful patterns as skills."
    },
    memories: {
      available: memories.available,
      pending: pendingMemoryCount,
      items: memories.memories
    },
    skills: {
      available: true,
      pending: pendingSkillCount,
      suggestions: suggestions.filter((suggestion) => suggestion.kind === "skill")
    },
    suggestions: {
      pending: pendingSuggestions.length,
      accepted: suggestions.filter((suggestion) => suggestion.status === "accepted").length,
      rejected: suggestions.filter((suggestion) => suggestion.status === "rejected").length,
      items: suggestions
    },
    vectorize: vectorizeState(env)
  });
}

type MemoryItem = { id: string; text: string; createdAt: string };
type AgentTask = {
  id: string;
  title: string;
  status: string;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
type LearningSuggestionStatus = "pending" | "accepted" | "rejected";
type LearningSuggestionKind = "memory" | "skill" | "rubric" | "workflow";
type LearningSuggestion = {
  id: string;
  kind: LearningSuggestionKind;
  title: string;
  summary: string;
  status: LearningSuggestionStatus;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

async function ensureTaskTable(env: RuntimeEnv): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB.prepare(
    "create table if not exists agent_tasks (id text primary key, title text not null, status text not null, payload_json text not null, created_at text not null, updated_at text not null)"
  ).run();
  return true;
}

async function listTasks(env: RuntimeEnv, limit = 50): Promise<Record<string, unknown>> {
  if (!(await ensureTaskTable(env))) {
    return {
      available: Boolean(env.TASK_QUEUE),
      status: env.TASK_QUEUE ? "queue-only" : "not-configured",
      queueConfigured: Boolean(env.TASK_QUEUE),
      tasks: []
    };
  }

  const rows = await env.DB!.prepare(
    "select id, title, status, payload_json, created_at, updated_at from agent_tasks order by created_at desc limit ?"
  ).bind(Math.max(1, Math.min(limit, 100))).all<{
    id: string;
    title: string;
    status: string;
    payload_json: string;
    created_at: string;
    updated_at: string;
  }>();

  const tasks: AgentTask[] = (rows.results ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    payload: asMetadata(row.payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));

  return {
    available: true,
    status: env.TASK_QUEUE ? "queued-and-tracked" : "tracked-only",
    queueConfigured: Boolean(env.TASK_QUEUE),
    tasks
  };
}

function parseLearningSuggestionRoute(pathname: string): { id: string } | null {
  const match = pathname.match(/^\/learning\/([^/]+)$/);
  if (!match?.[1]) return null;
  return { id: decodeURIComponent(match[1]) };
}

async function handleLearningSuggestionRequest(request: Request, env: RuntimeEnv, id: string): Promise<Response> {
  if (request.method !== "PATCH" && request.method !== "DELETE") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const payload = request.method === "DELETE"
    ? { status: "rejected" }
    : await request.json().catch(() => ({}));
  const result = await updateLearningSuggestion(env, id, payload);
  return Response.json(result, { status: result.ok === false ? 400 : 200 });
}

async function ensureLearningSuggestionTable(env: RuntimeEnv): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB!.prepare(
    "create table if not exists learning_suggestions (id text primary key, kind text not null, title text not null, summary text not null, status text not null, source text not null, metadata_json text not null, created_at text not null, updated_at text not null)"
  ).run();
  return true;
}

async function seedLearningSuggestions(env: RuntimeEnv, memories: MemoryItem[]): Promise<void> {
  if (!(await ensureLearningSuggestionTable(env))) return;
  const now = new Date().toISOString();
  const seeds = [
    ...workspaceDefaultSkills.slice(0, 8).map((skill) => ({
      id: "skill:" + skill,
      kind: "skill" as const,
      title: "Review skill: " + skill,
      summary: "Confirm whether the " + skill + " skill should stay enabled for this workspace.",
      source: "workspace-default",
      metadata: { skill }
    })),
    ...memories.slice(0, 8).map((memory) => ({
      id: "memory:" + memory.id,
      kind: "memory" as const,
      title: "Review memory",
      summary: memory.text,
      source: "memory",
      metadata: { memoryId: memory.id, createdAt: memory.createdAt }
    }))
  ];

  for (const seed of seeds) {
    await env.DB!.prepare(
      "insert or ignore into learning_suggestions (id, kind, title, summary, status, source, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(seed.id, seed.kind, seed.title, seed.summary, "pending", seed.source, JSON.stringify(seed.metadata), now, now).run();
  }
}

async function learningSuggestions(env: RuntimeEnv, memories: MemoryItem[] = []): Promise<LearningSuggestion[]> {
  if (!(await ensureLearningSuggestionTable(env))) {
    return workspaceDefaultSkills.slice(0, 8).map((skill) => ({
      id: "skill:" + skill,
      kind: "skill",
      title: "Review skill: " + skill,
      summary: "Confirm whether the " + skill + " skill should stay enabled for this workspace.",
      status: "pending",
      source: "workspace-default",
      metadata: { skill },
      createdAt: "",
      updatedAt: ""
    }));
  }
  await seedLearningSuggestions(env, memories);
  const rows = await env.DB!.prepare(
    "select * from learning_suggestions order by case status when 'pending' then 0 when 'accepted' then 1 else 2 end, datetime(updated_at) desc limit 100"
  ).all<Record<string, unknown>>();
  return (rows.results ?? []).map(rowToLearningSuggestion);
}

async function createLearningSuggestion(env: RuntimeEnv, payload: unknown): Promise<Record<string, unknown>> {
  if (!(await ensureLearningSuggestionTable(env))) {
    return { ok: false, error: "D1 DB binding is not configured." };
  }
  const record = payload as Record<string, unknown>;
  const kind = normalizeLearningSuggestionKind(record.kind);
  const title = normalizeShortText(record.title, kind === "skill" ? "Review skill" : "Review learning");
  const summary = normalizeLongText(record.summary ?? record.text, "");
  if (!summary) return { ok: false, error: "summary or text is required." };
  const now = new Date().toISOString();
  const suggestion: LearningSuggestion = {
    id: "learn:" + crypto.randomUUID(),
    kind,
    title,
    summary,
    status: "pending",
    source: normalizeShortText(record.source, "manual"),
    metadata: asMetadata(record.metadata),
    createdAt: now,
    updatedAt: now
  };
  await env.DB!.prepare(
    "insert into learning_suggestions (id, kind, title, summary, status, source, metadata_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    suggestion.id,
    suggestion.kind,
    suggestion.title,
    suggestion.summary,
    suggestion.status,
    suggestion.source,
    JSON.stringify(suggestion.metadata),
    suggestion.createdAt,
    suggestion.updatedAt
  ).run();
  return { ok: true, suggestion };
}

async function updateLearningSuggestion(env: RuntimeEnv, id: string, payload: unknown): Promise<Record<string, unknown>> {
  if (!(await ensureLearningSuggestionTable(env))) {
    return { ok: false, error: "D1 DB binding is not configured." };
  }
  const record = payload as Record<string, unknown>;
  const existing = await env.DB!.prepare("select * from learning_suggestions where id = ? limit 1")
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return { ok: false, error: "Learning suggestion not found." };
  const status = normalizeLearningSuggestionStatus(record.status, String(existing.status ?? "pending"));
  const title = record.title === undefined ? String(existing.title ?? "") : normalizeShortText(record.title, String(existing.title ?? ""));
  const summary = record.summary === undefined && record.text === undefined
    ? String(existing.summary ?? "")
    : normalizeLongText(record.summary ?? record.text, String(existing.summary ?? ""));
  const now = new Date().toISOString();
  await env.DB!.prepare("update learning_suggestions set status = ?, title = ?, summary = ?, updated_at = ? where id = ?")
    .bind(status, title, summary, now, id)
    .run();
  const updated = await env.DB!.prepare("select * from learning_suggestions where id = ? limit 1")
    .bind(id)
    .first<Record<string, unknown>>();
  return { ok: true, suggestion: updated ? rowToLearningSuggestion(updated) : null };
}

function rowToLearningSuggestion(row: Record<string, unknown>): LearningSuggestion {
  return {
    id: String(row.id ?? ""),
    kind: normalizeLearningSuggestionKind(row.kind),
    title: String(row.title ?? ""),
    summary: String(row.summary ?? ""),
    status: normalizeLearningSuggestionStatus(row.status, "pending"),
    source: String(row.source ?? "runtime"),
    metadata: asMetadata(row.metadata_json),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
}

function normalizeLearningSuggestionKind(value: unknown): LearningSuggestionKind {
  const kind = String(value ?? "").trim().toLowerCase();
  if (kind === "memory" || kind === "skill" || kind === "rubric" || kind === "workflow") return kind;
  return "memory";
}

function normalizeLearningSuggestionStatus(value: unknown, fallback: string): LearningSuggestionStatus {
  const status = String(value ?? fallback).trim().toLowerCase();
  if (status === "accept" || status === "accepted") return "accepted";
  if (status === "reject" || status === "dismiss" || status === "rejected") return "rejected";
  return "pending";
}

async function memoryList(env: RuntimeEnv, limit = 20): Promise<{ available: boolean; memories: MemoryItem[]; semantic: Record<string, unknown> }> {
  if (!env.DB) return { available: false, memories: [], semantic: vectorizeState(env) };
  await env.DB.prepare(
    "create table if not exists memories (id text primary key, text text not null, created_at text not null)"
  ).run();
  const rows = await env.DB.prepare("select id, text, created_at from memories order by datetime(created_at) desc limit ?")
    .bind(Math.max(1, Math.min(100, limit)))
    .all<Record<string, unknown>>();
  return {
    available: true,
    memories: (rows.results ?? []).map((row) => ({
      id: String(row.id ?? ""),
      text: String(row.text ?? ""),
      createdAt: String(row.created_at ?? "")
    })),
    semantic: vectorizeState(env)
  };
}

async function memoryPut(env: RuntimeEnv, text: string): Promise<Record<string, unknown>> {
  if (!env.DB) return { ok: false, stored: false, error: "D1 DB binding is not configured." };
  await env.DB.prepare(
    "create table if not exists memories (id text primary key, text text not null, created_at text not null)"
  ).run();
  const item = {
    id: crypto.randomUUID(),
    text,
    createdAt: new Date().toISOString()
  };
  await env.DB.prepare("insert into memories (id, text, created_at) values (?, ?, ?)")
    .bind(item.id, item.text, item.createdAt)
    .run();
  const semantic = await vectorizeUpsertText(env, {
    id: "memory-" + item.id,
    text: item.text,
    type: "memory",
    metadata: {
      memoryId: item.id,
      createdAt: item.createdAt
    }
  }).catch((error: unknown) => ({
    available: false,
    status: "indexing-failed",
    error: error instanceof Error ? error.message : String(error)
  }));
  return { ok: true, stored: true, memory: item, semantic };
}

async function memorySearch(
  env: RuntimeEnv,
  query: string,
  limit = 10
): Promise<{ available: boolean; query: string; memories: MemoryItem[]; semantic: Record<string, unknown> }> {
  const boundedLimit = Math.max(1, Math.min(50, Number.isFinite(limit) ? limit : 10));
  const semantic = await vectorizeSearchText(env, query, boundedLimit, "memory").catch((error: unknown) => ({
    available: false,
    status: "query-failed",
    matches: [],
    error: error instanceof Error ? error.message : String(error)
  }));
  if (semantic.available && Array.isArray(semantic.matches) && semantic.matches.length > 0) {
    return {
      available: true,
      query,
      memories: semantic.matches.map((match) => ({
        id: String(match.metadata?.memoryId ?? match.id),
        text: String(match.metadata?.text ?? ""),
        createdAt: String(match.metadata?.createdAt ?? "")
      })),
      semantic
    };
  }

  const listed = await memoryList(env, 100);
  const normalized = query.toLowerCase();
  return {
    available: listed.available,
    query,
    memories: listed.memories
      .filter((memory) => memory.text.toLowerCase().includes(normalized))
      .slice(0, boundedLimit),
    semantic
  };
}

async function vectorizeUpsertText(
  env: RuntimeEnv,
  input: {
    id: string;
    text: string;
    type: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  const vectorize = vectorizeIndex(env);
  if (!vectorize) return { available: false, status: "vectorize-not-configured" };

  const embedding = await embedText(env, input.text);
  if (!embedding) return { available: false, status: "embedding-not-configured", model: memoryEmbeddingModel };

  const vector: VectorizeVectorLike = {
    id: input.id,
    values: embedding,
    metadata: {
      type: input.type,
      text: truncateText(input.text, 1800),
      ...input.metadata
    }
  };

  if (typeof vectorize.upsert === "function") {
    await vectorize.upsert([vector]);
  } else if (typeof vectorize.insert === "function") {
    await vectorize.insert([vector]);
  } else {
    return { available: false, status: "vectorize-write-unavailable" };
  }

  return {
    available: true,
    status: "indexed",
    id: input.id,
    model: memoryEmbeddingModel,
    dimensions: embedding.length
  };
}

async function vectorizeSearchText(
  env: RuntimeEnv,
  query: string,
  limit: number,
  type?: string
): Promise<{ available: boolean; status: string; matches: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }>; model?: string; dimensions?: number }> {
  const vectorize = vectorizeIndex(env);
  if (!vectorize || typeof vectorize.query !== "function") {
    return { available: false, status: "vectorize-query-unavailable", matches: [] };
  }

  const embedding = await embedText(env, query);
  if (!embedding) return { available: false, status: "embedding-not-configured", matches: [], model: memoryEmbeddingModel };

  const raw = await vectorize.query(embedding, {
    topK: Math.max(1, Math.min(50, limit)),
    returnMetadata: true
  });
  const matches = parseVectorizeMatches(raw)
    .filter((match) => !type || match.metadata?.type === type)
    .slice(0, limit);

  return {
    available: true,
    status: "queried",
    matches,
    model: memoryEmbeddingModel,
    dimensions: embedding.length
  };
}

async function embedText(env: RuntimeEnv, text: string): Promise<number[] | null> {
  const ai = workersAiBinding(env);
  if (!ai) return null;
  const result = await ai.run(memoryEmbeddingModel, {
    text: [truncateText(text, 4000)]
  });
  const data = (result as { data?: unknown }).data;
  if (Array.isArray(data) && Array.isArray(data[0])) {
    return normalizeEmbedding(data[0]);
  }
  if (Array.isArray(data)) return normalizeEmbedding(data);
  return null;
}

function normalizeEmbedding(value: unknown[]): number[] | null {
  const embedding = value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  return embedding.length > 0 ? embedding : null;
}

function workersAiBinding(env: RuntimeEnv): WorkersAiBindingLike | null {
  const candidate = env.AI as WorkersAiBindingLike | undefined;
  return candidate && typeof candidate.run === "function" ? candidate : null;
}

function vectorizeIndex(env: RuntimeEnv): VectorizeIndexLike | null {
  const candidate = env.VECTORIZE as VectorizeIndexLike | undefined;
  if (!candidate) return null;
  if (typeof candidate.upsert === "function" || typeof candidate.insert === "function" || typeof candidate.query === "function") {
    return candidate;
  }
  return null;
}

function parseVectorizeMatches(raw: unknown): Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> {
  const matches = (raw as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) return [];
  return matches.map((item) => {
    const record = item as Record<string, unknown>;
    const metadata = record.metadata && typeof record.metadata === "object"
      ? record.metadata as Record<string, unknown>
      : undefined;
    return {
      id: String(record.id ?? ""),
      ...(typeof record.score === "number" ? { score: record.score } : {}),
      ...(metadata ? { metadata } : {})
    };
  }).filter((match) => Boolean(match.id));
}

async function handleWorkspaceRequest(
  request: Request,
  env: RuntimeEnv,
  agent?: PersonalChatAgent
): Promise<Response> {
  if (request.method === "GET") {
    return Response.json({
      workspace: await workspaceState(env),
      context: await workspaceContext(env),
      capability: workspaceCapabilityState(env)
    });
  }

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const payload = await request.json().catch(() => ({}));
  const summary = normalizeLongText(
    (payload as { summary?: unknown; text?: unknown }).summary ?? (payload as { text?: unknown }).text,
    ""
  );
  if (!summary) return Response.json({ error: "summary is required" }, { status: 400 });

  const item = await recordWorkspaceContext(env, {
    workspaceId: defaultWorkspaceId,
    kind: normalizeShortText((payload as { kind?: unknown }).kind, "note"),
    summary,
    metadata: asMetadata((payload as { metadata?: unknown }).metadata)
  });

  const workspace = await workspaceState(env);
  const orchestrator = agent ? await agent.subAgent(WorkspaceOrchestrator, workspace.id).catch(() => null) : null;
  const brief = orchestrator
    ? await orchestrator.coordinate({ workspace, latestUserRequest: summary, runtime: cloudAgentInstanceState(env) })
    : null;

  return Response.json({ ok: true, workspace, item, brief });
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
  route: { id: string; action: string },
  agent?: PersonalChatAgentStub | null
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
    const result = agent
      ? await agent.sendManagedSubAgentMessage(route.id, String(payload.message ?? payload.text ?? ""))
      : await sendSubAgentMessage(env, route.id, String(payload.message ?? payload.text ?? ""));
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "control" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const status = normalizeSubAgentStatus(payload.status ?? payload.action, "ready");
    const result = agent
      ? await agent.controlManagedSubAgent(route.id, status)
      : await updateSubAgentStatus(env, route.id, status);
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  if (route.action === "summary" && request.method === "POST") {
    const result = agent ? await agent.summarizeManagedSubAgent(route.id) : await refreshSubAgentSummary(env, route.id);
    return Response.json(result, { status: result.ok === false ? 400 : 200 });
  }

  return Response.json({ error: "Unsupported sub-agent route." }, { status: 404 });
}

const defaultWorkspaceId = "default";

async function ensureWorkspaceTables(env: RuntimeEnv): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB.prepare(
    "create table if not exists workspaces (id text primary key, name text not null, purpose text not null, approval_policy text not null, orchestrator_status text not null, context_summary text not null, skills_json text not null, created_at text not null, updated_at text not null)"
  ).run();
  await env.DB.prepare(
    "create table if not exists workspace_context (id text primary key, workspace_id text not null, kind text not null, summary text not null, metadata_json text not null, created_at text not null)"
  ).run();

  const existing = await env.DB.prepare("select id from workspaces where id = ? limit 1")
    .bind(defaultWorkspaceId)
    .first();
  if (!existing) {
    const now = new Date().toISOString();
    const initial = defaultWorkspaceState(env);
    await env.DB.prepare(
      "insert into workspaces (id, name, purpose, approval_policy, orchestrator_status, context_summary, skills_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      initial.id,
      initial.name,
      initial.purpose,
      initial.approvalPolicy,
      initial.orchestratorStatus,
      initial.contextSummary,
      JSON.stringify(initial.skills),
      now,
      now
    ).run();
  }
  return true;
}

async function workspaceState(env?: RuntimeEnv): Promise<WorkspaceState> {
  if (!env?.DB || !(await ensureWorkspaceTables(env))) return defaultWorkspaceState(env);
  const row = await env.DB.prepare("select * from workspaces where id = ? limit 1")
    .bind(defaultWorkspaceId)
    .first<Record<string, unknown>>();
  return row ? rowToWorkspaceState(row, env) : defaultWorkspaceState(env);
}

function defaultWorkspaceState(env?: RuntimeEnv): WorkspaceState {
  const now = new Date().toISOString();
  return {
    id: defaultWorkspaceId,
    name: "Default workspace",
    purpose: "Coordinate the main personal agent, sub-agents, Cloudflare projects, goals, and durable context.",
    approvalPolicy: normalizeToolApprovalPolicy(env?.OPEN_THINK_TOOL_APPROVAL_POLICY),
    orchestratorStatus: "ready",
    contextSummary: "Cloudflare and optional community/OpenAI/Anthropic skill catalogs are ready. Durable workspace context is stored in D1 when bound; Vectorize is advertised when connected.",
    skills: workspaceDefaultSkills,
    updatedAt: now
  };
}

async function workspaceContext(env: RuntimeEnv): Promise<{ available: boolean; items: WorkspaceContextItem[]; vectorize: Record<string, unknown> }> {
  if (!env.DB || !(await ensureWorkspaceTables(env))) {
    return {
      available: false,
      items: [],
      vectorize: vectorizeState(env)
    };
  }
  const rows = await env.DB.prepare(
    "select * from workspace_context where workspace_id = ? order by datetime(created_at) desc limit 20"
  ).bind(defaultWorkspaceId).all<Record<string, unknown>>();
  return {
    available: true,
    items: (rows.results ?? []).map(rowToWorkspaceContextItem),
    vectorize: vectorizeState(env)
  };
}

async function recordWorkspaceContext(
  env: RuntimeEnv,
  input: {
    workspaceId: string;
    kind: string;
    summary: string;
    metadata?: Record<string, unknown>;
  }
): Promise<WorkspaceContextItem | null> {
  if (!env.DB || !(await ensureWorkspaceTables(env))) return null;
  const now = new Date().toISOString();
  const item: WorkspaceContextItem = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    kind: normalizeShortText(input.kind, "note"),
    summary: normalizeLongText(input.summary, ""),
    metadata: input.metadata ?? {},
    createdAt: now
  };
  await env.DB.prepare(
    "insert into workspace_context (id, workspace_id, kind, summary, metadata_json, created_at) values (?, ?, ?, ?, ?, ?)"
  ).bind(item.id, item.workspaceId, item.kind, item.summary, JSON.stringify(item.metadata), item.createdAt).run();
  await env.DB.prepare("update workspaces set context_summary = ?, updated_at = ? where id = ?")
    .bind(item.summary, now, input.workspaceId)
    .run();
  await vectorizeUpsertText(env, {
    id: "workspace-" + item.id,
    text: item.summary,
    type: "workspace_context",
    metadata: {
      workspaceId: item.workspaceId,
      contextId: item.id,
      kind: item.kind,
      createdAt: item.createdAt
    }
  }).catch(() => undefined);
  return item;
}

function workspaceCapabilityState(env: RuntimeEnv) {
  return {
    enabled: true,
    orchestrator: {
      className: "WorkspaceOrchestrator",
      autoSpunUp: true,
      coordination: "native-sub-agent-rpc"
    },
    contextStore: {
      d1: Boolean(env.DB),
      vectorize: vectorizeState(env)
    },
    defaultSkills: workspaceDefaultSkills,
    cloudflareSkillSources,
    skillSources: workspaceSkillSources,
    approvalModes: ["auto", "ask-every-time", "allow-all", "full-auto"]
  };
}

function rowToWorkspaceState(row: Record<string, unknown>, env?: RuntimeEnv): WorkspaceState {
  return {
    id: String(row.id ?? defaultWorkspaceId),
    name: String(row.name ?? "Default workspace"),
    purpose: String(row.purpose ?? "Coordinate personal-agent workstreams."),
    approvalPolicy: normalizeToolApprovalPolicy(row.approval_policy ?? env?.OPEN_THINK_TOOL_APPROVAL_POLICY),
    orchestratorStatus: normalizeOrchestratorStatus(row.orchestrator_status),
    contextSummary: String(row.context_summary ?? ""),
    skills: parseJsonArray(row.skills_json).length ? parseJsonArray(row.skills_json) : workspaceDefaultSkills,
    updatedAt: String(row.updated_at ?? new Date().toISOString())
  };
}

function rowToWorkspaceContextItem(row: Record<string, unknown>): WorkspaceContextItem {
  return {
    id: String(row.id ?? ""),
    workspaceId: String(row.workspace_id ?? defaultWorkspaceId),
    kind: String(row.kind ?? "note"),
    summary: String(row.summary ?? ""),
    metadata: asMetadata(row.metadata_json),
    createdAt: String(row.created_at ?? "")
  };
}

function normalizeOrchestratorStatus(value: unknown): WorkspaceState["orchestratorStatus"] {
  const status = String(value ?? "ready").trim().toLowerCase();
  if (status === "working" || status === "paused") return status;
  return "ready";
}

function vectorizeState(env?: RuntimeEnv): Record<string, unknown> {
  const vectorizeConfigured = Boolean(env?.VECTORIZE);
  const aiConfigured = Boolean(env && workersAiBinding(env));
  return {
    binding: "VECTORIZE",
    configured: vectorizeConfigured,
    embeddingConfigured: aiConfigured,
    status: vectorizeConfigured && aiConfigured
      ? "semantic-memory-ready"
      : vectorizeConfigured
        ? "vectorize-bound-missing-ai"
        : "not-configured",
    embeddingModel: memoryEmbeddingModel,
    dimensions: memoryEmbeddingDimensions,
    use: "shared semantic recall for memories and workspace context"
  };
}

type SandboxExecutorToolName =
  | "sandbox_ping"
  | "sandbox_exec"
  | "sandbox_diff"
  | "sandbox_read_file"
  | "sandbox_write_file"
  | "sandbox_list_files";

interface SandboxExecutorApi {
  ping?: () => Promise<string>;
  exec(command: string, options?: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string | undefined>;
  }): Promise<Record<string, unknown>>;
  writeFile(path: string, content: string, options?: { encoding?: string }): Promise<Record<string, unknown>>;
  readFile(path: string, options?: { encoding?: string }): Promise<Record<string, unknown>>;
  listFiles(path: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

const sandboxExecutorToolCatalog = [
  {
    name: "sandbox_ping",
    title: "Check Sandbox",
    description: "Verify that the same-Worker Cloudflare Sandbox executor is reachable."
  },
  {
    name: "sandbox_exec",
    title: "Run Sandbox Command",
    description: "Run a bounded shell command inside the agent's Cloudflare Sandbox workspace."
  },
  {
    name: "sandbox_diff",
    title: "Capture Sandbox Diff",
    description: "Capture the current Git diff and store it as a reviewable .diff artifact."
  },
  {
    name: "sandbox_read_file",
    title: "Read Sandbox File",
    description: "Read a text file from the sandbox workspace."
  },
  {
    name: "sandbox_write_file",
    title: "Write Sandbox File",
    description: "Write a text file into the sandbox workspace."
  },
  {
    name: "sandbox_list_files",
    title: "List Sandbox Files",
    description: "List files under a sandbox workspace directory."
  }
] as const;

function sandboxBridgeAvailable(env: RuntimeEnv): boolean {
  return Boolean(env.Sandbox);
}

function executorConfigured(env: RuntimeEnv): boolean {
  return Boolean(sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)) || sandboxBridgeAvailable(env);
}

function executorStatus(env: RuntimeEnv): string {
  if (sandboxBridgeAvailable(env)) return "sandbox-bridge-ready";
  if (sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)) return "external-mcp-configured";
  if (runtimeFlagEnabled(env.OPEN_THINK_SANDBOX_STATUS) || runtimeFlagEnabled(env.OPEN_THINK_CONTAINER_STATUS)) {
    return "declared-unbound";
  }
  return "default-pending";
}

function executorTransport(env: RuntimeEnv): string {
  if (sandboxBridgeAvailable(env)) return "same-worker-sandbox-rpc";
  if (sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)) return "streamable-http";
  return "unavailable";
}

function getExecutorSandbox(env: RuntimeEnv, args?: Record<string, unknown>): SandboxExecutorApi {
  if (!env.Sandbox) {
    throw new Error("Sandbox binding is not configured on this Worker.");
  }
  const sandboxId = normalizeSandboxId(args?.sandboxId);
  const getBoundSandbox = getSandbox as unknown as (
    namespace: unknown,
    id: string,
    options?: Record<string, unknown>
  ) => SandboxExecutorApi;
  return getBoundSandbox(env.Sandbox, sandboxId, { transport: "rpc" });
}

async function maybeProxySandboxRequest(request: Request, env: RuntimeEnv): Promise<Response | null> {
  if (!env.Sandbox) return null;
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/sandbox/") && !url.pathname.startsWith("/terminal/")) return null;
  try {
    const proxy = proxyToSandbox as unknown as (
      proxiedRequest: Request,
      proxiedEnv: { Sandbox: unknown }
    ) => Promise<Response | null>;
    return await proxy(request, { Sandbox: env.Sandbox });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Sandbox proxy failed."
      },
      { status: 502 }
    );
  }
}

function normalizeSandboxId(value: unknown): string {
  const normalized = String(value ?? defaultSandboxId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || defaultSandboxId;
}

function normalizeSandboxPath(value: unknown, fallback = sandboxWorkspaceRoot): string {
  const raw = String(value ?? fallback).trim().replace(/\0/g, "");
  const candidate = raw || fallback;
  const absolute = candidate.startsWith("/") ? candidate : `${sandboxWorkspaceRoot}/${candidate}`;
  const parts: string[] = [];
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = "/" + parts.join("/");
  if (normalized === sandboxWorkspaceRoot || normalized.startsWith(`${sandboxWorkspaceRoot}/`)) {
    return normalized;
  }
  return `${sandboxWorkspaceRoot}/${normalized.replace(/^\/+/, "")}`;
}

function normalizeSandboxEnv(value: unknown): Record<string, string | undefined> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => /^[A-Z_][A-Z0-9_]*$/i.test(key))
    .slice(0, 50)
    .map(([key, envValue]) => [key, envValue == null ? undefined : String(envValue).slice(0, 4096)]);
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

function boundedText(value: unknown, max = 200000): string {
  return String(value ?? "").slice(0, max);
}

function summarizeSandboxExecResult(result: Record<string, unknown>): string {
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : "unknown";
  const duration = typeof result.duration === "number" ? ` in ${result.duration}ms` : "";
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const output = stdout || stderr;
  const preview = output ? ` Output: ${output.slice(0, 600)}` : "";
  return `Sandbox command finished with exit code ${exitCode}${duration}.${preview}`;
}

function sandboxMcpResponse(
  toolName: SandboxExecutorToolName,
  summary: string,
  result: Record<string, unknown>
): Record<string, unknown> {
  return {
    ok: true,
    server: "executor",
    transport: "same-worker-sandbox-rpc",
    tool: toolName,
    summary,
    content: [{ type: "text", text: summary }],
    result
  };
}

function sandboxMcpError(
  toolName: string,
  error: string,
  status = "failed"
): Record<string, unknown> {
  return {
    ok: false,
    server: "executor",
    transport: "same-worker-sandbox-rpc",
    tool: toolName,
    status,
    error,
    content: [{ type: "text", text: error }]
  };
}

async function callSandboxExecutorTool(
  env: RuntimeEnv,
  toolName: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  if (!sandboxBridgeAvailable(env)) {
    return sandboxMcpError(
      toolName,
      "Sandbox executor is not bound on this Worker. Deploy with the Sandbox container binding or configure OPEN_THINK_EXECUTOR_MCP_URL.",
      "unavailable"
    );
  }
  if (!sandboxExecutorToolCatalog.some((toolDef) => toolDef.name === toolName)) {
    return sandboxMcpError(toolName, `Unknown executor tool: ${toolName}`, "unknown-tool");
  }

  const sandbox = getExecutorSandbox(env, args);
  if (toolName === "sandbox_ping") {
    const ping = sandbox.ping ? await sandbox.ping() : "ok";
    return sandboxMcpResponse("sandbox_ping", `Sandbox ${normalizeSandboxId(args.sandboxId)} is reachable.`, { ping });
  }

  if (toolName === "sandbox_exec") {
    const command = String(args.command ?? "").trim();
    if (!command) return sandboxMcpError(toolName, "command is required.", "invalid-arguments");
    const timeout = boundedNumber(args.timeoutMs ?? args.timeout, 30000, 1000, 300000);
    const cwd = normalizeSandboxPath(args.cwd, sandboxWorkspaceRoot);
    const sandboxEnv = normalizeSandboxEnv(args.env);
    const result = await sandbox.exec(command, {
      cwd,
      timeout,
      ...(sandboxEnv ? { env: sandboxEnv } : {})
    });
    return sandboxMcpResponse("sandbox_exec", summarizeSandboxExecResult(result), {
      ...result,
      cwd,
      timeout
    });
  }

  if (toolName === "sandbox_diff") {
    return captureSandboxDiffArtifact(env, args, sandbox);
  }

  if (toolName === "sandbox_write_file") {
    const path = normalizeSandboxPath(args.path);
    const content = boundedText(args.content);
    const result = await sandbox.writeFile(path, content, { encoding: "utf-8" });
    return sandboxMcpResponse("sandbox_write_file", `Wrote ${content.length} characters to ${path}.`, {
      ...result,
      path,
      characters: content.length
    });
  }

  if (toolName === "sandbox_read_file") {
    const path = normalizeSandboxPath(args.path);
    const result = await sandbox.readFile(path, { encoding: "utf-8" });
    const content = boundedText(result.content, 100000);
    return sandboxMcpResponse("sandbox_read_file", `Read ${content.length} characters from ${path}.`, {
      ...result,
      path,
      content,
      truncated: String(result.content ?? "").length > content.length
    });
  }

  if (toolName === "sandbox_list_files") {
    const path = normalizeSandboxPath(args.path);
    const result = await sandbox.listFiles(path, {
      recursive: Boolean(args.recursive),
      limit: boundedNumber(args.limit, 200, 1, 1000)
    });
    return sandboxMcpResponse("sandbox_list_files", `Listed files under ${path}.`, {
      ...result,
      path
    });
  }

  return sandboxMcpError(toolName, `Unhandled executor tool: ${toolName}`, "unknown-tool");
}

async function captureSandboxDiffArtifact(
  env: RuntimeEnv,
  args: Record<string, unknown>,
  sandbox: SandboxExecutorApi
): Promise<Record<string, unknown>> {
  const timeout = boundedNumber(args.timeoutMs ?? args.timeout, 30000, 1000, 300000);
  const cwd = normalizeSandboxPath(args.cwd, sandboxWorkspaceRoot);
  const staged = Boolean(args.staged);
  const pathspecs = normalizeSandboxPathspecs(args.pathspec);
  const command = buildSandboxDiffCommand(staged, pathspecs);
  const result = await sandbox.exec(command, { cwd, timeout });
  const exitCode = typeof result.exitCode === "number" ? result.exitCode : 0;
  const stderr = String(result.stderr ?? "").trim();
  const patch = boundedText(result.stdout, 1_500_000);
  if (exitCode !== 0 && !patch.trim()) {
    return sandboxMcpError(
      "sandbox_diff",
      "Unable to capture Sandbox Git diff. " + (stderr || "git diff exited with code " + String(exitCode) + "."),
      "failed"
    );
  }

  const stats = summarizePatchText(patch);
  if (!patch.trim()) {
    return sandboxMcpResponse("sandbox_diff", "No Sandbox Git diff detected in " + cwd + ".", {
      cwd,
      staged,
      pathspecs,
      command,
      exitCode,
      stats,
      stored: false,
      patchPreview: ""
    });
  }

  const key = normalizeArtifactKey(args.artifactKey) || defaultSandboxDiffArtifactKey(cwd);
  if (env.AGENT_STORAGE) {
    await env.AGENT_STORAGE.put(key, patch, {
      httpMetadata: { contentType: contentTypeFromArtifactKey(key) },
      customMetadata: {
        source: "sandbox_diff",
        cwd,
        staged: String(staged),
        files: String(stats.files),
        additions: String(stats.additions),
        deletions: String(stats.deletions)
      }
    });
  }

  const fileList = stats.paths.length
    ? " across " + stats.paths.slice(0, 5).join(", ") + (stats.paths.length > 5 ? ", and " + String(stats.paths.length - 5) + " more" : "")
    : "";
  const storedText = env.AGENT_STORAGE ? " Stored artifact " + key + "." : " Bind AGENT_STORAGE to persist the patch as an artifact.";
  const summary =
    "Captured Sandbox Git diff: " +
    String(stats.files) +
    " file" +
    (stats.files === 1 ? "" : "s") +
    ", +" +
    String(stats.additions) +
    " / -" +
    String(stats.deletions) +
    fileList +
    "." +
    storedText;

  return sandboxMcpResponse("sandbox_diff", summary, {
    cwd,
    staged,
    pathspecs,
    command,
    exitCode,
    stats,
    stored: Boolean(env.AGENT_STORAGE),
    artifactKey: env.AGENT_STORAGE ? key : null,
    artifact: env.AGENT_STORAGE
      ? {
        key,
        title: artifactTitleFromKey(key),
        type: artifactTypeFromKey(key),
        contentType: contentTypeFromArtifactKey(key)
      }
      : null,
    patchCharacters: patch.length,
    patchPreview: patch.slice(0, 4000),
    truncated: String(result.stdout ?? "").length > patch.length,
    stderr
  });
}

function normalizeSandboxPathspecs(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const seen = new Set<string>();
  const pathspecs: string[] = [];
  for (const item of values) {
    const normalized = String(item ?? "")
      .trim()
      .replace(/\0/g, "")
      .replace(/^\/+/, "")
      .slice(0, 240);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    pathspecs.push(normalized);
    if (pathspecs.length >= 25) break;
  }
  return pathspecs;
}

function buildSandboxDiffCommand(staged: boolean, pathspecs: string[]): string {
  const args = ["git", "diff", "--no-ext-diff", "--binary"];
  if (staged) args.push("--cached");
  if (pathspecs.length) {
    args.push("--");
    args.push(...pathspecs.map(shellQuote));
  }
  return args.join(" ");
}

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

function summarizePatchText(patch: string): { files: number; additions: number; deletions: number; paths: string[] } {
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    const fileMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (fileMatch?.[2]) paths.add(fileMatch[2]);
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return {
    files: paths.size,
    additions,
    deletions,
    paths: [...paths]
  };
}

function defaultSandboxDiffArtifactKey(cwd: string): string {
  const workspace = cwd
    .replace(/^\/workspace\/?/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  return normalizeArtifactKey(
    "diffs/" + workspace + "/" + new Date().toISOString().replace(/[:.]/g, "-") + ".diff"
  );
}

async function handleMcpToolsRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  const url = new URL(request.url);
  const server = url.searchParams.get("server")?.trim() || "all";
  const startedAt = Date.now();
  if (server !== "all" && server !== "executor") {
    return observedMcpJson(env, {
      server,
      tool: "list_tools",
      transport: "http",
      status: "error",
      startedAt,
      summary: "Tool discovery is not directly listed for this server."
    }, {
      available: false,
      server,
      status: "not-directly-listed",
      note: "Only the first-party executor bridge exposes direct HTTP tool discovery from this package runtime. Chat MCP tools are still registered through the Agents SDK."
    });
  }

  const executor = {
    available: executorConfigured(env),
    configured: executorConfigured(env),
    status: executorStatus(env),
    transport: executorTransport(env),
    tools: sandboxExecutorToolCatalog
  };

  if (server === "executor") {
    return observedMcpJson(env, {
      server: "executor",
      tool: "list_tools",
      transport: executor.transport,
      status: "success",
      startedAt,
      summary: "Listed executor MCP tools."
    }, {
      server: "executor",
      ...executor,
      note: sandboxBridgeAvailable(env)
        ? "Executor tools are backed by the same-Worker Cloudflare Sandbox Durable Object over RPC."
        : "Executor tools will become callable after Sandbox is bound or an external executor MCP endpoint is configured."
    });
  }

  return observedMcpJson(env, {
    server: "all",
    tool: "list_tools",
    transport: "http",
    status: "success",
    startedAt,
    summary: "Listed MCP server catalog and executor tools."
  }, {
    available: executor.available,
    status: executor.status,
    servers: mcpServerCatalog(env),
    toolsByServer: {
      executor
    }
  });
}

async function handleMcpCallRequest(request: Request, env: RuntimeEnv): Promise<Response> {
  const startedAt = Date.now();
  if (request.method !== "POST") {
    return observedMcpJson(env, {
      server: "executor",
      tool: "call_tool",
      transport: executorTransport(env),
      status: "error",
      startedAt,
      summary: "Rejected non-POST MCP call request."
    }, { error: "POST required." }, { status: 405 });
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const server = String(body.server ?? "executor").trim();
  const name = String(body.name ?? "").trim();
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args)
    ? body.args as Record<string, unknown>
    : {};
  if (!name) {
    return observedMcpJson(env, {
      server,
      tool: "call_tool",
      transport: executorTransport(env),
      status: "error",
      startedAt,
      summary: "Rejected MCP call with no tool name."
    }, { ok: false, error: "Tool name is required." }, { status: 400 });
  }
  if (server !== "executor") {
    return observedMcpJson(env, {
      server,
      tool: name,
      transport: "agents-sdk-mcp",
      status: "error",
      startedAt,
      summary: "Direct MCP calls for non-executor servers are managed by the chat runtime."
    }, {
      ok: false,
      error: `Direct calls for MCP server '${server}' are managed by the Agents SDK chat runtime. Use /mcp/call with server='executor' for first-party Sandbox tools.`
    }, { status: 501 });
  }
  try {
    const result = await callSandboxExecutorTool(env, name, args);
    return observedMcpJson(env, {
      server,
      tool: name,
      transport: executorTransport(env),
      status: result.ok === false ? "error" : "success",
      startedAt,
      summary: typeof result.summary === "string" ? result.summary : result.ok === false ? "Executor tool returned an error." : "Executor tool completed."
    }, result, { status: result.ok === false ? 400 : 200 });
  } catch (error) {
    return observedMcpJson(env, {
      server,
      tool: name,
      transport: executorTransport(env),
      status: "error",
      startedAt,
      summary: error instanceof Error ? error.message : "Executor tool failed."
    }, sandboxMcpError(name, error instanceof Error ? error.message : "Executor tool failed."), { status: 500 });
  }
}

type McpObservationStatus = "success" | "error";
type McpObservationInput = {
  server: string;
  tool: string;
  transport: string;
  status: McpObservationStatus;
  startedAt?: number;
  latencyMs?: number;
  summary?: string;
};
type McpObservationEvent = {
  id: string;
  server: string;
  tool: string;
  transport: string;
  status: McpObservationStatus;
  latencyMs: number;
  summary: string;
  createdAt: string;
};

async function observedMcpTool<T>(
  env: RuntimeEnv,
  server: string,
  tool: string,
  transport: string,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    await recordMcpEvent(env, {
      server,
      tool,
      transport,
      status: "success",
      startedAt,
      summary: summarizeObservedMcpResult(result)
    });
    return result;
  } catch (error) {
    await recordMcpEvent(env, {
      server,
      tool,
      transport,
      status: "error",
      startedAt,
      summary: error instanceof Error ? error.message : "MCP tool failed."
    });
    throw error;
  }
}

async function observedMcpJson(
  env: RuntimeEnv,
  event: McpObservationInput,
  payload: Record<string, unknown>,
  init?: ResponseInit
): Promise<Response> {
  await recordMcpEvent(env, event);
  return Response.json(payload, init);
}

async function ensureMcpObservabilityTable(env: RuntimeEnv): Promise<boolean> {
  if (!env.DB) return false;
  await env.DB.prepare(
    "create table if not exists mcp_observability (id text primary key, server text not null, tool text not null, transport text not null, status text not null, latency_ms integer not null, summary text not null, created_at text not null)"
  ).run();
  return true;
}

async function recordMcpEvent(env: RuntimeEnv, event: McpObservationInput): Promise<void> {
  if (!(await ensureMcpObservabilityTable(env))) return;
  const createdAt = new Date().toISOString();
  const latencyMs = event.latencyMs ?? Math.max(0, Date.now() - (event.startedAt ?? Date.now()));
  await env.DB!.prepare(
    "insert into mcp_observability (id, server, tool, transport, status, latency_ms, summary, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    crypto.randomUUID(),
    compactText(event.server || "unknown", 120),
    compactText(event.tool || "unknown", 160),
    compactText(event.transport || "unknown", 120),
    event.status,
    Math.round(latencyMs),
    compactText(event.summary || "", 1000),
    createdAt
  ).run().catch(() => undefined);
}

async function mcpObservabilityState(
  env: RuntimeEnv,
  options: { includeSeries?: boolean } = {}
): Promise<Record<string, unknown>> {
  if (!(await ensureMcpObservabilityTable(env))) {
    return {
      available: false,
      status: "preview",
      note: "Bind D1 to persist MCP and executor call observability.",
      servers: mcpServerCatalog(env).map((server) => ({ ...server, calls: 0, failures: 0 })),
      recentEvents: []
    };
  }
  const rows = await env.DB!.prepare(
    "select * from mcp_observability order by datetime(created_at) desc limit 100"
  ).all<Record<string, unknown>>();
  const events = (rows.results ?? []).map(rowToMcpObservationEvent);
  const byServer = new Map<string, { calls: number; failures: number; totalLatencyMs: number; lastEvent: McpObservationEvent | null }>();
  for (const event of events) {
    const current = byServer.get(event.server) ?? { calls: 0, failures: 0, totalLatencyMs: 0, lastEvent: null };
    current.calls += 1;
    current.failures += event.status === "error" ? 1 : 0;
    current.totalLatencyMs += event.latencyMs;
    current.lastEvent ??= event;
    byServer.set(event.server, current);
  }
  const servers = mcpServerCatalog(env).map((server) => {
    const name = String(server.name ?? "unknown");
    const metrics = byServer.get(name) ?? { calls: 0, failures: 0, totalLatencyMs: 0, lastEvent: null };
    return {
      ...server,
      calls: metrics.calls,
      failures: metrics.failures,
      avgLatencyMs: metrics.calls ? Math.round(metrics.totalLatencyMs / metrics.calls) : 0,
      lastEvent: metrics.lastEvent
    };
  });
  return {
    available: true,
    status: "tracked",
    totals: {
      calls: events.length,
      failures: events.filter((event) => event.status === "error").length,
      servers: servers.length
    },
    servers,
    recentEvents: events.slice(0, 25),
    ...(options.includeSeries ? { series: mcpObservabilitySeries(events) } : {})
  };
}

function mcpObservabilitySeries(events: McpObservationEvent[]): Array<Record<string, unknown>> {
  const buckets = new Map<string, { timestamp: string; server: string; calls: number; failures: number; totalLatencyMs: number }>();
  for (const event of events) {
    const timestamp = event.createdAt.slice(0, 16) + ":00Z";
    const key = timestamp + "|" + event.server;
    const bucket = buckets.get(key) ?? {
      timestamp,
      server: event.server,
      calls: 0,
      failures: 0,
      totalLatencyMs: 0
    };
    bucket.calls += 1;
    bucket.failures += event.status === "error" ? 1 : 0;
    bucket.totalLatencyMs += event.latencyMs;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.server.localeCompare(right.server))
    .map((bucket) => ({
      timestamp: bucket.timestamp,
      server: bucket.server,
      calls: bucket.calls,
      failures: bucket.failures,
      avgLatencyMs: bucket.calls ? Math.round(bucket.totalLatencyMs / bucket.calls) : 0
    }));
}

function rowToMcpObservationEvent(row: Record<string, unknown>): McpObservationEvent {
  return {
    id: String(row.id ?? ""),
    server: String(row.server ?? "unknown"),
    tool: String(row.tool ?? "unknown"),
    transport: String(row.transport ?? "unknown"),
    status: String(row.status ?? "success") === "error" ? "error" : "success",
    latencyMs: Number(row.latency_ms ?? 0),
    summary: String(row.summary ?? ""),
    createdAt: String(row.created_at ?? "")
  };
}

function summarizeObservedMcpResult(result: unknown): string {
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const text = content
        .map((item) => item && typeof item === "object" && "text" in item ? String((item as { text?: unknown }).text ?? "") : "")
        .filter(Boolean)
        .join(" ");
      if (text) return compactText(text, 500);
    }
  }
  if (result && typeof result === "object" && "summary" in result) {
    return compactText(String((result as { summary?: unknown }).summary ?? ""), 500);
  }
  return "MCP tool completed.";
}

function executorCapabilityState(env: RuntimeEnv): Record<string, unknown> {
  const url = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  const configured = executorConfigured(env);
  return {
    enabled: true,
    configured,
    status: executorStatus(env),
    transport: executorTransport(env),
    mcpServerUrl: url ? "configured" : sandboxBridgeAvailable(env) ? "/mcp/call?server=executor" : null,
    authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN),
    defaultTarget:
      "Same-account Cloudflare Sandbox/Containers MCP bridge, or a self-hosted Executor HTTPS MCP endpoint.",
    cloudEndpoint: "https://executor.sh/mcp",
    auth:
      "executor.sh requires a WorkOS bearer JWT with account and organization claims; self-hosted endpoints may use OPEN_THINK_EXECUTOR_AUTH_TOKEN.",
    recommendedFor: [
      "code execution",
      "filesystem work",
      "browser automation",
      "OpenAPI tool execution",
      "subprocesses",
      "long-running workflow workers"
    ],
    tools: {
      list: "/mcp/tools?server=executor",
      call: "/mcp/call"
    },
    availableTools: sandboxBridgeAvailable(env) ? sandboxExecutorToolCatalog : []
  };
}

function mcpServerCatalog(env: RuntimeEnv): Array<Record<string, unknown>> {
  return [
    {
      name: "cloudflare-docs",
      url: docsMcpServerUrl,
      configured: true,
      transport: "streamable-http"
    },
    {
      name: "cloudflare-api",
      url: cloudflareApiMcpUrl(env),
      configured: Boolean(env.OPEN_THINK_CF_API_TOKEN),
      transport: "streamable-http",
      codeMode: codeModeEnabled(env) ? "search_and_execute" : "disabled"
    },
    {
      name: "workspace-orchestrator",
      url: "durable-object://OpenThinkWorkspaceMcp",
      configured: Boolean(env.WORKSPACE_MCP),
      status: env.WORKSPACE_MCP ? "rpc-ready" : "binding-missing",
      transport: "durable-object-rpc",
      tools: ["workspace_status", "coordinate_workspace", "record_workspace_context", "send_subagent_message"]
    },
    {
      name: "executor",
      url: sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL) ?? (sandboxBridgeAvailable(env) ? "/mcp/call?server=executor" : "OPEN_THINK_EXECUTOR_MCP_URL"),
      configured: executorConfigured(env),
      status: executorStatus(env),
      transport: executorTransport(env),
      authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN)
    }
  ];
}

const artifactVersionPrefix = "__versions__/";

function artifactTypeFromKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.endsWith(".browser.json") || normalized.endsWith(".browser-session.json")) return "browser-session";
  if (normalized.endsWith(".diff") || normalized.endsWith(".patch")) return "diff";
  if (normalized.endsWith(".md") || normalized.endsWith(".txt")) return "document";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "webpage";
  if (normalized.endsWith(".json") || normalized.endsWith(".csv")) return "table";
  if (normalized.endsWith(".png") || normalized.endsWith(".jpg") || normalized.endsWith(".jpeg") || normalized.endsWith(".webp")) return "image";
  if (normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx") || normalized.endsWith(".py")) return "code";
  return "file";
}

function artifactTitleFromKey(key: string): string {
  const name = key.split("/").filter(Boolean).pop() || key;
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

function artifactVersionKey(key: string): string {
  const safeKey = encodeURIComponent(key);
  return artifactVersionPrefix + safeKey + "/" + new Date().toISOString().replace(/[:.]/g, "-") + "-" + artifactTitleFromKey(key);
}

function normalizeArtifactVersionKey(value: unknown, currentKey: string): string | null {
  const versionKey = String(value ?? "").trim();
  if (!versionKey) return null;
  const prefix = artifactVersionPrefix + encodeURIComponent(currentKey) + "/";
  return versionKey.startsWith(prefix) ? versionKey : null;
}

function artifactVersionCounts(objects: R2ObjectLike[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const object of objects) {
    if (!object.key.startsWith(artifactVersionPrefix)) continue;
    const [, encodedKey] = object.key.split("/");
    if (!encodedKey) continue;
    const key = decodeURIComponent(encodedKey);
    counts.set(key, (counts.get(key) ?? 1) + 1);
  }
  return counts;
}

async function artifactVersions(env: RuntimeEnv, key: string): Promise<Array<Record<string, unknown>>> {
  if (!env.AGENT_STORAGE) return [];
  const prefix = artifactVersionPrefix + encodeURIComponent(key) + "/";
  const list = await env.AGENT_STORAGE.list({ prefix, limit: 25 });
  return [
    { key, versionKey: key, label: "Current", current: true },
    ...(list.objects ?? []).map((object, index) => ({
      key,
      versionKey: object.key,
      label: "Revision " + String(index + 1),
      uploaded: object.uploaded ? String(object.uploaded) : null,
      size: object.size ?? null
    }))
  ];
}

function contentTypeFromArtifactKey(key: string): string {
  const normalized = key.toLowerCase();
  if (normalized.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) return "text/html; charset=utf-8";
  if (normalized.endsWith(".json")) return "application/json; charset=utf-8";
  if (normalized.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (normalized.endsWith(".diff") || normalized.endsWith(".patch")) return "text/x-diff; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function normalizeArtifactKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^[/]+/, "")
    .replace(/[.][.]+/g, ".")
    .replace(/[^a-zA-Z0-9/_.,=+@-]+/g, "-")
    .slice(0, 240);
}

type ContributionChange = {
  path: string;
  content: string;
  delete?: boolean;
};

function contributionCapabilityState(env: RuntimeEnv): Record<string, unknown> {
  return {
    available: Boolean(env.OPEN_THINK_GITHUB_TOKEN),
    endpoint: "/contributions",
    repository: githubRepository(env),
    baseBranch: githubBranch(env),
    tokenConfigured: Boolean(env.OPEN_THINK_GITHUB_TOKEN),
    artifactSourceAvailable: Boolean(env.AGENT_STORAGE),
    sandboxSourceAvailable: sandboxBridgeAvailable(env),
    mode: "github-pull-request",
    note: env.OPEN_THINK_GITHUB_TOKEN
      ? "POST title, body, changes, or artifactKeys to open a pull request against the configured upstream."
      : "Configure OPEN_THINK_GITHUB_TOKEN to let the agent open owner-approved upstream pull requests."
  };
}

async function contributionChangesFromPayload(
  payload: Record<string, unknown>,
  env: RuntimeEnv,
  source: {
    repository: string;
    baseBranch: string;
  }
): Promise<ContributionChange[]> {
  const changes: ContributionChange[] = [];
  if (Array.isArray(payload.changes)) {
    for (const item of payload.changes) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const path = normalizeContributionPath(record.path);
      const content = normalizeLongText(record.content ?? record.text, "");
      if (path && content) changes.push({ path, content });
    }
  }

  const artifactKeys = normalizeStringArray(payload.artifactKeys);
  for (const keyValue of artifactKeys) {
    const key = normalizeArtifactKey(keyValue);
    if (!key || !env.AGENT_STORAGE) continue;
    const object = await env.AGENT_STORAGE.get(key);
    if (!object) continue;
    const content = await object.text();
    if (artifactTypeFromKey(key) === "diff") {
      changes.push(...await contributionChangesFromPatch(env, source.repository, source.baseBranch, content));
      continue;
    }
    changes.push({
      path: normalizeContributionPath(key) || key,
      content
    });
  }

  const diffArtifactKeys = [
    ...normalizeStringArray(payload.diffArtifactKeys),
    ...normalizeStringArray(payload.patchArtifactKeys)
  ];
  for (const keyValue of diffArtifactKeys) {
    const key = normalizeArtifactKey(keyValue);
    if (!key || !env.AGENT_STORAGE) continue;
    const object = await env.AGENT_STORAGE.get(key);
    if (!object) continue;
    changes.push(...await contributionChangesFromPatch(env, source.repository, source.baseBranch, await object.text()));
  }

  return changes.slice(0, 20);
}

type ParsedPatchFile = {
  oldPath: string;
  newPath: string;
  isNew: boolean;
  isDeleted: boolean;
  hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    lines: string[];
  }>;
};

async function contributionChangesFromPatch(
  env: RuntimeEnv,
  repository: string,
  baseBranch: string,
  patch: string
): Promise<ContributionChange[]> {
  const files = parseUnifiedPatch(patch).filter((file) => file.newPath && file.oldPath);
  if (files.length === 0 && patch.trim()) {
    throw new Error("Patch artifact did not contain supported unified diff file changes.");
  }
  const changes: ContributionChange[] = [];
  for (const file of files.slice(0, 20)) {
    const path = normalizeContributionPath(file.isDeleted ? file.oldPath : file.newPath);
    if (!path) continue;
    if (file.isDeleted) {
      changes.push({ path, content: "", delete: true });
      continue;
    }
    const baseContent = file.isNew
      ? ""
      : await readGithubFileText(env, repository, baseBranch, normalizeContributionPath(file.oldPath));
    changes.push({
      path,
      content: applyUnifiedPatchToText(baseContent, file)
    });
  }
  return changes;
}

function parseUnifiedPatch(patch: string): ParsedPatchFile[] {
  const files: ParsedPatchFile[] = [];
  let current: ParsedPatchFile | null = null;
  let currentHunk: ParsedPatchFile["hunks"][number] | null = null;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      throw new Error("Binary patches are not supported by the GitHub contribution lane yet.");
    }
    const diffMatch = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (diffMatch) {
      current = {
        oldPath: diffMatch[1] ?? "",
        newPath: diffMatch[2] ?? "",
        isNew: false,
        isDeleted: false,
        hunks: []
      };
      files.push(current);
      currentHunk = null;
      continue;
    }
    if (!current) continue;
    if (line === "new file mode" || line.startsWith("new file mode ")) current.isNew = true;
    if (line === "deleted file mode" || line.startsWith("deleted file mode ")) current.isDeleted = true;
    if (line.startsWith("--- ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") current.isNew = true;
      else if (path.startsWith("a/")) current.oldPath = path.slice(2);
      continue;
    }
    if (line.startsWith("+++ ")) {
      const path = line.slice(4).trim();
      if (path === "/dev/null") current.isDeleted = true;
      else if (path.startsWith("b/")) current.newPath = path.slice(2);
      continue;
    }
    const hunkMatch = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunkMatch) {
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        oldCount: Number(hunkMatch[2] ?? 1),
        newStart: Number(hunkMatch[3]),
        newCount: Number(hunkMatch[4] ?? 1),
        lines: []
      };
      current.hunks.push(currentHunk);
      continue;
    }
    if (currentHunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\"))) {
      currentHunk.lines.push(line);
    }
  }
  return files;
}

async function readGithubFileText(
  env: RuntimeEnv,
  repository: string,
  baseBranch: string,
  path: string
): Promise<string> {
  const file = await githubRequest(
    env,
    repository,
    "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(baseBranch),
    { allowNotFound: true }
  );
  const encoded = typeof file.content === "string" ? file.content : "";
  return encoded ? base64DecodeUtf8(encoded.replace(/\s+/g, "")) : "";
}

function applyUnifiedPatchToText(baseContent: string, patchFile: ParsedPatchFile): string {
  const baseLines = splitPatchTextLines(baseContent);
  const output: string[] = [];
  let cursor = 0;
  for (const hunk of patchFile.hunks) {
    const hunkStart = Math.max(0, hunk.oldStart - 1);
    output.push(...baseLines.slice(cursor, hunkStart));
    cursor = hunkStart;
    for (const line of hunk.lines) {
      if (line.startsWith("\\")) continue;
      const kind = line[0];
      const value = line.slice(1);
      if (kind === " ") {
        output.push(baseLines[cursor] ?? value);
        cursor += 1;
      } else if (kind === "-") {
        cursor += 1;
      } else if (kind === "+") {
        output.push(value);
      }
    }
  }
  output.push(...baseLines.slice(cursor));
  const text = output.join("\n");
  return baseContent.endsWith("\n") || patchFile.isNew ? text + "\n" : text;
}

function splitPatchTextLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

async function createGithubContributionPullRequest(
  env: RuntimeEnv,
  input: {
    repository: string;
    baseBranch: string;
    branchName: string;
    title: string;
    body: string;
    changes: ContributionChange[];
  }
): Promise<Record<string, unknown>> {
  const baseRef = await githubRequest(env, input.repository, "/git/ref/heads/" + encodeURIComponent(input.baseBranch));
  const baseSha = String((baseRef.object as { sha?: unknown } | undefined)?.sha ?? "");
  if (!baseSha) throw new Error("GitHub base branch did not return a commit SHA.");

  await githubRequest(env, input.repository, "/git/refs", {
    method: "POST",
    body: JSON.stringify({
      ref: "refs/heads/" + input.branchName,
      sha: baseSha
    })
  });

  for (const change of input.changes) {
    const currentFile = await githubRequest(
      env,
      input.repository,
      "/contents/" + change.path.split("/").map(encodeURIComponent).join("/") + "?ref=" + encodeURIComponent(input.baseBranch),
      { allowNotFound: true }
    );
    const currentSha = currentFile && typeof currentFile === "object"
      ? String((currentFile as { sha?: unknown }).sha ?? "")
      : "";
    if (change.delete) {
      if (!currentSha) continue;
      await githubRequest(
        env,
        input.repository,
        "/contents/" + change.path.split("/").map(encodeURIComponent).join("/"),
        {
          method: "DELETE",
          body: JSON.stringify({
            message: "OpenThink agent contribution: " + input.title,
            sha: currentSha,
            branch: input.branchName
          })
        }
      );
      continue;
    }
    const body: Record<string, unknown> = {
      message: "OpenThink agent contribution: " + input.title,
      content: base64EncodeUtf8(change.content),
      branch: input.branchName
    };
    if (currentSha) body.sha = currentSha;
    await githubRequest(
      env,
      input.repository,
      "/contents/" + change.path.split("/").map(encodeURIComponent).join("/"),
      {
        method: "PUT",
        body: JSON.stringify(body)
      }
    );
  }

  return githubRequest(env, input.repository, "/pulls", {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      head: input.branchName,
      base: input.baseBranch,
      body: input.body
    })
  });
}

async function githubRequest(
  env: RuntimeEnv,
  repository: string,
  path: string,
  init: RequestInit & { allowNotFound?: boolean } = {}
): Promise<Record<string, unknown>> {
  const token = env.OPEN_THINK_GITHUB_TOKEN;
  if (!token) throw new Error("OPEN_THINK_GITHUB_TOKEN is not configured.");
  const response = await fetch("https://api.github.com/repos/" + repository + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "User-Agent": "open-think-agent",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {})
    }
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (init.allowNotFound && response.status === 404) return {};
  if (!response.ok) {
    throw new Error(String(body.message ?? "GitHub API failed with " + response.status));
  }
  return body;
}

async function recordContributionPullRequest(
  env: RuntimeEnv,
  input: {
    id: string;
    title: string;
    branchName: string;
    url: unknown;
    status: string;
    createdAt: string;
  }
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "create table if not exists contribution_pull_requests (id text primary key, title text not null, branch_name text not null, url text not null, status text not null, created_at text not null)"
  ).run();
  await env.DB.prepare(
    "insert into contribution_pull_requests (id, title, branch_name, url, status, created_at) values (?, ?, ?, ?, ?, ?)"
  ).bind(
    input.id,
    input.title,
    input.branchName,
    String(input.url ?? ""),
    input.status,
    input.createdAt
  ).run().catch(() => undefined);
}

function githubRepository(env: RuntimeEnv): string {
  const value = String(env.OPEN_THINK_UPDATE_REPOSITORY ?? defaultUpdateRepository).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? value : defaultUpdateRepository;
}

function githubBranch(env: RuntimeEnv): string {
  return normalizeGithubBranch(env.OPEN_THINK_UPDATE_BRANCH, "main");
}

function normalizeGithubBranch(value: unknown, fallback: string): string {
  const branch = String(value ?? "").trim().replace(/^refs\/heads\//, "");
  if (!branch || branch.includes("..") || branch.startsWith("/") || branch.endsWith("/")) return fallback;
  return branch.replace(/[^A-Za-z0-9/_.,=+@-]+/g, "-").slice(0, 120);
}

function normalizeContributionPath(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/^[/]+/, "")
    .replace(/[.][.]+/g, ".")
    .replace(/[^a-zA-Z0-9/_.,=+@ -]+/g, "-")
    .slice(0, 240);
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "change";
}

function base64EncodeUtf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.slice(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64DecodeUtf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

async function captureBrowserSnapshotArtifact(
  env: RuntimeEnv,
  input: {
    url?: string | undefined;
    html?: string | undefined;
    artifactKey?: string | undefined;
    viewport?: {
      width?: number | undefined;
      height?: number | undefined;
      deviceScaleFactor?: number | undefined;
    } | undefined;
    fullPage?: boolean | undefined;
    waitUntil?: string | undefined;
  }
): Promise<Record<string, unknown>> {
  const accountId = String(env.OPEN_THINK_CF_ACCOUNT_ID ?? "").trim();
  const apiToken = String(env.OPEN_THINK_CF_API_TOKEN ?? "").trim();
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const html = typeof input.html === "string" ? input.html.trim() : "";
  if (!url && !html) {
    return {
      ok: false,
      status: "missing-target",
      error: "Provide url or html for browser_snapshot."
    };
  }
  if (!accountId || !apiToken) {
    return {
      ok: false,
      status: "missing-configuration",
      error: "OPEN_THINK_CF_ACCOUNT_ID and OPEN_THINK_CF_API_TOKEN are required for Cloudflare Browser Rendering snapshots.",
      requiredPermission: "Browser Rendering Edit",
      docs: "https://developers.cloudflare.com/browser-rendering/rest-api/snapshot/"
    };
  }

  const requestBody: Record<string, unknown> = url ? { url } : { html };
  const viewport = normalizeBrowserViewport(input.viewport);
  if (viewport) requestBody.viewport = viewport;
  requestBody.screenshotOptions = { fullPage: input.fullPage !== false };
  if (input.waitUntil) {
    requestBody.gotoOptions = { waitUntil: input.waitUntil, timeout: 30_000 };
  }

  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) + "/browser-rendering/snapshot",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const result = (body.result && typeof body.result === "object" ? body.result : body) as Record<string, unknown>;
  if (!response.ok || body.success === false) {
    const errors = Array.isArray(body.errors) ? body.errors : undefined;
    return {
      ok: false,
      status: "browser-rendering-failed",
      error: String((errors?.[0] as { message?: unknown } | undefined)?.message ?? body.message ?? "Browser Rendering snapshot failed."),
      cloudflareStatus: response.status,
      requiredPermission: "Browser Rendering Edit"
    };
  }

  const capturedAt = new Date().toISOString();
  const screenshot = typeof result.screenshot === "string" ? result.screenshot : "";
  const content = typeof result.content === "string" ? result.content : html;
  const artifact = {
    kind: "browser-session",
    mode: "snapshot",
    status: "captured",
    url: url || null,
    title: url ? browserArtifactTitle(url) : "HTML snapshot",
    capturedAt,
    screenshotDataUrl: screenshot ? "data:image/png;base64," + screenshot : null,
    html: content,
    events: [
      { label: "Snapshot requested", status: "complete", at: capturedAt },
      { label: screenshot ? "Screenshot captured" : "Screenshot unavailable", status: screenshot ? "complete" : "skipped", at: capturedAt },
      { label: content ? "Rendered HTML captured" : "Rendered HTML unavailable", status: content ? "complete" : "skipped", at: capturedAt }
    ],
    source: "cloudflare-browser-rendering",
    docs: "https://developers.cloudflare.com/browser-rendering/rest-api/snapshot/"
  };
  const key = normalizeArtifactKey(input.artifactKey) || defaultBrowserSnapshotArtifactKey(url || "html", capturedAt);

  if (env.AGENT_STORAGE) {
    await env.AGENT_STORAGE.put(key, JSON.stringify(artifact, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
  }

  return {
    ok: true,
    status: "captured",
    artifactKey: key,
    stored: Boolean(env.AGENT_STORAGE),
    url: url || null,
    screenshot: Boolean(screenshot),
    htmlCharacters: content.length,
    summary: "Captured Browser Rendering snapshot" + (env.AGENT_STORAGE ? " and stored browser-session artifact." : ". Bind AGENT_STORAGE to persist it."),
    artifact: env.AGENT_STORAGE ? undefined : artifact
  };
}

type BrowserDiagnosticsInput = {
  live?: boolean | undefined;
  url?: string | undefined;
  keepAliveMs?: number | undefined;
  quality?: number | undefined;
};

async function handleBrowserDiagnosticsRequest(
  request: Request,
  env: RuntimeEnv
): Promise<Response> {
  if (request.method === "GET") {
    const result = await browserDiagnostics(env, { live: false });
    return Response.json(result, { status: browserDiagnosticHttpStatus(result) });
  }
  if (request.method === "POST") {
    const payload = await request.json().catch(() => ({})) as BrowserDiagnosticsInput;
    const result = await browserDiagnostics(env, { ...payload, live: true });
    return Response.json(result, { status: browserDiagnosticHttpStatus(result) });
  }
  return Response.json({ error: "Method not allowed" }, { status: 405 });
}

async function browserDiagnostics(
  env: RuntimeEnv,
  input: BrowserDiagnosticsInput
): Promise<Record<string, unknown>> {
  const live = input.live === true;
  const stages: Array<Record<string, unknown>> = [];
  const config = browserRenderingConfig(env);
  const base = {
    mode: live ? "live" : "read-only",
    stages,
    accountIdConfigured: Boolean(String(env.OPEN_THINK_CF_ACCOUNT_ID ?? "").trim()),
    tokenConfigured: Boolean(String(env.OPEN_THINK_CF_API_TOKEN ?? "").trim()),
    requiredPermission: "Browser Rendering Edit",
    docs: "https://developers.cloudflare.com/browser-run/cdp/session-management/"
  };

  if (!config.ok) {
    stages.push(browserDiagnosticStage(
      "configuration",
      "Cloudflare Browser Rendering credentials",
      "error",
      "Missing Browser Run credentials.",
      config.error
    ));
    stages.push(browserDiagnosticStage(
      "api",
      "Browser Run API reachability",
      "skipped",
      "Skipped because the Worker is missing required Browser Run configuration."
    ));
    return {
      ...base,
      ok: false,
      status: "missing-configuration",
      summary: "Browser Run is not configured. Set OPEN_THINK_CF_ACCOUNT_ID and OPEN_THINK_CF_API_TOKEN with Browser Rendering Edit permission.",
      error: config.error
    };
  }

  stages.push(browserDiagnosticStage(
    "configuration",
    "Cloudflare Browser Rendering credentials",
    "complete",
    "Account ID and API token are present."
  ));

  const listCall = await callBrowserRunApi(config, "/browser-rendering/devtools/session?limit=1&offset=0", { method: "GET" });
  if (!listCall.ok) {
    stages.push(browserDiagnosticStage(
      "api",
      "Browser Run API reachability",
      "error",
      "Cloudflare rejected the Browser Run API check.",
      listCall.error
    ));
    return {
      ...base,
      ok: false,
      status: "api-unavailable",
      summary: "Browser Run credentials are present, but the Cloudflare API check failed.",
      error: listCall.error,
      cloudflareStatus: listCall.cloudflareStatus,
      cloudflare: listCall.body
    };
  }

  stages.push(browserDiagnosticStage(
    "api",
    "Browser Run API reachability",
    "complete",
    "Cloudflare Browser Run API accepted a session-list request."
  ));

  if (!live) {
    stages.push(browserDiagnosticStage(
      "live-session",
      "Live frame self-test",
      "skipped",
      "Use the live check to create a short-lived session, verify CDP frame capture, and clean it up."
    ));
    return {
      ...base,
      ok: true,
      status: "configured",
      summary: "Browser Run is configured. Run the live check to verify session creation and frame streaming."
    };
  }

  const keepAliveMs = normalizeKeepAliveMs(input.keepAliveMs ?? 60_000);
  const quality = boundedNumber(input.quality, 68, 30, 90);
  const targetUrl = sanitizeHttpsUrl(input.url) ?? "https://developers.cloudflare.com/browser-run/";
  let sessionId = "";
  let targetId = "";
  let hasWebSocketDebuggerUrl = false;
  let frameCaptured = false;
  let frameBytes = 0;
  let status = "live-check-failed";
  let summary = "Browser Run live check did not complete.";
  let error: string | undefined;

  try {
    const params = new URLSearchParams({
      keep_alive: String(keepAliveMs),
      targets: "true",
      recording: "false"
    });
    const createCall = await callBrowserRunApi(config, "/browser-rendering/devtools/browser?" + params.toString(), { method: "POST" });
    if (!createCall.ok) {
      stages.push(browserDiagnosticStage(
        "session",
        "Create short-lived Browser Run session",
        "error",
        "Cloudflare could not create a Browser Run session.",
        createCall.error
      ));
      status = "browser-rendering-failed";
      summary = "Browser Run API is reachable, but session creation failed.";
      error = createCall.error;
    } else {
      const session = normalizeBrowserSession(createCall.result);
      sessionId = normalizeBrowserId(session.sessionId);
      stages.push(browserDiagnosticStage(
        "session",
        "Create short-lived Browser Run session",
        sessionId ? "complete" : "error",
        sessionId ? "Created temporary Browser Run session " + sessionId + "." : "Cloudflare did not return a sessionId."
      ));

      if (sessionId) {
        const targetResult = await browserCreateTarget(config, sessionId, targetUrl);
        const target = isBrowserRecord(targetResult.target) ? targetResult.target : undefined;
        targetId = normalizeBrowserId(target?.id);
        stages.push(browserDiagnosticStage(
          "target",
          "Open diagnostic target",
          targetResult.ok && targetId ? "complete" : "error",
          targetResult.ok && targetId
            ? "Opened " + targetUrl + " as target " + targetId + "."
            : "Could not open a diagnostic target.",
          targetResult.ok ? undefined : String(targetResult.error ?? "Target creation failed.")
        ));

        const webSocketUrl = typeof target?.webSocketDebuggerUrl === "string" ? target.webSocketDebuggerUrl : "";
        hasWebSocketDebuggerUrl = Boolean(webSocketUrl);
        stages.push(browserDiagnosticStage(
          "cdp-url",
          "CDP websocket URL",
          webSocketUrl ? "complete" : "error",
          webSocketUrl
            ? "Target exposes a CDP websocket URL for frame streaming."
            : "Target did not expose a CDP websocket URL."
        ));

        if (webSocketUrl) {
          const cdp = await connectBrowserCdp(webSocketUrl);
          try {
            stages.push(browserDiagnosticStage(
              "cdp-connect",
              "Connect to CDP",
              "complete",
              "Worker opened an internal CDP websocket connection."
            ));
            const frame = await cdp.send("Page.captureScreenshot", {
              format: "jpeg",
              quality,
              fromSurface: true,
              captureBeyondViewport: false
            });
            const data = typeof frame.data === "string" ? frame.data : "";
            frameCaptured = data.length > 0;
            frameBytes = data ? browserBase64ByteLength(data) : 0;
            stages.push(browserDiagnosticStage(
              "frame",
              "Capture viewport frame",
              frameCaptured ? "complete" : "error",
              frameCaptured
                ? "Captured one viewport frame for the in-app Browser Run stream."
                : "CDP connected but did not return screenshot data."
            ));
          } finally {
            cdp.close();
          }
        }

        if (frameCaptured) {
          status = "live-ready";
          summary = "Browser Run live check passed: session creation, target creation, CDP websocket, and frame capture all worked.";
        } else if (!hasWebSocketDebuggerUrl) {
          status = "missing-websocket";
          summary = "Browser Run session and target were created, but Cloudflare did not expose a CDP websocket URL.";
        } else {
          status = "live-check-failed";
          summary = "Browser Run CDP connection succeeded, but frame capture did not complete.";
        }
      }
    }
  } catch (diagnosticError) {
    error = diagnosticError instanceof Error ? diagnosticError.message : "Browser Run live check failed.";
    stages.push(browserDiagnosticStage(
      "live-check",
      "Run live frame self-test",
      "error",
      "Browser Run live check threw before completion.",
      error
    ));
  } finally {
    if (sessionId) {
      const cleanupCall = await callBrowserRunApi(
        config,
        "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId),
        { method: "DELETE" }
      );
      stages.push(browserDiagnosticStage(
        "cleanup",
        "Close diagnostic session",
        cleanupCall.ok ? "complete" : "warning",
        cleanupCall.ok
          ? "Closed temporary Browser Run session."
          : "Could not confirm cleanup of temporary Browser Run session.",
        cleanupCall.ok ? undefined : cleanupCall.error
      ));
    } else {
      stages.push(browserDiagnosticStage(
        "cleanup",
        "Close diagnostic session",
        "skipped",
        "No Browser Run session was created."
      ));
    }
  }

  return {
    ...base,
    ok: status === "live-ready",
    status,
    summary,
    sessionId: sessionId || undefined,
    targetId: targetId || undefined,
    hasWebSocketDebuggerUrl,
    frameCaptured,
    frameBytes,
    error
  };
}

function browserDiagnosticStage(
  id: string,
  label: string,
  status: "complete" | "warning" | "error" | "skipped",
  summary: string,
  detail?: string
): Record<string, unknown> {
  return {
    id,
    label,
    status,
    summary,
    ...(detail ? { detail } : {}),
    at: new Date().toISOString()
  };
}

function browserDiagnosticHttpStatus(result: Record<string, unknown>): number {
  if (result.ok === true) return 200;
  if (result.status === "missing-configuration") return 503;
  if (result.status === "api-unavailable" && typeof result.cloudflareStatus === "number") {
    return result.cloudflareStatus as number;
  }
  return 500;
}

function browserBase64ByteLength(value: string): number {
  const normalized = value.replace(/\s/g, "");
  if (!normalized) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
}

type BrowserSessionAction =
  | "list"
  | "create"
  | "get"
  | "close"
  | "listTargets"
  | "createTarget"
  | "getTarget"
  | "closeTarget";

type BrowserSessionRoute =
  | { kind: "sessions" }
  | { kind: "session"; sessionId: string }
  | { kind: "targets"; sessionId: string }
  | { kind: "target"; sessionId: string; targetId: string }
  | { kind: "frameStatus"; sessionId: string; targetId: string }
  | { kind: "frames"; sessionId: string; targetId: string };

type BrowserSessionOperationInput = {
  action?: BrowserSessionAction | undefined;
  sessionId?: string | undefined;
  targetId?: string | undefined;
  url?: string | undefined;
  keepAliveMs?: number | undefined;
  targets?: boolean | undefined;
  artifactKey?: string | undefined;
  recording?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

function parseBrowserSessionRoute(pathname: string): BrowserSessionRoute | null {
  const marker = "/browser/sessions";
  const index = pathname.lastIndexOf(marker);
  if (index < 0) return null;
  const suffix = pathname.slice(index + marker.length);
  if (suffix && !suffix.startsWith("/")) return null;
  const parts = suffix
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  if (parts.length === 0) return { kind: "sessions" };
  const sessionId = parts[0];
  if (!sessionId) return null;
  if (parts.length === 1) return { kind: "session", sessionId };
  if (parts.length === 2 && parts[1] === "targets") return { kind: "targets", sessionId };
  const targetId = parts[2];
  if (parts.length === 3 && parts[1] === "targets" && targetId) return { kind: "target", sessionId, targetId };
  if (parts.length === 5 && parts[1] === "targets" && targetId && parts[3] === "frames" && parts[4] === "status") {
    return { kind: "frameStatus", sessionId, targetId };
  }
  if (parts.length === 4 && parts[1] === "targets" && targetId && parts[3] === "frames") {
    return { kind: "frames", sessionId, targetId };
  }
  return null;
}

async function handleBrowserSessionsRequest(
  request: Request,
  env: RuntimeEnv,
  route: BrowserSessionRoute
): Promise<Response> {
  const url = new URL(request.url);
  let input: BrowserSessionOperationInput;

  if (route.kind === "sessions") {
    if (request.method === "GET") {
      input = {
        action: "list",
        limit: Number(url.searchParams.get("limit") ?? 20),
        offset: Number(url.searchParams.get("offset") ?? 0)
      };
    } else if (request.method === "POST") {
      input = { ...(await request.json().catch(() => ({})) as Record<string, unknown>), action: "create" };
    } else {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
  } else if (route.kind === "session") {
    if (request.method === "GET") input = { action: "get", sessionId: route.sessionId };
    else if (request.method === "DELETE") input = { action: "close", sessionId: route.sessionId };
    else return Response.json({ error: "Method not allowed" }, { status: 405 });
  } else if (route.kind === "targets") {
    if (request.method === "GET") input = { action: "listTargets", sessionId: route.sessionId };
    else if (request.method === "POST") {
      input = { ...(await request.json().catch(() => ({})) as Record<string, unknown>), action: "createTarget", sessionId: route.sessionId };
    } else {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }
  } else if (route.kind === "frames") {
    if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
    return browserFrameStream(request, env, route.sessionId, route.targetId);
  } else if (route.kind === "frameStatus") {
    if (request.method !== "GET") return Response.json({ error: "Method not allowed" }, { status: 405 });
    const result = await browserFrameStreamStatus(request, env, route.sessionId, route.targetId);
    return Response.json(result, { status: result.ok ? 200 : browserSessionHttpStatus(result) });
  } else if (request.method === "GET") {
    input = { action: "getTarget", sessionId: route.sessionId, targetId: route.targetId };
  } else if (request.method === "DELETE") {
    input = { action: "closeTarget", sessionId: route.sessionId, targetId: route.targetId };
  } else {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const result = await browserSessionOperation(env, input);
  return Response.json(result, { status: browserSessionHttpStatus(result) });
}

async function browserSessionOperation(
  env: RuntimeEnv,
  input: BrowserSessionOperationInput
): Promise<Record<string, unknown>> {
  const action = input.action ?? "create";
  const config = browserRenderingConfig(env);
  if (!config.ok) return config;

  if (action === "create") {
    return browserCreateLiveSession(env, input);
  }

  if (action === "list") {
    const params = new URLSearchParams();
    const limit = normalizeBrowserLimit(input.limit, 20);
    const offset = normalizeBrowserLimit(input.offset, 0);
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    const call = await callBrowserRunApi(config, "/browser-rendering/devtools/session?" + params.toString(), { method: "GET" });
    if (!call.ok) return browserRunFailure(call);
    const sessions = Array.isArray(call.result) ? call.result.map(normalizeBrowserSession) : [];
    return {
      ok: true,
      status: "listed",
      sessions,
      summary: sessions.length + " Browser Run session" + (sessions.length === 1 ? "" : "s") + " found."
    };
  }

  const sessionId = normalizeBrowserId(input.sessionId);
  if (!sessionId) {
    return { ok: false, status: "missing-session", error: "sessionId is required." };
  }

  if (action === "get") {
    const call = await callBrowserRunApi(config, "/browser-rendering/devtools/session/" + encodeURIComponent(sessionId), { method: "GET" });
    if (!call.ok) return browserRunFailure(call);
    const session = normalizeBrowserSession(call.result);
    return { ok: true, status: "ready", sessionId, session, summary: "Browser Run session " + sessionId + " is ready." };
  }

  if (action === "close") {
    const call = await callBrowserRunApi(config, "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId), { method: "DELETE" });
    if (!call.ok) return browserRunFailure(call);
    return { ok: true, status: "closed", sessionId, result: call.result, summary: "Browser Run session " + sessionId + " is closing." };
  }

  if (action === "listTargets") {
    return browserListTargets(config, sessionId);
  }

  if (action === "createTarget") {
    return browserCreateTarget(config, sessionId, input.url);
  }

  const targetId = normalizeBrowserId(input.targetId);
  if (!targetId) return { ok: false, status: "missing-target", error: "targetId is required." };

  if (action === "getTarget") {
    const call = await callBrowserRunApi(
      config,
      "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId) + "/json/list/" + encodeURIComponent(targetId),
      { method: "GET" }
    );
    if (!call.ok) return browserRunFailure(call);
    const target = normalizeBrowserTarget(call.result);
    return {
      ok: true,
      status: "target-ready",
      sessionId,
      target,
      summary: browserTargetSummary("Browser target is ready", target)
    };
  }

  const call = await callBrowserRunApi(
    config,
    "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId) + "/json/close/" + encodeURIComponent(targetId),
    { method: "DELETE" }
  );
  if (!call.ok) return browserRunFailure(call);
  return { ok: true, status: "target-closed", sessionId, targetId, result: call.result, summary: "Browser target " + targetId + " is closing." };
}

function browserFrameStream(
  request: Request,
  env: RuntimeEnv,
  sessionId: string,
  targetId: string
): Response {
  const config = browserRenderingConfig(env);
  if (!config.ok) return Response.json(config, { status: 503 });
  const url = new URL(request.url);
  const fps = boundedNumber(url.searchParams.get("fps"), 4, 1, 4);
  const durationSeconds = boundedNumber(url.searchParams.get("duration"), 60, 5, 300);
  const quality = boundedNumber(url.searchParams.get("quality"), 72, 30, 90);
  const intervalMs = Math.max(250, Math.floor(1000 / fps));
  const encoder = new TextEncoder();
  let cancelled = false;
  request.signal.addEventListener("abort", () => {
    cancelled = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n"));
      };
      let cdp: Awaited<ReturnType<typeof connectBrowserCdp>> | null = null;
      try {
        send("status", { status: "connecting", sessionId, targetId, fps });
        const targetResult = await browserSessionOperation(env, { action: "getTarget", sessionId, targetId });
        const target = isBrowserRecord(targetResult.target) ? targetResult.target : {};
        const wsUrl = typeof target.webSocketDebuggerUrl === "string" ? target.webSocketDebuggerUrl : "";
        if (!wsUrl) {
          send("error", {
            status: "missing-websocket",
            error: "Browser Run target did not expose a CDP websocket URL. Use Live View or refresh the target."
          });
          return;
        }

        cdp = await connectBrowserCdp(wsUrl);
        send("status", { status: "streaming", sessionId, targetId, fps, intervalMs });
        const startedAt = Date.now();
        let frame = 0;
        while (!cancelled && Date.now() - startedAt < durationSeconds * 1000) {
          const result = await cdp.send("Page.captureScreenshot", {
            format: "jpeg",
            quality,
            fromSurface: true,
            captureBeyondViewport: false
          });
          const data = typeof result.data === "string" ? result.data : "";
          if (data) {
            frame += 1;
            send("frame", {
              status: "frame",
              frame,
              at: new Date().toISOString(),
              mimeType: "image/jpeg",
              screenshotDataUrl: "data:image/jpeg;base64," + data
            });
          }
          await sleep(intervalMs);
        }
        send("done", { status: "done", frames: frame });
      } catch (error) {
        send("error", {
          status: "failed",
          error: error instanceof Error ? error.message : "Browser frame stream failed."
        });
      } finally {
        cdp?.close();
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive"
    }
  });
}

async function browserFrameStreamStatus(
  request: Request,
  env: RuntimeEnv,
  sessionId: string,
  targetId: string
): Promise<Record<string, unknown>> {
  const config = browserRenderingConfig(env);
  if (!config.ok) return config;
  const url = new URL(request.url);
  const fps = boundedNumber(url.searchParams.get("fps"), 4, 1, 4);
  const durationSeconds = boundedNumber(url.searchParams.get("duration"), 60, 5, 300);
  const quality = boundedNumber(url.searchParams.get("quality"), 72, 30, 90);
  const targetResult = await browserSessionOperation(env, { action: "getTarget", sessionId, targetId });
  if (!targetResult.ok) return targetResult;
  const target = isBrowserRecord(targetResult.target) ? targetResult.target : {};
  const webSocketDebuggerUrl =
    typeof target.webSocketDebuggerUrl === "string" ? target.webSocketDebuggerUrl : "";
  const frameStreamUrl =
    "/browser/sessions/" +
    encodeURIComponent(sessionId) +
    "/targets/" +
    encodeURIComponent(targetId) +
    "/frames?fps=" +
    encodeURIComponent(String(fps)) +
    "&duration=" +
    encodeURIComponent(String(durationSeconds)) +
    "&quality=" +
    encodeURIComponent(String(quality));
  return {
    ok: true,
    status: webSocketDebuggerUrl ? "frame-stream-ready" : "missing-websocket",
    sessionId,
    targetId,
    target,
    hasWebSocketDebuggerUrl: Boolean(webSocketDebuggerUrl),
    frameStreamUrl,
    fps,
    duration: durationSeconds,
    quality,
    summary: webSocketDebuggerUrl
      ? "Browser Run target exposes a CDP websocket and can stream viewport frames."
      : "Browser Run target does not expose a CDP websocket URL. Use Live View or capture snapshots instead."
  };
}

type BrowserCdpClient = {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
};

function connectBrowserCdp(webSocketUrl: string): Promise<BrowserCdpClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let nextId = 1;
    const pending = new Map<number, {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }>();
    const startupTimer = setTimeout(() => reject(new Error("Timed out connecting to Browser Run CDP websocket.")), 10_000);

    const closePending = (error: Error) => {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    };

    socket.addEventListener("open", () => {
      clearTimeout(startupTimer);
      resolve({
        send(method: string, params: Record<string, unknown> = {}) {
          const id = nextId++;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise<Record<string, unknown>>((sendResolve, sendReject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              sendReject(new Error("Timed out waiting for CDP method " + method + "."));
            }, 10_000);
            pending.set(id, { resolve: sendResolve, reject: sendReject, timer });
          });
        },
        close() {
          closePending(new Error("Browser CDP stream closed."));
          socket.close();
        }
      });
    });

    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (!text) return;
      const message = JSON.parse(text) as Record<string, unknown>;
      const id = typeof message.id === "number" ? message.id : 0;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
      else entry.resolve((message.result && typeof message.result === "object" ? message.result : {}) as Record<string, unknown>);
    });

    socket.addEventListener("error", () => {
      clearTimeout(startupTimer);
      closePending(new Error("Browser CDP websocket error."));
      reject(new Error("Browser CDP websocket error."));
    });
    socket.addEventListener("close", () => {
      clearTimeout(startupTimer);
      closePending(new Error("Browser CDP websocket closed."));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browserCreateLiveSession(
  env: RuntimeEnv,
  input: BrowserSessionOperationInput
): Promise<Record<string, unknown>> {
  const config = browserRenderingConfig(env);
  if (!config.ok) return config;
  const keepAliveMs = normalizeKeepAliveMs(input.keepAliveMs);
  const includeTargets = input.targets !== false;
  const params = new URLSearchParams({
    keep_alive: String(keepAliveMs),
    targets: includeTargets ? "true" : "false"
  });
  if (typeof input.recording === "boolean") params.set("recording", input.recording ? "true" : "false");

  const call = await callBrowserRunApi(config, "/browser-rendering/devtools/browser?" + params.toString(), { method: "POST" });
  if (!call.ok) return browserRunFailure(call);

  const session = normalizeBrowserSession(call.result);
  const sessionId = normalizeBrowserId(session.sessionId);
  if (!sessionId) return { ok: false, status: "browser-rendering-failed", error: "Cloudflare did not return a Browser Run sessionId." };

  let target: Record<string, unknown> | undefined;
  if (input.url) {
    const targetResult = await browserCreateTarget(config, sessionId, input.url);
    if (!targetResult.ok) return targetResult;
    target = targetResult.target as Record<string, unknown> | undefined;
  }

  let targets: Array<Record<string, unknown>> = Array.isArray(session.targets)
    ? session.targets.filter(isBrowserRecord)
    : [];
  if (targets.length === 0 && includeTargets) {
    const targetList = await browserListTargets(config, sessionId);
    if (targetList.ok && Array.isArray(targetList.targets)) targets = targetList.targets.filter(isBrowserRecord);
  }
  if (target) targets = [target, ...targets.filter((item) => item.id !== target?.id)];

  const chosenTarget = target ?? targets[0];
  const capturedAt = new Date().toISOString();
  const artifact = {
    kind: "browser-session",
    mode: "live",
    status: "ready",
    title: chosenTarget?.title || chosenTarget?.url || "Browser Run live session",
    url: chosenTarget?.url || input.url || "about:blank",
    sessionId,
    keepAliveMs,
    createdAt: capturedAt,
    devtoolsFrontendUrl: chosenTarget?.devtoolsFrontendUrl,
    takeoverUrl: chosenTarget?.devtoolsFrontendUrl,
    webSocketDebuggerUrl: chosenTarget?.webSocketDebuggerUrl ?? session.webSocketDebuggerUrl,
    session,
    target: chosenTarget,
    targets,
    events: [
      { label: "Browser Run session created", status: "complete", at: capturedAt },
      { label: targets.length ? "Live View target ready" : "No target returned yet", status: targets.length ? "complete" : "pending", at: capturedAt }
    ],
    source: "cloudflare-browser-run",
    docs: "https://developers.cloudflare.com/browser-run/cdp/session-management/"
  };
  const key = normalizeArtifactKey(input.artifactKey) || defaultBrowserSessionArtifactKey(sessionId, capturedAt);

  if (env.AGENT_STORAGE) {
    await env.AGENT_STORAGE.put(key, JSON.stringify(artifact, null, 2), {
      httpMetadata: { contentType: "application/json; charset=utf-8" }
    });
  }

  return {
    ok: true,
    status: "created",
    sessionId,
    session,
    target: chosenTarget,
    targets,
    artifactKey: key,
    stored: Boolean(env.AGENT_STORAGE),
    keepAliveMs,
    summary: browserTargetSummary("Browser Run live session ready", chosenTarget),
    artifact: env.AGENT_STORAGE ? undefined : artifact
  };
}

async function browserListTargets(
  config: BrowserRenderingReadyConfig,
  sessionId: string
): Promise<Record<string, unknown>> {
  const call = await callBrowserRunApi(
    config,
    "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId) + "/json/list",
    { method: "GET" }
  );
  if (!call.ok) return browserRunFailure(call);
  const targets = Array.isArray(call.result) ? call.result.map(normalizeBrowserTarget) : [];
  return {
    ok: true,
    status: "targets-listed",
    sessionId,
    targets,
    summary: targets.length + " Browser Run target" + (targets.length === 1 ? "" : "s") + " found."
  };
}

async function browserCreateTarget(
  config: BrowserRenderingReadyConfig,
  sessionId: string,
  targetUrl?: string | undefined
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams();
  const normalizedUrl = typeof targetUrl === "string" ? targetUrl.trim() : "";
  if (normalizedUrl) params.set("url", normalizedUrl);
  const suffix = params.toString() ? "?" + params.toString() : "";
  const call = await callBrowserRunApi(
    config,
    "/browser-rendering/devtools/browser/" + encodeURIComponent(sessionId) + "/json/new" + suffix,
    { method: "PUT" }
  );
  if (!call.ok) return browserRunFailure(call);
  const target = normalizeBrowserTarget(call.result);
  return {
    ok: true,
    status: "target-created",
    sessionId,
    target,
    summary: browserTargetSummary("Browser Run target ready", target)
  };
}

type BrowserRenderingConfig =
  | { ok: true; accountId: string; apiToken: string }
  | { ok: false; status: "missing-configuration"; error: string; requiredPermission: string; docs: string };

type BrowserRenderingReadyConfig = Extract<BrowserRenderingConfig, { ok: true }>;

function browserRenderingConfig(env: RuntimeEnv): BrowserRenderingConfig {
  const accountId = String(env.OPEN_THINK_CF_ACCOUNT_ID ?? "").trim();
  const apiToken = String(env.OPEN_THINK_CF_API_TOKEN ?? "").trim();
  if (!accountId || !apiToken) {
    return {
      ok: false,
      status: "missing-configuration",
      error: "OPEN_THINK_CF_ACCOUNT_ID and OPEN_THINK_CF_API_TOKEN are required for Cloudflare Browser Run sessions.",
      requiredPermission: "Browser Rendering Edit",
      docs: "https://developers.cloudflare.com/browser-run/cdp/session-management/"
    };
  }
  return { ok: true, accountId, apiToken };
}

async function callBrowserRunApi(
  config: { accountId: string; apiToken: string },
  path: string,
  init: RequestInit
): Promise<{ ok: boolean; cloudflareStatus: number; result?: unknown; body?: Record<string, unknown>; error?: string }> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", "Bearer " + config.apiToken);
  const response = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(config.accountId) + path,
    {
      ...init,
      headers
    }
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  const result = body && typeof body === "object" && "result" in body ? body.result : body;
  if (!response.ok || body.success === false) {
    return {
      ok: false,
      cloudflareStatus: response.status,
      body,
      error: String(((body.errors as Array<{ message?: unknown }> | undefined)?.[0]?.message) ?? body.message ?? "Cloudflare Browser Run request failed.")
    };
  }
  return { ok: true, cloudflareStatus: response.status, result, body };
}

function browserRunFailure(call: { cloudflareStatus: number; error?: string; body?: Record<string, unknown> }): Record<string, unknown> {
  return {
    ok: false,
    status: "browser-rendering-failed",
    error: call.error ?? "Cloudflare Browser Run request failed.",
    cloudflareStatus: call.cloudflareStatus,
    requiredPermission: "Browser Rendering Edit",
    docs: "https://developers.cloudflare.com/browser-run/cdp/session-management/",
    cloudflare: call.body
  };
}

function browserSessionHttpStatus(result: Record<string, unknown>): number {
  if (result.ok === true) return result.status === "created" || result.status === "target-created" ? 201 : 200;
  if (result.status === "missing-configuration") return 503;
  if (result.status === "missing-session" || result.status === "missing-target") return 400;
  if (result.status === "browser-rendering-failed" && typeof result.cloudflareStatus === "number") return result.cloudflareStatus as number;
  return 500;
}

function normalizeBrowserSession(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizeBrowserTarget(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isBrowserRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

function normalizeBrowserId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKeepAliveMs(value: unknown): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 600_000;
  return Math.max(30_000, Math.min(600_000, Math.round(numberValue)));
}

function normalizeBrowserLimit(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numberValue)));
}

function defaultBrowserSessionArtifactKey(sessionId: string, capturedAt: string): string {
  return normalizeArtifactKey(
    "browser/sessions/" + slugify(sessionId || "session") + "/" + capturedAt.replace(/[:.]/g, "-") + ".browser.json"
  );
}

function browserTargetSummary(prefix: string, target: Record<string, unknown> | undefined): string {
  const title = typeof target?.title === "string" && target.title ? target.title : undefined;
  const url = typeof target?.url === "string" && target.url ? target.url : undefined;
  const liveView = typeof target?.devtoolsFrontendUrl === "string" && target.devtoolsFrontendUrl
    ? " Live View is available."
    : " List targets to refresh the Live View URL.";
  return prefix + (title || url ? ": " + (title ?? url) + "." : ".") + liveView;
}

function normalizeBrowserViewport(
  value: {
    width?: number | undefined;
    height?: number | undefined;
    deviceScaleFactor?: number | undefined;
  } | undefined
): Record<string, number> | undefined {
  if (!value) return undefined;
  const viewport: Record<string, number> = {};
  if (Number.isFinite(value.width)) viewport.width = Math.round(Number(value.width));
  if (Number.isFinite(value.height)) viewport.height = Math.round(Number(value.height));
  if (Number.isFinite(value.deviceScaleFactor)) viewport.deviceScaleFactor = Number(value.deviceScaleFactor);
  return Object.keys(viewport).length > 0 ? viewport : undefined;
}

function defaultBrowserSnapshotArtifactKey(target: string, capturedAt: string): string {
  return normalizeArtifactKey(
    "browser/" + slugify(browserArtifactTitle(target)) + "/" + capturedAt.replace(/[:.]/g, "-") + ".browser.json"
  );
}

function browserArtifactTitle(target: string): string {
  try {
    const url = new URL(target);
    return url.hostname + (url.pathname === "/" ? "" : url.pathname);
  } catch {
    return "browser snapshot";
  }
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
  rawMessage: string,
  nativeResponder?: (
    subAgent: SubAgent,
    history: SubAgentMessage[]
  ) => Promise<Record<string, unknown>>
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

  try {
    const history = await listSubAgentMessages(env, id);
    const nativeResult = nativeResponder ? await nativeResponder(subAgent, history).catch(() => null) : null;
    const reply = typeof nativeResult?.reply === "string"
      ? nativeResult.reply
      : await runSubAgentModel(env, subAgent, history);
    const repliedAt = new Date().toISOString();
    await env.DB!.prepare(
      "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), id, "assistant", reply, repliedAt).run();
    await env.DB!.prepare(
      "update sub_agents set status = ?, summary = ?, updated_at = ? where id = ?"
    ).bind("ready", deriveSubAgentSummary(subAgent, message, reply), repliedAt, id).run();
    await recordWorkspaceContext(env, {
      workspaceId: defaultWorkspaceId,
      kind: "sub-agent-message",
      summary: subAgent.name + ": " + deriveSubAgentSummary(subAgent, message, reply),
      metadata: {
        subAgentId: id,
        subAgentName: subAgent.name,
        userMessage: message
      }
    });

    return {
      ok: true,
      subAgent: await getSubAgent(env, id),
      message: reply,
      messages: await listSubAgentMessages(env, id),
      native: nativeResult?.native ?? null
    };
  } catch (error) {
    const failedAt = new Date().toISOString();
    const failure = error instanceof Error ? error.message : "Sub-agent response failed.";
    await env.DB!.prepare(
      "update sub_agents set status = ?, summary = ?, updated_at = ? where id = ?"
    ).bind("ready", "Blocked: " + failure, failedAt, id).run();
    await env.DB!.prepare(
      "insert into sub_agent_messages (id, sub_agent_id, role, content, created_at) values (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), id, "system", "Sub-agent run failed: " + failure, failedAt).run();
    return {
      ok: false,
      error: failure,
      subAgent: await getSubAgent(env, id),
      messages: await listSubAgentMessages(env, id)
    };
  }
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
    "Use Agents SDK semantics for chat/state. Use executor-oriented reasoning only when the main runtime has a Sandbox binding or OPEN_THINK_EXECUTOR_MCP_URL.",
    executorConfigured(env)
      ? "Executor is configured for execution-heavy work."
      : "Executor is not configured; plan execution but do not claim command, filesystem, or browser access."
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

function trainCommandPayload(task = "") {
  const trimmedTask = task.trim();
  return {
    enabled: true,
    command: "/train",
    endpoint: "/learning",
    behavior:
      "Turns a request into an editable plan first, executes only after explicit approval, and offers to save reusable successful steps as skills.",
    prompt: trainCommandPrompt(trimmedTask)
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

function trainCommandPrompt(task: string): string {
  return [
    "Train mode is active.",
    task ? "Task: " + task : "No task text was provided.",
    "Draft a numbered plan with objective, assumptions, steps, risk level, required tools, and expected artifacts.",
    "Do not execute mutating tools until the owner approves the plan or a specific step.",
    "After a successful run, suggest one concise reusable skill name and the trigger conditions for saving it."
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

function trainCommandInstruction(): string {
  return [
    "Slash command /train is enabled.",
    "When the owner's message begins with /train, treat the remaining text as a train-mode request.",
    "In train mode, first draft an editable numbered plan with objective, assumptions, steps, tool needs, risks, and expected artifacts.",
    "Wait for explicit approval before using mutating tools. Read-only inspection is allowed when it is needed to make the plan accurate.",
    "After a successful trained run, offer to save the repeatable pattern as a skill with a short name and trigger conditions."
  ].join("\n");
}

function cloudAgentInstanceState(env: RuntimeEnv): Record<string, unknown> {
  const executorUrl = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  const executorReady = executorConfigured(env);
  const sandboxConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_SANDBOX_STATUS);
  const containersConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_CONTAINER_STATUS);
  return {
    ...cloudAgentInstance,
    codeMode: {
      ...cloudAgentInstance.codeMode,
      enabled: codeModeEnabled(env),
      cloudflareApiMcpUrl: cloudflareApiMcpUrl(env)
    },
    skills: cloudAgentInstance.skills.map((skill) =>
      skill.id === "executor-mcp"
        ? {
            ...skill,
            enabled: true,
            configured: executorReady,
            status: executorStatus(env)
          }
        : skill
    ),
    execution: {
      ...cloudAgentInstance.execution,
      executor: {
        ...cloudAgentInstance.execution.executor,
        enabled: true,
        configured: executorReady,
        status: executorStatus(env),
        transport: executorTransport(env),
        mcpServerUrl: executorUrl ? "configured" : sandboxBridgeAvailable(env) ? "/mcp/call?server=executor" : null,
        authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN),
        pointsTo:
          "Same-Worker Cloudflare Sandbox/Containers RPC bridge by default. OPEN_THINK_EXECUTOR_MCP_URL may point to a self-hosted Executor deployment when a separate endpoint is preferred."
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
    },
    workspace: {
      ...cloudAgentInstance.workspace,
      contextStore: {
        ...cloudAgentInstance.workspace.contextStore,
        vectorizeConfigured: Boolean(env.VECTORIZE)
      }
    }
  };
}

function cloudAgentInstanceInstruction(env: RuntimeEnv): string {
  return [
    "Cloud agent instance profile:",
    JSON.stringify(cloudAgentInstanceState(env), null, 2),
    "Use Cloudflare Agents SDK for chat streaming, resumable state, message persistence, MCP orchestration, and human approvals.",
    "Executor is the default execution-plane contract. In the standard OpenThink deployment it is backed by the same-Worker Cloudflare Sandbox Durable Object and Containers over RPC.",
    "If OPEN_THINK_EXECUTOR_MCP_URL is configured, it may point at a self-hosted or executor.sh-compatible external MCP endpoint instead of the same-Worker bridge.",
    "Use executor when it is configured and the goal needs code execution, filesystem work, browser automation, subprocesses, OpenAPI execution, or long-running workflow workers.",
    "Use Cloudflare Code Mode MCP for broad Cloudflare API exploration and execution through the compact search/execute tool shape.",
    "Treat sub-agents as scoped child Cloud Agent Instances with their own purpose, brain, prompt, skills, status, summary, interaction thread, and native subAgent() typed RPC path.",
    "Use the default workspace orchestrator to keep project progress, sub-agent briefs, Cloudflare context, and next actions outside the chat transcript until needed.",
    "If neither the Sandbox binding nor an executor URL is available, say the executor plane is enabled by default but not connected yet; do not claim live command/filesystem/browser access.",
    "Agents can be customized through the cloud agent profile: system prompt, soul prompt, launch brief, brain preset, enabled features, skills, and execution plane."
  ].join("\n");
}

function subAgentCapabilityState(env: RuntimeEnv) {
  return {
    enabled: true,
    persistence: env.DB ? "D1 sub_agents and sub_agent_messages plus native OpenThinkSubAgent facets" : "unavailable until DB binding is configured",
    endpoints: ["/subagents", "/subagents/{id}", "/subagents/{id}/messages", "/subagents/{id}/control", "/subagents/{id}/summary"],
    controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"],
    modes: ["agents-sdk", "executor", "hybrid"],
    nativeRuntime: "Cloudflare Agents subAgent() typed RPC through OpenThinkSubAgent when package runtime is active",
    mcpRpc: env.WORKSPACE_MCP
      ? "OpenThinkWorkspaceMcp is bound and registered through addMcpServer(binding)."
      : "OpenThinkWorkspaceMcp binding missing; add WORKSPACE_MCP Durable Object binding for same-Worker MCP RPC.",
    templates: ["research-scout", "builder", "reviewer", "cloud-operator"]
  };
}

function runtimeFlagEnabled(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "enabled" || normalized === "configured" || normalized === "ready";
}

function runtimeFlagDisabled(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "off" || normalized === "disabled";
}

function codeModeEnabled(env: RuntimeEnv): boolean {
  return !runtimeFlagDisabled(env.OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE);
}

function cloudflareApiMcpUrl(env: RuntimeEnv): string {
  return codeModeEnabled(env) ? cloudflareCodeModeMcpUrl : cloudflareMcpServerUrl;
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

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, Math.max(0, maxLength - 1)) + "..." : text;
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

function asMetadata(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return asMetadata(parsed);
    } catch {
      return { text: value };
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { value };
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
  if (normalized === "full-auto" || normalized === "fullauto" || normalized === "always-approve" || normalized === "alwaysapprove") return "full-auto";
  return defaultToolApprovalPolicy;
}

function isFullAutoApprovalPolicy(policy: ToolApprovalPolicy): boolean {
  return policy === "allow-all" || policy === "full-auto";
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
  const alwaysApprovalPattern =
    /\b(delete|remove|purge|billing|payment|invoice|secret|token|key|credential|permission|policy|access|dns|route|custom hostname|firewall|waf|zero trust|domain|user|member|account)\b/;
  const goalScopedCodeModePattern =
    /\b(execute|run|apply|create|update|deploy|upload|write|provision|enable|bind)\b/;

  if (safeReadPattern.test(normalizedName) && !riskyActionPattern.test(normalizedName)) return false;
  if (alwaysApprovalPattern.test(`${normalizedName} ${descriptionText}`)) return true;
  if (goalScopedCodeModePattern.test(normalizedName) && normalizedName.includes("execute")) return false;
  if (riskyPattern.test(`${normalizedName} ${descriptionText}`)) return true;
  return !safeReadPattern.test(descriptionText);
}
