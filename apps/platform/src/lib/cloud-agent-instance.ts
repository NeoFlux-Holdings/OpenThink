import type { DeploymentRequest } from "./deployment-engine";
import { normalizePersonalAgentConfig } from "./personal-agent-options";

const hostedCloudAgentSdkDescriptor = {
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
} as const;

const hostedCloudAgentCustomization = {
  deployTime: [
    "agentName",
    "defaultModel",
    "thinkingLevel",
    "personalAgent preset",
    "enabled gbrain/gstack features",
    "tool approval policy"
  ],
  runtimeEnv: [
    "OPEN_THINK_DEFAULT_MODEL",
    "OPEN_THINK_TOOL_APPROVAL_POLICY",
    "OPEN_THINK_EXECUTOR_MCP_URL",
    "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
    "OPEN_THINK_SANDBOX_STATUS",
    "OPEN_THINK_CONTAINER_STATUS",
    "Cloudflare resource bindings"
  ],
  personalAgent: [
    "system prompt",
    "soul prompt",
    "launch brief",
    "brain preset",
    "memory/task/file/MCP feature mix"
  ],
  subAgent: ["name", "purpose", "mode", "brain", "skills", "system prompt", "model"],
  workspace: [
    "workspace name",
    "orchestrator prompt",
    "approval policy",
    "gbrain/gstack feature mix",
    "Cloudflare/community/OpenAI/Anthropic skill catalog preload",
    "shared context retention"
  ]
} as const;

const cloudflareCodeModeMcpUrl = "https://mcp.cloudflare.com/mcp?codemode=search_and_execute";
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

export function buildCloudAgentInstanceProfile(input: {
  request: DeploymentRequest;
  deploymentId: string;
  executorEnabled?: boolean;
  sandboxEnabled?: boolean;
  containersEnabled?: boolean;
}) {
  const personalAgent = normalizePersonalAgentConfig(input.request.personalAgent);
  const enabledFeatures = personalAgent.enabledFeatures;
  const featureEnabled = (id: string) => enabledFeatures.some((feature) => feature === id);

  return {
    schemaVersion: "2026-05-10",
    id: input.deploymentId,
    label: input.request.agentName?.trim() || personalAgent.label || "Cloud Agent",
    kind: "cloud-agent-instance",
    chat: {
      primaryRuntime: "cloudflare-agents-sdk",
      transport: "websocket",
      persistence: "sqlite"
    },
    brain: {
      id: personalAgent.presetId,
      label: personalAgent.label,
      stack: personalAgent.stack,
      enabledFeatures
    },
    prompts: {
      systemPromptConfigurable: true,
      soulPromptConfigured: personalAgent.soulPromptConfigured,
      launchBriefConfigured: personalAgent.launchBriefConfigured
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
        enabled: personalAgent.enabled
      },
      {
        id: "cloudflare-mcp",
        label: "Cloudflare API and docs MCP",
        source: "cloudflare",
        enabled: featureEnabled("mcpBridge")
      },
      {
        id: "executor-mcp",
        label: "Executor MCP execution plane",
        source: "executor",
        enabled: true
      }
    ],
    execution: {
      agentsSdk: {
        role: "chat-streaming-state-and-tool-orchestration",
        enabled: true
      },
      executor: {
        role: "first-party-or-external-execution-plane",
        enabled: true,
        default: true,
        configured: Boolean(input.executorEnabled),
        status: input.executorEnabled ? "configured" : "default-pending",
        mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
        authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
        defaultTarget: "same-Worker Cloudflare Sandbox/Containers RPC bridge, with optional self-hosted Executor MCP endpoint",
        recommendedFor: [
          "code execution",
          "filesystem work",
          "browser automation",
          "OpenAPI tool execution",
          "subprocesses",
          "long-running workflow workers"
        ]
      },
      sandbox: {
        role: "cloudflare-sandbox-execution",
        enabled: true,
        default: true,
        configured: Boolean(input.sandboxEnabled),
        status: input.sandboxEnabled ? "configured" : "default-pending"
      },
      containers: {
        role: "custom-runtime-and-long-running-services",
        enabled: true,
        default: true,
        configured: Boolean(input.containersEnabled),
        status: input.containersEnabled ? "configured" : "default-pending"
      }
    },
    goal: {
      command: "/goal",
      firstClass: true,
      persistence: "D1 memory when DB is bound, otherwise chat state",
      executorAware: true
    },
    train: {
      command: "/train",
      firstClass: true,
      persistence: "D1 learning suggestions when DB is bound, otherwise chat state",
      behavior: "plan-first teach mode"
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
    sdk: hostedCloudAgentSdkDescriptor,
    customization: hostedCloudAgentCustomization
  };
}

export type CloudAgentInstanceProfile = ReturnType<typeof buildCloudAgentInstanceProfile>;

export function cloudAgentGoalInstruction(profile: CloudAgentInstanceProfile): string {
  return [
    "Cloud agent instance profile:",
    JSON.stringify(profile, null, 2),
    "Use Cloudflare Agents SDK for chat streaming, resumable state, message persistence, MCP orchestration, and human approvals.",
    "Executor is the default execution-plane contract. In the standard OpenThink deployment it is backed by the same-Worker Cloudflare Sandbox Durable Object and Containers over RPC.",
    "If OPEN_THINK_EXECUTOR_MCP_URL is configured, it may point at a self-hosted or executor.sh-compatible external MCP endpoint instead of the same-Worker bridge.",
    "Use executor when it is configured and the goal needs code execution, filesystem work, browser automation, subprocesses, OpenAPI execution, or long-running workflow workers.",
    "Use Cloudflare Code Mode MCP for broad Cloudflare API exploration and execution through the compact search/execute tool shape.",
    "Treat sub-agents as scoped child Cloud Agent Instances with their own purpose, brain, prompt, skills, status, summary, interaction thread, D1 control history, and native OpenThinkSubAgent typed RPC path.",
    "Use the default workspace orchestrator to keep project progress, sub-agent briefs, Cloudflare context, and next actions outside the chat transcript until needed.",
    "If neither the Sandbox binding nor an executor URL is available, say the executor plane is enabled by default but not connected yet; do not claim live command/filesystem/browser access.",
    "Agents can be customized through the cloud agent profile: system prompt, soul prompt, launch brief, brain preset, enabled features, skills, and execution plane.",
    "External products can plug in through the hosted agent SDK: @open-think/core createHostedCloudAgentClient."
  ].join("\n");
}
