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
    runtimeContext: "/runtime/context",
    personalAgentSetup: "/personal-agent/setup"
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
    "Cloudflare resource bindings"
  ],
  personalAgent: [
    "system prompt",
    "soul prompt",
    "launch brief",
    "brain preset",
    "memory/task/file/MCP feature mix"
  ],
  subAgent: ["name", "purpose", "mode", "brain", "skills", "system prompt", "model"]
} as const;

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
        role: "external-execution-plane",
        enabled: true,
        default: true,
        configured: Boolean(input.executorEnabled),
        status: input.executorEnabled ? "configured" : "default-pending",
        mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
        authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
        defaultTarget: "first-party Cloudflare Sandbox bridge or self-hosted Executor MCP endpoint",
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
    subAgents: {
      firstClass: true,
      persistence: "D1 sub_agents and sub_agent_messages when DB is bound",
      modes: ["agents-sdk", "executor", "hybrid"],
      controls: ["create", "pause", "resume", "archive", "summarize", "message", "brief-main-chat"]
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
    "Executor is the default execution-plane contract, but it is callable only when OPEN_THINK_EXECUTOR_MCP_URL is configured or an executor MCP server is connected.",
    "In the default OpenThink architecture, executor MCP points at a first-party Cloudflare Sandbox bridge backed by Containers. It can also point at a self-hosted RhysSullivan/executor MCP endpoint.",
    "Use executor when it is configured and the goal needs code execution, filesystem work, browser automation, subprocesses, OpenAPI execution, or long-running workflow workers.",
    "Treat sub-agents as scoped child Cloud Agent Instances with their own purpose, brain, prompt, skills, status, summary, and interaction thread.",
    "If the executor URL is missing, say the executor plane is enabled by default but not connected yet; do not claim live command/filesystem/browser access.",
    "Agents can be customized through the cloud agent profile: system prompt, soul prompt, launch brief, brain preset, enabled features, skills, and execution plane.",
    "External products can plug in through the hosted agent SDK: @open-think/core createHostedCloudAgentClient."
  ].join("\n");
}
