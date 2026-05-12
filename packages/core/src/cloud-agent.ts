export type CloudAgentTransport = "websocket" | "server-sent-events" | "json";
export type CloudAgentSubAgentStatus = "ready" | "working" | "paused" | "archived";
export type CloudAgentSubAgentMode = "agents-sdk" | "executor" | "hybrid";

export interface CloudAgentSdkDescriptor {
  packageName: "@open-think/core";
  version: string;
  clientFactory: "createHostedCloudAgentClient";
  profileEndpoint: "/cloud-agent/profile";
  endpoints: {
    health: "/health";
    manifest: "/manifest";
    goal: "/goal";
    subAgents: "/subagents";
    runtimeContext: "/runtime/context";
    personalAgentSetup: "/personal-agent/setup";
  };
}

export interface CloudAgentCustomizationDescriptor {
  deployTime: string[];
  runtimeEnv: string[];
  personalAgent: string[];
  subAgent: string[];
}

export interface CloudAgentInstanceProfile {
  schemaVersion: "2026-05-10";
  id: string;
  label: string;
  kind: "cloud-agent-instance";
  chat: {
    primaryRuntime: "cloudflare-agents-sdk";
    transport: "websocket";
    persistence: "sqlite";
  };
  brain: {
    id: string;
    label: string;
    stack: string;
    enabledFeatures: string[];
  };
  prompts: {
    systemPromptConfigurable: true;
    soulPromptConfigured: boolean;
    launchBriefConfigured: boolean;
  };
  skills: Array<{
    id: string;
    label: string;
    source: "built-in" | "mcp" | "executor" | "cloudflare";
    enabled: boolean;
  }>;
  execution: {
    agentsSdk: {
      role: "chat-streaming-state-and-tool-orchestration";
      enabled: true;
    };
    executor: {
      role: "external-execution-plane";
      enabled: boolean;
      default: boolean;
      configured?: boolean;
      status?: string;
      mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL";
      authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN";
      defaultTarget?: string;
      recommendedFor: string[];
    };
    sandbox: {
      role: "cloudflare-sandbox-execution";
      enabled: boolean;
      default: boolean;
      configured?: boolean;
      status?: string;
    };
    containers: {
      role: "custom-runtime-and-long-running-services";
      enabled: boolean;
      default: boolean;
      configured?: boolean;
      status?: string;
    };
  };
  goal: {
    command: "/goal";
    firstClass: true;
    persistence: "D1 memory when DB is bound, otherwise chat state";
    executorAware: true;
  };
  subAgents: {
    firstClass: true;
    persistence: "D1 sub_agents and sub_agent_messages when DB is bound";
    modes: CloudAgentSubAgentMode[];
    controls: string[];
  };
  sdk: CloudAgentSdkDescriptor;
  customization: CloudAgentCustomizationDescriptor;
}

export interface HostedCloudAgentFlowStep {
  id: "design" | "deploy" | "connect" | "customize" | "delegate" | "operate";
  title: string;
  owner: "platform" | "developer" | "personal-agent" | "operator";
  endpoint?: string;
  description: string;
}

export const hostedCloudAgentSdkDescriptor: CloudAgentSdkDescriptor = {
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
};

export const hostedCloudAgentCustomization: CloudAgentCustomizationDescriptor = {
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
  subAgent: [
    "name",
    "purpose",
    "mode",
    "brain",
    "skills",
    "system prompt",
    "model"
  ]
};

export const hostedCloudAgentFlow: HostedCloudAgentFlowStep[] = [
  {
    id: "design",
    title: "Design profile",
    owner: "developer",
    description: "Choose the personal-agent brain, prompts, skills, model, approval policy, and default executor-plane target."
  },
  {
    id: "deploy",
    title: "Deploy Worker",
    owner: "platform",
    endpoint: "/manifest",
    description: "Publish the Cloudflare Agents SDK Worker, asset UI, Durable Object class, D1/R2/Queue bindings, and profile metadata."
  },
  {
    id: "connect",
    title: "Connect client",
    owner: "developer",
    endpoint: "/health",
    description: "Use the hosted SDK or Agents SDK hooks to inspect health, open chat, and discover capabilities."
  },
  {
    id: "customize",
    title: "Customize runtime",
    owner: "personal-agent",
    endpoint: "/personal-agent/setup",
    description: "Review the active brain, prompts, feature flags, MCP policy, executor status, and setup notes."
  },
  {
    id: "delegate",
    title: "Create sub-agents",
    owner: "personal-agent",
    endpoint: "/subagents",
    description: "Create scoped child Cloud Agent Instances with their own purpose, brain, skills, status, summary, and message thread."
  },
  {
    id: "operate",
    title: "Operate and update",
    owner: "operator",
    endpoint: "/goal",
    description: "Anchor work with /goal, approve risky tools, summarize progress, reconcile source, and update the Worker."
  }
];

export interface CloudAgentSubAgent {
  id: string;
  name: string;
  purpose: string;
  status: CloudAgentSubAgentStatus;
  mode: CloudAgentSubAgentMode;
  model: string;
  brain: string;
  systemPrompt: string;
  skills: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
}

export interface CloudAgentSubAgentMessage {
  id: string;
  subAgentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface CreateCloudAgentSubAgentInput {
  name: string;
  purpose: string;
  mode?: CloudAgentSubAgentMode;
  model?: string;
  brain?: string;
  systemPrompt?: string;
  skills?: string[];
}

export interface HostedCloudAgentClientOptions {
  baseUrl: string | URL;
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

export function createHostedCloudAgentClient(options: HostedCloudAgentClientOptions): HostedCloudAgentClient {
  return new HostedCloudAgentClient(options);
}

export function hostedCloudAgentSdkSnippet(baseUrl = "https://your-agent.workers.dev"): string {
  return [
    'import { createHostedCloudAgentClient } from "@open-think/core";',
    "",
    "const agent = createHostedCloudAgentClient({",
    `  baseUrl: "${baseUrl}"`,
    "});",
    "",
    "const profile = await agent.profile();",
    'await agent.goal("Ship the first customer workflow");',
    "const child = await agent.createSubAgent({",
    '  name: "Deploy scout",',
    '  purpose: "Check deploy readiness and summarize blockers",',
    '  mode: "hybrid",',
    '  skills: ["cloudflare", "release", "testing"]',
    "});",
    'await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");'
  ].join("\n");
}

export class HostedCloudAgentClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers?: HostedCloudAgentClientOptions["headers"];

  constructor(options: HostedCloudAgentClientOptions) {
    this.baseUrl = String(options.baseUrl).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
    this.headers = options.headers;
  }

  health<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>(hostedCloudAgentSdkDescriptor.endpoints.health);
  }

  manifest<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>(hostedCloudAgentSdkDescriptor.endpoints.manifest);
  }

  async profile(): Promise<CloudAgentInstanceProfile> {
    try {
      return await this.request<CloudAgentInstanceProfile>(hostedCloudAgentSdkDescriptor.profileEndpoint);
    } catch (error) {
      const manifest = await this.manifest<{ cloudAgentInstance?: CloudAgentInstanceProfile }>();
      if (manifest.cloudAgentInstance) return manifest.cloudAgentInstance;
      throw error;
    }
  }

  goal(goal?: string): Promise<Record<string, unknown>> {
    if (!goal?.trim()) return this.request(hostedCloudAgentSdkDescriptor.endpoints.goal);
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.goal, {
      method: "POST",
      body: JSON.stringify({ goal })
    });
  }

  listSubAgents(): Promise<{ available?: boolean; subAgents: CloudAgentSubAgent[]; error?: string }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.subAgents);
  }

  createSubAgent(input: CreateCloudAgentSubAgentInput): Promise<{ ok?: boolean; subAgent: CloudAgentSubAgent }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.subAgents, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  getSubAgent(id: string): Promise<{ subAgent: CloudAgentSubAgent }> {
    return this.request("/subagents/" + encodeURIComponent(id));
  }

  listSubAgentMessages(id: string): Promise<{
    subAgent: CloudAgentSubAgent;
    messages: CloudAgentSubAgentMessage[];
  }> {
    return this.request("/subagents/" + encodeURIComponent(id) + "/messages");
  }

  sendSubAgentMessage(id: string, message: string): Promise<{
    ok?: boolean;
    subAgent: CloudAgentSubAgent;
    message: string;
    messages: CloudAgentSubAgentMessage[];
  }> {
    return this.request("/subagents/" + encodeURIComponent(id) + "/messages", {
      method: "POST",
      body: JSON.stringify({ message })
    });
  }

  controlSubAgent(id: string, status: CloudAgentSubAgentStatus): Promise<{
    ok?: boolean;
    subAgent: CloudAgentSubAgent;
  }> {
    return this.request("/subagents/" + encodeURIComponent(id) + "/control", {
      method: "POST",
      body: JSON.stringify({ status })
    });
  }

  summarizeSubAgent(id: string): Promise<{
    ok?: boolean;
    summary: string;
    subAgent: CloudAgentSubAgent;
  }> {
    return this.request("/subagents/" + encodeURIComponent(id) + "/summary", {
      method: "POST"
    });
  }

  runtimeContext<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>(hostedCloudAgentSdkDescriptor.endpoints.runtimeContext);
  }

  personalAgentSetup<T = Record<string, unknown>>(): Promise<T> {
    return this.request<T>(hostedCloudAgentSdkDescriptor.endpoints.personalAgentSetup);
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(await this.resolveHeaders());
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof data.error === "string" ? data.error : "Hosted Cloud Agent request failed.";
      throw new Error(error);
    }
    return data as T;
  }

  private async resolveHeaders(): Promise<HeadersInit> {
    if (!this.headers) return {};
    if (typeof this.headers === "function") return this.headers();
    return this.headers;
  }
}
