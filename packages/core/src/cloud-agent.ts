export type CloudAgentTransport = "websocket" | "server-sent-events" | "json";
export type CloudAgentSubAgentStatus = "ready" | "working" | "paused" | "archived";
export type CloudAgentSubAgentMode = "agents-sdk" | "executor" | "hybrid";
export type CloudAgentToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all" | "full-auto";

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
    skills: "/skills";
    memory: "/memory";
    artifacts: "/artifacts";
    files: "/files";
    tasks: "/tasks";
    browserSnapshot: "/browser/snapshot";
    browserDiagnostics: "/browser/diagnostics";
    browserSessions: "/browser/sessions";
    contributions: "/contributions";
    learning: "/learning";
    executor: "/executor";
    runtimeContext: "/runtime/context";
    personalAgentSetup: "/personal-agent/setup";
    workspace: "/workspace";
    mcp: {
      servers: "/mcp/servers";
      state: "/mcp/state";
      add: "/mcp/add";
      tools: "/mcp/tools";
      call: "/mcp/call";
      observability: "/mcp/observability";
    };
  };
}

export interface CloudAgentCustomizationDescriptor {
  deployTime: string[];
  runtimeEnv: string[];
  personalAgent: string[];
  subAgent: string[];
  workspace: string[];
}

export interface CloudAgentCodeModeDescriptor {
  enabled: boolean;
  default: boolean;
  cloudflareApiMcpUrl: string;
  portalQuery: "codemode=search_and_execute";
  toolShape: "search-and-execute";
}

export interface CloudAgentWorkspaceDescriptor {
  firstClass: true;
  defaultWorkspace: string;
  orchestrator: {
    enabled: boolean;
    autoSpunUp: boolean;
    className: string;
    coordination: "native-sub-agent-rpc";
  };
  contextStore: {
    primary: "D1 workspace_context";
    semantic: "Vectorize semantic recall when AI and VECTORIZE bindings are connected";
    vectorizeBinding: "VECTORIZE";
  };
  defaultSkills: string[];
  cloudflareSkillSources: string[];
  skillSources: CloudAgentSkillSourceDescriptor[];
  approvalModes: CloudAgentToolApprovalPolicy[];
}

export interface CloudAgentSkillSourceDescriptor {
  id: string;
  label: string;
  url: string;
  category: "cloudflare" | "community" | "openai" | "anthropic" | string;
  defaultEnabled: boolean;
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
  codeMode: CloudAgentCodeModeDescriptor;
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
      role: "external-execution-plane" | "first-party-or-external-execution-plane";
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
  train: {
    command: "/train";
    firstClass: true;
    persistence: "D1 learning suggestions when DB is bound, otherwise chat state";
    behavior: "plan-first teach mode";
  };
  subAgents: {
    firstClass: true;
    persistence: "D1 sub_agents and sub_agent_messages plus native OpenThinkSubAgent facets when Agents SDK runtime is active";
    modes: CloudAgentSubAgentMode[];
    controls: string[];
    nativeRuntime: "Cloudflare Agents subAgent() typed RPC through OpenThinkSubAgent when package runtime is active";
    mcpRpc: "OpenThinkWorkspaceMcp same-Worker MCP server is registered through addMcpServer(WORKSPACE_MCP).";
  };
  workspace: CloudAgentWorkspaceDescriptor;
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
  subAgent: [
    "name",
    "purpose",
    "mode",
    "brain",
    "skills",
    "system prompt",
    "model"
  ],
  workspace: [
    "workspace name",
    "orchestrator prompt",
    "approval policy",
    "gbrain/gstack feature mix",
    "Cloudflare/community/OpenAI/Anthropic skill catalog preload",
    "shared context retention"
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
    description: "Create scoped child Cloud Agent Instances with their own purpose, brain, skills, status, summary, message thread, and native sub-agent/RPC coordination path."
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

export interface CloudAgentWorkspace {
  id: string;
  name: string;
  purpose: string;
  approvalPolicy: CloudAgentToolApprovalPolicy;
  orchestratorStatus: "ready" | "working" | "paused";
  contextSummary: string;
  skills: string[];
  updatedAt: string;
}

export interface CloudAgentSkill {
  id: string;
  label: string;
  source: "built-in" | "mcp" | "executor" | "cloudflare" | string;
  enabled: boolean;
  description?: string;
}

export interface CloudAgentMemoryItem {
  id: string;
  text: string;
  createdAt: string;
}

export interface CloudAgentMemoryResponse {
  available: boolean;
  memories: CloudAgentMemoryItem[];
  semantic?: Record<string, unknown>;
  error?: string;
}

export interface CloudAgentMemorySearchResponse extends CloudAgentMemoryResponse {
  query: string;
}

export interface CloudAgentArtifactItem {
  key: string;
  title: string;
  type: "document" | "code" | "webpage" | "image" | "table" | "slides" | "browser-session" | "diff" | "artifact";
  size?: number;
  uploadedAt?: string;
  contentType?: string;
  versions?: number;
}

export interface CloudAgentArtifactVersion {
  key: string;
  versionKey: string;
  label: string;
  current?: boolean;
  uploaded?: string | null;
  size?: number | null;
}

export interface CloudAgentArtifactDetail extends Omit<CloudAgentArtifactItem, "versions"> {
  versionKey?: string;
  text?: string;
  versions?: CloudAgentArtifactVersion[];
}

export interface CloudAgentFileItem {
  key: string;
  title?: string;
  type?: string;
  size?: number | null;
  uploaded?: string | null;
  contentType?: string;
}

export interface CloudAgentFileListResponse {
  available: boolean;
  status?: string;
  files: CloudAgentFileItem[];
  note?: string;
}

export interface CloudAgentFileDetail {
  available?: boolean;
  key: string;
  text: string;
  type?: string;
  contentType?: string;
}

export interface CloudAgentTask {
  id: string;
  title: string;
  status: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudAgentTaskListResponse {
  available: boolean;
  status?: string;
  queueConfigured?: boolean;
  tasks: CloudAgentTask[];
}

export interface CloudAgentTaskCreateInput {
  title?: string;
  task?: string;
  message?: string;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CloudAgentTaskCreateResponse {
  ok?: boolean;
  available?: boolean;
  queued?: boolean;
  task?: CloudAgentTask;
  note?: string;
  error?: string;
}

export interface CloudAgentBrowserSnapshotInput {
  url?: string;
  html?: string;
  artifactKey?: string;
  viewport?: {
    width?: number;
    height?: number;
    deviceScaleFactor?: number;
  };
  fullPage?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2" | string;
}

export interface CloudAgentBrowserSnapshotResult {
  ok: boolean;
  status: "captured" | "missing-target" | "missing-configuration" | "browser-rendering-failed" | string;
  artifactKey?: string;
  stored?: boolean;
  url?: string | null;
  screenshot?: boolean;
  htmlCharacters?: number;
  summary?: string;
  artifact?: Record<string, unknown>;
  error?: string;
  requiredPermission?: string;
  docs?: string;
}

export interface CloudAgentBrowserTarget {
  id: string;
  type?: string;
  url?: string;
  title?: string;
  description?: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

export interface CloudAgentBrowserSession {
  sessionId: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
  closeReason?: string;
  closeReasonText?: string;
  connectionId?: string;
  connectionStartTime?: number;
  connectionEndTime?: number;
  startTime?: number;
  endTime?: number;
  lastUpdated?: number;
  targets?: CloudAgentBrowserTarget[];
  [key: string]: unknown;
}

export interface CloudAgentBrowserSessionCreateInput {
  keepAliveMs?: number;
  targets?: boolean;
  url?: string;
  artifactKey?: string;
  recording?: boolean;
}

export interface CloudAgentBrowserSessionsResult {
  ok: boolean;
  status: "listed" | "missing-configuration" | "browser-rendering-failed" | string;
  sessions?: CloudAgentBrowserSession[];
  summary?: string;
  error?: string;
}

export interface CloudAgentBrowserSessionResult {
  ok: boolean;
  status:
    | "created"
    | "ready"
    | "closed"
    | "targets-listed"
    | "target-created"
    | "target-ready"
    | "target-closed"
    | "missing-configuration"
    | "missing-session"
    | "missing-target"
    | "browser-rendering-failed"
    | string;
  sessionId?: string;
  session?: CloudAgentBrowserSession;
  target?: CloudAgentBrowserTarget;
  targets?: CloudAgentBrowserTarget[];
  artifactKey?: string;
  stored?: boolean;
  keepAliveMs?: number;
  summary?: string;
  error?: string;
}

export interface CloudAgentBrowserFrameStreamOptions {
  fps?: number;
  duration?: number;
  quality?: number;
}

export interface CloudAgentBrowserFrameStreamStatus {
  ok: boolean;
  status: "frame-stream-ready" | "missing-websocket" | "missing-configuration" | "browser-rendering-failed" | string;
  sessionId?: string;
  targetId?: string;
  target?: CloudAgentBrowserTarget;
  hasWebSocketDebuggerUrl?: boolean;
  frameStreamUrl?: string;
  fps?: number;
  duration?: number;
  quality?: number;
  summary?: string;
  error?: string;
}

export interface CloudAgentBrowserDiagnosticsInput {
  live?: boolean;
  url?: string;
  keepAliveMs?: number;
  quality?: number;
}

export interface CloudAgentBrowserDiagnosticStage {
  id: string;
  label: string;
  status: "complete" | "warning" | "error" | "skipped" | string;
  summary: string;
  detail?: string;
  at?: string;
}

export interface CloudAgentBrowserDiagnosticsResult {
  ok: boolean;
  status:
    | "configured"
    | "missing-configuration"
    | "api-unavailable"
    | "live-ready"
    | "missing-websocket"
    | "live-check-failed"
    | string;
  mode: "read-only" | "live";
  summary: string;
  stages: CloudAgentBrowserDiagnosticStage[];
  accountIdConfigured?: boolean;
  tokenConfigured?: boolean;
  requiredPermission?: string;
  docs?: string;
  sessionId?: string;
  targetId?: string;
  hasWebSocketDebuggerUrl?: boolean;
  frameCaptured?: boolean;
  frameBytes?: number;
  error?: string;
}

export interface CloudAgentContributionStatus {
  available: boolean;
  endpoint: "/contributions";
  repository: string;
  baseBranch: string;
  tokenConfigured: boolean;
  artifactSourceAvailable?: boolean;
  sandboxSourceAvailable?: boolean;
  mode: "github-pull-request" | string;
  note?: string;
}

export interface CloudAgentContributionChangeInput {
  path: string;
  content?: string;
  text?: string;
}

export interface CloudAgentContributionPullRequestInput {
  title: string;
  body?: string;
  summary?: string;
  baseBranch?: string;
  branchName?: string;
  changes?: CloudAgentContributionChangeInput[];
  artifactKeys?: string[];
  diffArtifactKeys?: string[];
  patchArtifactKeys?: string[];
}

export interface CloudAgentLearningSummary {
  trainMode: {
    command: "/train";
    available: boolean;
    teachMode: boolean;
  };
  memories: {
    available: boolean;
    pending: number;
    items: CloudAgentMemoryItem[];
  };
  skills: {
    available: boolean;
    pending: number;
    suggestions: Array<CloudAgentSkill | CloudAgentLearningSuggestion>;
  };
  suggestions?: {
    pending: number;
    accepted: number;
    rejected: number;
    items: CloudAgentLearningSuggestion[];
  };
  vectorize?: Record<string, unknown>;
}

export type CloudAgentLearningSuggestionStatus = "pending" | "accepted" | "rejected";

export interface CloudAgentLearningSuggestion {
  id: string;
  kind: "memory" | "skill" | "rubric" | "workflow" | string;
  title: string;
  summary: string;
  status: CloudAgentLearningSuggestionStatus;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CloudAgentLearningSuggestionInput {
  kind?: "memory" | "skill" | "rubric" | "workflow" | string;
  title?: string;
  summary: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface CloudAgentExecutorStatus {
  enabled?: boolean;
  configured: boolean;
  status: string;
  transport?: string;
  endpoint?: string;
  mcpServerUrl?: string | null;
  authConfigured?: boolean;
  authTokenConfigured?: boolean;
  defaultTarget?: string;
  cloudEndpoint?: string;
  auth?: string;
  tools?: Record<string, string>;
  availableTools?: Array<Record<string, unknown>>;
  recommendedFor: string[];
}

export interface CloudAgentSandboxDiffInput {
  cwd?: string;
  pathspec?: string | string[];
  staged?: boolean;
  timeoutMs?: number;
  sandboxId?: string;
  artifactKey?: string;
}

export interface CloudAgentSandboxDiffResult {
  ok?: boolean;
  summary?: string;
  stored?: boolean;
  artifactKey?: string | null;
  artifact?: Record<string, unknown> | null;
  stats?: {
    files: number;
    additions: number;
    deletions: number;
    paths: string[];
  };
  patchCharacters?: number;
  patchPreview?: string;
  error?: string;
  [key: string]: unknown;
}

export interface CloudAgentMcpServer {
  id: string;
  label: string;
  transport: "durable-object-rpc" | "https" | "streamable-http" | "unavailable" | string;
  configured: boolean;
  status: string;
  url?: string;
}

export interface CloudAgentMcpAddInput {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface CloudAgentMcpObservationEvent {
  id: string;
  server: string;
  tool: string;
  transport?: string;
  status: "success" | "error" | string;
  latencyMs: number;
  summary: string;
  createdAt?: string;
}

export interface CloudAgentMcpObservationSeriesPoint {
  timestamp: string;
  server: string;
  calls: number;
  failures: number;
  avgLatencyMs: number;
}

export interface CloudAgentMcpObservability {
  available?: boolean;
  status?: string;
  totals?: {
    calls?: number;
    failures?: number;
    servers?: number;
  };
  servers?: Array<CloudAgentMcpServer & {
    calls?: number;
    failures?: number;
    avgLatencyMs?: number;
    lastEvent?: CloudAgentMcpObservationEvent | null;
  }>;
  recentEvents?: CloudAgentMcpObservationEvent[];
  series?: CloudAgentMcpObservationSeriesPoint[];
  note?: string;
}

export interface CloudAgentWorkspaceContextInput {
  text: string;
  type?: "note" | "memory" | "artifact" | "goal" | string;
  source?: string;
  metadata?: Record<string, unknown>;
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
    'await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");',
    "const workspace = await agent.workspace();",
    'await agent.addMcpServer({ name: "team-tools", url: "https://tools.example.com/mcp" });',
    "const mcpActivity = await agent.mcpObservability();",
    'const executorTools = await agent.executor.listTools();',
    'const diff = await agent.executor.captureDiff({ pathspec: ["src", "docs"] });',
    'const memories = await agent.searchMemory("deploy readiness");',
    "const learning = await agent.learning();",
    "const suggestion = learning.suggestions?.items[0];",
    "if (suggestion) await agent.acceptLearningSuggestion(suggestion.id);",
    "const artifacts = await agent.listArtifacts();",
    'await agent.putFile("notes/deploy.md", "# Deploy notes");',
    'await agent.createTask({ title: "Follow release checklist", payload: { lane: "release" } });',
    'const snapshot = await agent.browserSnapshot({ url: "https://developers.cloudflare.com/agents/" });',
    "const browserDiagnostics = await agent.browserDiagnostics();",
    "const liveBrowserDiagnostics = await agent.browser.diagnostics({ live: true });",
    'const browser = await agent.createBrowserSession({ url: "https://developers.cloudflare.com/browser-run/", targets: true });',
    "const contribution = await agent.contributions();",
    "console.log(workspace.workspace.contextSummary, mcpActivity.totals?.calls ?? 0, executorTools.available, diff.artifactKey, memories.memories.length, learning.trainMode.available, artifacts.available, snapshot.artifactKey, browserDiagnostics.status, liveBrowserDiagnostics.status, browser.summary, contribution.repository);",
    "const firstTargetId = browser.target?.id || browser.targets?.[0]?.id;",
    "const frameStatus = browser.sessionId && firstTargetId ? await agent.browser.frameStreamStatus(browser.sessionId, firstTargetId, { fps: 4 }) : null;",
    "const frameStream = browser.sessionId && firstTargetId ? agent.browser.frameStreamUrl(browser.sessionId, firstTargetId, { fps: 4 }) : null;",
    "await agent.createContributionPullRequest({",
    '  title: "Apply Sandbox changes",',
    "  diffArtifactKeys: [diff.artifactKey!]",
    "});"
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

  workspace(): Promise<{ workspace: CloudAgentWorkspace; context: Record<string, unknown> }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.workspace);
  }

  addWorkspaceContext(input: CloudAgentWorkspaceContextInput): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.workspace, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  listSkills(): Promise<{
    available: boolean;
    skills: CloudAgentSkill[];
    sources?: string[];
    note?: string;
  }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.skills);
  }

  listMemory(limit?: number): Promise<CloudAgentMemoryResponse> {
    const suffix = typeof limit === "number" ? "?limit=" + encodeURIComponent(String(limit)) : "";
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.memory + suffix);
  }

  searchMemory(query: string, limit?: number): Promise<CloudAgentMemorySearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (typeof limit === "number") params.set("limit", String(limit));
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.memory + "?" + params.toString());
  }

  addMemory(text: string): Promise<{ ok?: boolean; memory?: CloudAgentMemoryItem; semantic?: Record<string, unknown>; error?: string }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.memory, {
      method: "POST",
      body: JSON.stringify({ text })
    });
  }

  listArtifacts(): Promise<{
    available: boolean;
    artifacts: CloudAgentArtifactItem[];
    binding?: string;
    note?: string;
  }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.artifacts);
  }

  getArtifact(key: string, options: { versionKey?: string; includeVersions?: boolean } = {}): Promise<CloudAgentArtifactDetail> {
    const params = new URLSearchParams({ key });
    if (options.versionKey) params.set("version", options.versionKey);
    if (options.includeVersions ?? true) params.set("versions", "1");
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.artifacts + "?" + params.toString());
  }

  putArtifact(key: string, text: string, contentType = "text/markdown"): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.artifacts, {
      method: "POST",
      body: JSON.stringify({ key, text, contentType })
    });
  }

  listFiles(): Promise<CloudAgentFileListResponse> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.files);
  }

  getFile(key: string): Promise<string> {
    return this.requestText(hostedCloudAgentSdkDescriptor.endpoints.files + "?key=" + encodeURIComponent(key));
  }

  getFileJson(key: string): Promise<CloudAgentFileDetail> {
    const params = new URLSearchParams({ key, json: "1" });
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.files + "?" + params.toString());
  }

  putFile(key: string, text: string): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.files, {
      method: "POST",
      body: JSON.stringify({ key, text })
    });
  }

  listTasks(): Promise<CloudAgentTaskListResponse> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.tasks);
  }

  createTask(input: CloudAgentTaskCreateInput): Promise<CloudAgentTaskCreateResponse> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.tasks, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  readonly files = {
    list: (): Promise<CloudAgentFileListResponse> => this.listFiles(),
    get: (key: string): Promise<string> => this.getFile(key),
    getJson: (key: string): Promise<CloudAgentFileDetail> => this.getFileJson(key),
    put: (key: string, text: string): Promise<Record<string, unknown>> => this.putFile(key, text)
  };

  readonly tasks = {
    list: (): Promise<CloudAgentTaskListResponse> => this.listTasks(),
    create: (input: CloudAgentTaskCreateInput): Promise<CloudAgentTaskCreateResponse> => this.createTask(input)
  };

  browserSnapshot(input: CloudAgentBrowserSnapshotInput): Promise<CloudAgentBrowserSnapshotResult> {
    return this.requestBrowserSnapshot({
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  browserDiagnostics(input: CloudAgentBrowserDiagnosticsInput = {}): Promise<CloudAgentBrowserDiagnosticsResult> {
    const live = input.live === true;
    return this.requestBrowserOperation<CloudAgentBrowserDiagnosticsResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserDiagnostics,
      live
        ? {
            method: "POST",
            body: JSON.stringify(input)
          }
        : undefined
    );
  }

  listBrowserSessions(options: { limit?: number; offset?: number } = {}): Promise<CloudAgentBrowserSessionsResult> {
    const params = new URLSearchParams();
    if (typeof options.limit === "number") params.set("limit", String(options.limit));
    if (typeof options.offset === "number") params.set("offset", String(options.offset));
    const suffix = params.toString() ? "?" + params.toString() : "";
    return this.requestBrowserOperation<CloudAgentBrowserSessionsResult>(hostedCloudAgentSdkDescriptor.endpoints.browserSessions + suffix);
  }

  createBrowserSession(input: CloudAgentBrowserSessionCreateInput = {}): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(hostedCloudAgentSdkDescriptor.endpoints.browserSessions, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  getBrowserSession(sessionId: string): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions + "/" + encodeURIComponent(sessionId)
    );
  }

  closeBrowserSession(sessionId: string): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(hostedCloudAgentSdkDescriptor.endpoints.browserSessions + "/" + encodeURIComponent(sessionId), {
      method: "DELETE"
    });
  }

  listBrowserSessionTargets(sessionId: string): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions + "/" + encodeURIComponent(sessionId) + "/targets"
    );
  }

  createBrowserSessionTarget(sessionId: string, input: { url?: string } = {}): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions + "/" + encodeURIComponent(sessionId) + "/targets",
      {
        method: "POST",
        body: JSON.stringify(input)
      }
    );
  }

  getBrowserSessionTarget(sessionId: string, targetId: string): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions +
        "/" +
        encodeURIComponent(sessionId) +
        "/targets/" +
        encodeURIComponent(targetId)
    );
  }

  closeBrowserSessionTarget(sessionId: string, targetId: string): Promise<CloudAgentBrowserSessionResult> {
    return this.requestBrowserOperation<CloudAgentBrowserSessionResult>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions +
        "/" +
        encodeURIComponent(sessionId) +
        "/targets/" +
        encodeURIComponent(targetId),
      { method: "DELETE" }
    );
  }

  browserFrameStreamUrl(
    sessionId: string,
    targetId: string,
    options: CloudAgentBrowserFrameStreamOptions = {}
  ): string {
    const params = new URLSearchParams();
    if (options.fps !== undefined) params.set("fps", String(options.fps));
    if (options.duration !== undefined) params.set("duration", String(options.duration));
    if (options.quality !== undefined) params.set("quality", String(options.quality));
    const suffix = params.toString() ? "?" + params.toString() : "";
    return this.baseUrl +
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions +
      "/" +
      encodeURIComponent(sessionId) +
      "/targets/" +
      encodeURIComponent(targetId) +
      "/frames" +
      suffix;
  }

  browserFrameStreamStatus(
    sessionId: string,
    targetId: string,
    options: CloudAgentBrowserFrameStreamOptions = {}
  ): Promise<CloudAgentBrowserFrameStreamStatus> {
    const params = new URLSearchParams();
    if (options.fps !== undefined) params.set("fps", String(options.fps));
    if (options.duration !== undefined) params.set("duration", String(options.duration));
    if (options.quality !== undefined) params.set("quality", String(options.quality));
    const suffix = params.toString() ? "?" + params.toString() : "";
    return this.requestBrowserOperation<CloudAgentBrowserFrameStreamStatus>(
      hostedCloudAgentSdkDescriptor.endpoints.browserSessions +
        "/" +
        encodeURIComponent(sessionId) +
        "/targets/" +
        encodeURIComponent(targetId) +
        "/frames/status" +
        suffix
    );
  }

  readonly browser = {
    snapshot: (input: CloudAgentBrowserSnapshotInput): Promise<CloudAgentBrowserSnapshotResult> => this.browserSnapshot(input),
    diagnostics: (input?: CloudAgentBrowserDiagnosticsInput): Promise<CloudAgentBrowserDiagnosticsResult> =>
      this.browserDiagnostics(input),
    listSessions: (options?: { limit?: number; offset?: number }): Promise<CloudAgentBrowserSessionsResult> =>
      this.listBrowserSessions(options),
    createSession: (input?: CloudAgentBrowserSessionCreateInput): Promise<CloudAgentBrowserSessionResult> =>
      this.createBrowserSession(input),
    getSession: (sessionId: string): Promise<CloudAgentBrowserSessionResult> => this.getBrowserSession(sessionId),
    closeSession: (sessionId: string): Promise<CloudAgentBrowserSessionResult> => this.closeBrowserSession(sessionId),
    listTargets: (sessionId: string): Promise<CloudAgentBrowserSessionResult> => this.listBrowserSessionTargets(sessionId),
    createTarget: (sessionId: string, input?: { url?: string }): Promise<CloudAgentBrowserSessionResult> =>
      this.createBrowserSessionTarget(sessionId, input),
    getTarget: (sessionId: string, targetId: string): Promise<CloudAgentBrowserSessionResult> =>
      this.getBrowserSessionTarget(sessionId, targetId),
    closeTarget: (sessionId: string, targetId: string): Promise<CloudAgentBrowserSessionResult> =>
      this.closeBrowserSessionTarget(sessionId, targetId),
    frameStreamStatus: (
      sessionId: string,
      targetId: string,
      options?: CloudAgentBrowserFrameStreamOptions
    ): Promise<CloudAgentBrowserFrameStreamStatus> =>
      this.browserFrameStreamStatus(sessionId, targetId, options),
    frameStreamUrl: (sessionId: string, targetId: string, options?: CloudAgentBrowserFrameStreamOptions): string =>
      this.browserFrameStreamUrl(sessionId, targetId, options)
  };

  contributions(): Promise<CloudAgentContributionStatus> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.contributions);
  }

  createContributionPullRequest(input: CloudAgentContributionPullRequestInput): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.contributions, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  learning(): Promise<CloudAgentLearningSummary> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.learning);
  }

  createLearningSuggestion(input: CloudAgentLearningSuggestionInput): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.learning, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  curateLearningSuggestion(
    id: string,
    input: { status: CloudAgentLearningSuggestionStatus; title?: string; summary?: string }
  ): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.learning + "/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(input)
    });
  }

  acceptLearningSuggestion(id: string): Promise<Record<string, unknown>> {
    return this.curateLearningSuggestion(id, { status: "accepted" });
  }

  rejectLearningSuggestion(id: string): Promise<Record<string, unknown>> {
    return this.curateLearningSuggestion(id, { status: "rejected" });
  }

  executorStatus(): Promise<CloudAgentExecutorStatus> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.executor);
  }

  readonly executor = {
    status: (): Promise<CloudAgentExecutorStatus> => this.executorStatus(),
    listTools: (): Promise<Record<string, unknown>> => this.listMcpTools("executor"),
    callTool: (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> =>
      this.callMcpTool("executor", name, args),
    captureDiff: (input: CloudAgentSandboxDiffInput = {}): Promise<CloudAgentSandboxDiffResult> =>
      this.callMcpTool("executor", "sandbox_diff", { ...input }) as Promise<CloudAgentSandboxDiffResult>
  };

  listMcpServers(): Promise<{ servers: CloudAgentMcpServer[] }> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.servers);
  }

  mcpState<T = Record<string, unknown>>(): Promise<T> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.state);
  }

  mcpObservability(options: { includeSeries?: boolean } = {}): Promise<CloudAgentMcpObservability> {
    const suffix = options.includeSeries ? "?series=1" : "";
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.observability + suffix);
  }

  addMcpServer(input: CloudAgentMcpAddInput): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.add, {
      method: "POST",
      body: JSON.stringify(input)
    });
  }

  listMcpTools(server?: string): Promise<Record<string, unknown>> {
    const suffix = server ? "?server=" + encodeURIComponent(server) : "";
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.tools + suffix);
  }

  callMcpTool(server: string, name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.request(hostedCloudAgentSdkDescriptor.endpoints.mcp.call, {
      method: "POST",
      body: JSON.stringify({ server, name, args })
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchRaw(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = typeof data.error === "string" ? data.error : "Hosted Cloud Agent request failed.";
      throw new Error(error);
    }
    return data as T;
  }

  private async requestText(path: string, init?: RequestInit): Promise<string> {
    const response = await this.fetchRaw(path, init);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = typeof data.error === "string" ? data.error : "Hosted Cloud Agent text request failed.";
      throw new Error(error);
    }
    return response.text();
  }

  private async requestBrowserSnapshot(init: RequestInit): Promise<CloudAgentBrowserSnapshotResult> {
    const response = await this.fetchRaw(hostedCloudAgentSdkDescriptor.endpoints.browserSnapshot, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data && typeof data === "object" && "ok" in data) {
      return data as CloudAgentBrowserSnapshotResult;
    }
    if (!response.ok) {
      const error = typeof data.error === "string" ? data.error : "Browser snapshot request failed.";
      throw new Error(error);
    }
    return data as CloudAgentBrowserSnapshotResult;
  }

  private async requestBrowserOperation<T extends CloudAgentBrowserSessionResult | CloudAgentBrowserSessionsResult | CloudAgentBrowserDiagnosticsResult>(
    path: string,
    init?: RequestInit
  ): Promise<T> {
    const response = await this.fetchRaw(path, init);
    const data = await response.json().catch(() => ({}));
    if (!response.ok && data && typeof data === "object" && "ok" in data) {
      return data as T;
    }
    if (!response.ok) {
      const error = typeof data.error === "string" ? data.error : "Browser session request failed.";
      throw new Error(error);
    }
    return data as T;
  }

  private async fetchRaw(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(await this.resolveHeaders());
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    if (init?.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchImpl(this.baseUrl + path, {
      ...init,
      headers
    });
    return response;
  }

  private async resolveHeaders(): Promise<HeadersInit> {
    if (!this.headers) return {};
    if (typeof this.headers === "function") return this.headers();
    return this.headers;
  }
}
