import type { DeploymentRequest } from "./deployment-engine";
import {
  normalizePersonalAgentConfig,
  personalAgentPublicConfigBindingText,
  publicPersonalAgentConfig
} from "./personal-agent-options";

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

export interface AgentsSdkRuntimeRenderInput {
  request: DeploymentRequest;
  deploymentId: string;
  bindings: AgentsSdkRuntimeBindingPlan;
  sourceSha?: string;
}

export function renderAgentsSdkPersonalAgentRuntime(
  input: AgentsSdkRuntimeRenderInput
): AgentsSdkRuntimeFile[] {
  return [
    {
      path: "package.json",
      contents: `${JSON.stringify(renderPackageJson(), null, 2)}\n`
    },
    {
      path: "tsconfig.json",
      contents: `${JSON.stringify(renderTsconfigJson(), null, 2)}\n`
    },
    {
      path: "wrangler.jsonc",
      contents: `${JSON.stringify(renderAgentsSdkWranglerJsonc(input), null, 2)}\n`
    },
    {
      path: "index.html",
      contents: renderIndexHtml(input)
    },
    {
      path: "src/client-env.d.ts",
      contents: 'declare module "*.css";\n'
    },
    {
      path: "src/client.css",
      contents: renderClientCss()
    },
    {
      path: "src/client.tsx",
      contents: renderClientTsx(input)
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
      build: "vite build --outDir dist/client --emptyOutDir",
      dev: "vite build --outDir dist/client --emptyOutDir && wrangler dev",
      deploy: "vite build --outDir dist/client --emptyOutDir && wrangler deploy",
      typecheck: "tsc --noEmit"
    },
    dependencies: {
      "@ai-sdk/react": "^3.0.0",
      "@cloudflare/ai-chat": "^0.6.2",
      agents: "^0.12.3",
      ai: "^6.0.174",
      react: "^19.2.5",
      "react-dom": "^19.2.5",
      streamdown: "^2.5.0",
      zod: "^4.4.2",
      "workers-ai-provider": "^3.1.13"
    },
    devDependencies: {
      "@types/react": "latest",
      "@types/react-dom": "latest",
      typescript: "latest",
      vite: "latest",
      wrangler: "latest"
    }
  };
}

function renderTsconfigJson(): Record<string, unknown> {
  return {
    compilerOptions: {
      target: "ES2022",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      skipLibCheck: true,
      jsx: "react-jsx",
      noEmit: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      isolatedModules: true
    },
    include: ["src/**/*.ts", "src/**/*.tsx"]
  };
}

export function renderAgentsSdkWranglerJsonc(
  input: AgentsSdkRuntimeRenderInput
): Record<string, unknown> {
  const personalAgent = normalizePersonalAgentConfig(input.request.personalAgent);
  return {
    name: input.bindings.scriptName,
    main: "src/server.ts",
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      directory: "dist/client",
      binding: "ASSETS"
    },
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
      OPEN_THINK_PERSONAL_AGENT_CONFIG: personalAgentPublicConfigBindingText(input.request.personalAgent),
      OPEN_THINK_TOOL_APPROVAL_POLICY: personalAgent.toolApprovalPolicy,
      OPEN_THINK_CF_ACCOUNT_ID: input.request.cloudflareAccountId?.trim() ?? "",
      ...(input.sourceSha ? { OPEN_THINK_SOURCE_SHA: input.sourceSha } : {})
    }
  };
}

function renderIndexHtml(input: {
  request: DeploymentRequest;
}): string {
  const title = escapeHtml(input.request.agentName?.trim() || "Personal Agent");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/client.tsx"></script>
  </body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function renderClientCss(): string {
  return `:root {
  color-scheme: light;
  --bg: #f5f1e8;
  --surface: #fffcf5;
  --surface-strong: #ffffff;
  --ink: #151716;
  --ink-soft: #4d5752;
  --muted: #797f78;
  --line: #d8d0c1;
  --line-strong: #bdb4a5;
  --accent: #df6f21;
  --accent-strong: #b84d12;
  --blue: #2d5f9a;
  --green: #176f49;
  --red: #b43b35;
  --mono: "SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace;
  --sans: "Aptos", "Segoe UI Variable", "Segoe UI", Arial, sans-serif;
  --radius: 8px;
  --radius-sm: 6px;
}

* {
  box-sizing: border-box;
}

html {
  min-width: 320px;
  min-height: 100%;
  background: var(--bg);
}

body {
  margin: 0;
  min-height: 100dvh;
  overflow: hidden;
  color: var(--ink);
  font-family: var(--sans);
  background:
    linear-gradient(90deg, rgba(21, 23, 22, 0.045) 1px, transparent 1px),
    linear-gradient(rgba(21, 23, 22, 0.04) 1px, transparent 1px),
    var(--bg);
  background-size: 38px 38px;
}

button,
input,
textarea {
  font: inherit;
}

button {
  cursor: pointer;
}

:focus-visible {
  outline: 3px solid rgba(223, 111, 33, 0.42);
  outline-offset: 3px;
}

.app {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100dvh;
  min-height: 0;
  overflow: hidden;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
  padding: 14px clamp(14px, 4vw, 34px);
  background: rgba(245, 241, 232, 0.9);
  backdrop-filter: blur(16px);
}

.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.mark {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  color: var(--accent-strong);
  background: var(--surface);
  font-family: var(--mono);
  font-weight: 800;
}

.brand strong,
.brand small {
  display: block;
}

.brand small {
  margin-top: 2px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.pill {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  min-height: 30px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 0 9px;
  color: var(--ink-soft);
  background: var(--surface-strong);
  font-family: var(--mono);
  font-size: 0.74rem;
  text-transform: uppercase;
}

.pill[data-state="connected"],
.pill[data-state="ready"] {
  border-color: rgba(23, 111, 73, 0.28);
  color: var(--green);
  background: rgba(23, 111, 73, 0.08);
}

.pill[data-state="streaming"],
.pill[data-state="submitted"],
.pill[data-state="waiting-approval"] {
  border-color: rgba(45, 95, 154, 0.28);
  color: var(--blue);
  background: rgba(45, 95, 154, 0.08);
}

.pill[data-state="disconnected"],
.pill[data-state="error"],
.pill[data-state="denied"] {
  border-color: rgba(180, 59, 53, 0.28);
  color: var(--red);
  background: rgba(180, 59, 53, 0.08);
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(270px, 340px);
  gap: 16px;
  min-height: 0;
  height: 100%;
  width: min(1440px, calc(100% - 28px));
  margin: 0 auto;
  padding: 16px 0;
}

.chat-panel,
.side-panel {
  min-width: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 16px 38px rgba(37, 31, 23, 0.08);
}

.chat-panel {
  display: grid;
  grid-template-rows: auto 1fr auto;
  min-height: 0;
  overflow: hidden;
}

.panel-header {
  border-bottom: 1px solid var(--line);
  padding: 16px;
}

.panel-header h1,
.panel-header h2 {
  margin: 0;
  letter-spacing: 0;
}

.panel-header h1 {
  font-size: clamp(1.4rem, 2vw, 2rem);
}

.panel-header p {
  margin: 7px 0 0;
  color: var(--ink-soft);
  line-height: 1.42;
}

.message-list {
  display: grid;
  gap: 12px;
  align-content: start;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  scrollbar-gutter: stable;
  scroll-behavior: smooth;
}

.empty-state {
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
  padding: 16px;
  color: var(--ink-soft);
  background: rgba(255, 252, 245, 0.66);
}

.message {
  display: grid;
  gap: 7px;
  max-width: min(820px, 92%);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px 14px;
  background: var(--surface-strong);
  line-height: 1.5;
}

.message[data-role="user"] {
  justify-self: end;
  border-color: rgba(223, 111, 33, 0.34);
  background: #fff4e9;
}

.message small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.text-part {
  display: grid;
  gap: 0.72rem;
  overflow-wrap: anywhere;
}

.text-part :where(p, ul, ol, blockquote, pre, table, h1, h2, h3, h4, hr) {
  margin: 0;
}

.text-part :where([data-streamdown]) {
  max-width: 100%;
}

.text-part :where(h1, h2, h3, h4) {
  line-height: 1.2;
}

.text-part h1 {
  font-size: 1.2rem;
}

.text-part h2 {
  font-size: 1.08rem;
}

.text-part h3,
.text-part h4 {
  font-size: 0.98rem;
}

.text-part :where(ul, ol) {
  display: grid;
  gap: 0.35rem;
  padding-left: 1.2rem;
}

.text-part :where(li) {
  padding-left: 0.1rem;
}

.text-part :where(a) {
  color: var(--blue);
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.text-part :where(blockquote) {
  border-left: 3px solid rgba(45, 95, 154, 0.28);
  padding-left: 0.85rem;
  color: var(--ink-soft);
}

.text-part :where(code):not(pre code) {
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 0.08rem 0.28rem;
  background: rgba(21, 23, 22, 0.05);
  font-family: var(--mono);
  font-size: 0.88em;
}

.text-part table {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.text-part :where(th, td) {
  border: 1px solid var(--line);
  padding: 0.44rem 0.55rem;
  text-align: left;
  vertical-align: top;
}

.text-part th {
  background: rgba(21, 23, 22, 0.04);
}

.text-part hr {
  border: 0;
  border-top: 1px solid var(--line);
}

.tool-part {
  display: grid;
  gap: 10px;
  border: 1px solid rgba(45, 95, 154, 0.22);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: rgba(45, 95, 154, 0.06);
}

.tool-part[data-state="waiting-approval"] {
  border-color: rgba(223, 111, 33, 0.34);
  background: rgba(223, 111, 33, 0.08);
}

.tool-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.tool-heading strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: var(--mono);
  font-size: 0.82rem;
}

.tool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tool-actions .button {
  min-height: 36px;
}

.tool-note {
  margin: 0;
  color: var(--ink-soft);
}

.tool-output-label {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

pre {
  overflow: auto;
  max-width: 100%;
  margin: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: #f7efe4;
  background: #151716;
  font-family: var(--mono);
  font-size: 0.78rem;
  line-height: 1.45;
}

.composer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding: 14px;
}

.composer textarea {
  min-height: 44px;
  max-height: 144px;
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 11px 12px;
  color: var(--ink);
  background: var(--surface-strong);
  line-height: 1.38;
  resize: vertical;
}

.composer textarea:disabled {
  color: var(--muted);
  background: rgba(255, 252, 245, 0.6);
}

.button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 0 13px;
  color: var(--ink);
  background: var(--surface-strong);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.button-compact {
  min-height: 34px;
  padding: 0 10px;
  font-size: 0.86rem;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.56;
}

.button-primary {
  border-color: var(--accent-strong);
  color: #fffaf2;
  background: var(--accent-strong);
}

.button-danger {
  border-color: rgba(180, 59, 53, 0.32);
  color: var(--red);
  background: rgba(180, 59, 53, 0.08);
}

.side-panel {
  display: grid;
  align-content: start;
  max-height: 100%;
  overflow: auto;
}

.side-body {
  display: grid;
  gap: 10px;
  padding: 14px;
}

.metric {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 11px;
  background: rgba(255, 252, 245, 0.72);
}

.metric span {
  display: block;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.metric strong {
  display: block;
  overflow: hidden;
  margin-top: 5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.error {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid rgba(180, 59, 53, 0.28);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: var(--red);
  background: rgba(180, 59, 53, 0.08);
}

@media (max-width: 900px) {
  body {
    overflow: auto;
  }

  .app {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }

  .workspace {
    grid-template-columns: 1fr;
    height: auto;
  }

  .chat-panel {
    min-height: calc(100dvh - 112px);
  }

  .side-panel {
    max-height: none;
    overflow: visible;
  }
}

@media (max-width: 620px) {
  .workspace {
    width: min(100% - 18px, 1440px);
    padding-top: 12px;
  }

  .composer {
    grid-template-columns: 1fr;
  }

  .message {
    max-width: 100%;
  }
}
`;
}

function renderClientTsx(input: {
  request: DeploymentRequest;
  deploymentId: string;
}): string {
  const personalAgent = normalizePersonalAgentConfig(input.request.personalAgent);
  const clientConfig = {
    agentName: input.request.agentName?.trim() || "Personal Agent",
    deploymentId: input.deploymentId,
    defaultModel: input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6",
    toolApprovalPolicy: personalAgent.toolApprovalPolicy
  };

  return `import { FormEvent, KeyboardEvent, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useAgent } from "agents/react";
import {
  getToolApproval,
  getToolCallId,
  getToolInput,
  getToolOutput,
  getToolPartState,
  useAgentChat
} from "@cloudflare/ai-chat/react";
import {
  getToolName,
  isTextUIPart,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage
} from "ai";
import "./client.css";

const MarkdownRenderer = lazy(async () => {
  const { Streamdown } = await import("streamdown");
  return {
    default: function MarkdownRenderer({ children }: { children: string }) {
      return <Streamdown controls={false}>{children}</Streamdown>;
    }
  };
});

const clientConfig = ${JSON.stringify(clientConfig, null, 2)} as const;

function App() {
  return (
    <main className="app">
      <Chat />
    </main>
  );
}

function Chat() {
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerState>>({});
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const messageListEndRef = useRef<HTMLDivElement | null>(null);
  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    onMcpUpdate: (servers) => setMcpServers(servers as Record<string, McpServerState>)
  });
  const {
    messages,
    sendMessage,
    clearHistory,
    stop,
    regenerate,
    clearError,
    addToolApprovalResponse,
    status,
    error,
    isStreaming,
    isServerStreaming,
    isToolContinuation
  } = useAgentChat({
    agent,
    autoContinueAfterToolResult: false,
    resume: false,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName !== "getUserTimezone") return;

      addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: browserTimeContext()
      });
    }
  });

  const connectionState = readyStateLabel(agent.readyState);
  const connected = agent.readyState === WebSocket.OPEN;
  const busy = status === "submitted" || status === "streaming" || isStreaming || isServerStreaming;
  const pendingApprovalCount = countPendingApprovals(messages);
  const mcpServerValues = Object.values(mcpServers);
  const mcpReadyCount = mcpServerValues.filter((server) => isMcpReady(server)).length;
  const alwaysAllowedToolCount = alwaysAllowedTools.size;
  const activityLabel = busy ? (isToolContinuation ? "Continuing tool" : "Streaming") : "Idle";
  const approvalToolCallIds = useMemo(() => indexPendingApprovals(messages), [messages]);
  const approvalErrorMessage =
    error?.message ?? null;
  const canRetry =
    connected &&
    !busy &&
    pendingApprovalCount === 0 &&
    messages.some((message) => message.role === "user");

  useEffect(() => {
    messageListEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status, isStreaming, isServerStreaming]);

  const respondToToolApproval = useCallback(
    (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => {
      if (!approvalId || !toolCallId) return false;
      if (approvalToolCallIds.get(approvalId) !== toolCallId) {
        console.warn("[open-think] Ignoring stale tool approval " + approvalId + ".");
        return false;
      }
      if (agent.readyState !== WebSocket.OPEN) {
        console.warn("[open-think] Cannot send tool approval while the agent socket is not connected.");
        return false;
      }

      clearError();
      try {
        void Promise.resolve(addToolApprovalResponse({ id: approvalId, approved })).catch((approvalError: unknown) => {
          console.warn("[open-think] Failed to send tool approval.", approvalError);
        });
      } catch (approvalError) {
        console.warn("[open-think] Failed to send tool approval.", approvalError);
        return false;
      }
      return true;
    },
    [addToolApprovalResponse, agent.readyState, approvalToolCallIds, clearError]
  );

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

        const approval = getToolApproval(part);
        const toolCallId = getToolCallId(part);
        const toolName = getToolName(part);
        if (!approval?.id || !alwaysAllowedTools.has(toolApprovalPreferenceKey(toolName))) continue;
        if (autoApprovedApprovalIdsRef.current.has(approval.id)) continue;

        if (respondToToolApproval(approval.id, toolCallId, true)) {
          autoApprovedApprovalIdsRef.current.add(approval.id);
        }
      }
    }
  }, [alwaysAllowedTools, messages, respondToToolApproval]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("message") as HTMLTextAreaElement | null;
    const text = input?.value.trim();
    if (!text || !connected || busy) return;
    sendMessage({ text });
    if (input) input.value = "";
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearHistory();
    }
  }

  function onRetry() {
    if (!canRetry) return;
    clearError();
    void Promise.resolve(regenerate()).catch((retryError: unknown) => {
      console.error("[useAgentChat] Retry failed", retryError);
    });
  }

  function approveToolAlways(toolName: string, approvalId?: string) {
    const preferenceKey = toolApprovalPreferenceKey(toolName);

    setAlwaysAllowedTools((previous) => {
      if (previous.has(preferenceKey)) return previous;
      const next = new Set(previous);
      next.add(preferenceKey);
      writeAlwaysAllowedTools(next);
      return next;
    });

    if (approvalId && !autoApprovedApprovalIdsRef.current.has(approvalId)) {
      const toolCallId = approvalToolCallIds.get(approvalId);
      if (respondToToolApproval(approvalId, toolCallId, true)) {
        autoApprovedApprovalIdsRef.current.add(approvalId);
      }
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function onClearToolAllowlist() {
    const next = new Set<string>();
    writeAlwaysAllowedTools(next);
    setAlwaysAllowedTools(next);
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="mark">ot</div>
          <div>
            <strong>{clientConfig.agentName}</strong>
            <small>{clientConfig.deploymentId}</small>
          </div>
        </div>
        <div className="status-strip" aria-label="Agent status">
          <span className="pill" data-state={connectionState.toLowerCase()}>{connectionState}</span>
          <span className="pill" data-state={status}>{activityLabel}</span>
          {pendingApprovalCount > 0 ? (
            <span className="pill" data-state="waiting-approval">{pendingApprovalCount} approval pending</span>
          ) : null}
          <span className="pill">AIChatAgent WebSocket</span>
        </div>
      </header>

      <section className="workspace" aria-label="Personal agent workspace">
        <section className="chat-panel" aria-busy={busy} aria-label="Chat">
          <div className="panel-header">
            <h1>Conversation</h1>
            <p>Streaming, message persistence, client tools, and approvals are handled by Cloudflare Agents SDK.</p>
          </div>

          <div className="message-list" aria-live="polite" role="log">
            {messages.length === 0 ? (
              <div className="empty-state">
                Ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              messages.map((message) => (
                <Message
                  approveToolAlways={approveToolAlways}
                  key={message.id}
                  message={message}
                  respondToToolApproval={respondToToolApproval}
                />
              ))
            )}
            {approvalErrorMessage ? (
              <div className="error" role="alert">
                <span>{approvalErrorMessage}</span>
                <div className="button-row">
                  <button className="button button-compact" onClick={clearError} type="button">
                    Dismiss
                  </button>
                  {messages.length > 0 && pendingApprovalCount === 0 ? (
                    <button
                      className="button button-compact"
                      disabled={!canRetry}
                      onClick={onRetry}
                      type="button"
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div ref={messageListEndRef} />
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              onKeyDown={onComposerKeyDown}
              placeholder={connected ? "Ask your agent to inspect, remember, plan, or operate..." : "Reconnect to continue..."}
              rows={1}
            />
            <button className="button button-primary" disabled={!connected || busy} type="submit">
              {busy ? "Working" : "Send"}
            </button>
          </form>
        </section>

        <aside className="side-panel" aria-label="Runtime details">
          <div className="panel-header">
            <h2>Runtime</h2>
            <p>Native SDK chat channel for this deployed agent.</p>
          </div>
          <div className="side-body">
            <Metric label="Transport" value="useAgent WebSocket" />
            <Metric label="Chat lifecycle" value="useAgentChat" />
            <Metric label="Model" value={clientConfig.defaultModel} />
            <Metric label="MCP policy" value={formatToolApprovalPolicy(clientConfig.toolApprovalPolicy)} />
            <Metric label="History" value="SQLite persisted" />
            <Metric label="MCP servers" value={formatMcpStatus(mcpReadyCount, mcpServerValues.length)} />
            <Metric label="Approvals" value={pendingApprovalCount ? String(pendingApprovalCount) + " pending" : "None pending"} />
            <Metric label="Tool allowlist" value={formatToolAllowlist(alwaysAllowedToolCount)} />
            <div className="button-row">
              {busy ? (
                <button className="button" onClick={stop} type="button">
                  Stop
                </button>
              ) : null}
              <button
                className="button"
                disabled={connected || agent.readyState === WebSocket.CONNECTING}
                onClick={() => agent.reconnect()}
                type="button"
              >
                Reconnect
              </button>
            </div>
            {alwaysAllowedToolCount > 0 ? (
              <button className="button" onClick={onClearToolAllowlist} type="button">
                Clear tool allowlist
              </button>
            ) : null}
            <button className="button button-danger" disabled={messages.length === 0} onClick={onClearHistory} type="button">
              Clear history
            </button>
          </div>
        </aside>
      </section>
    </>
  );
}

function Message({
  approveToolAlways,
  message,
  respondToToolApproval
}: {
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  message: UIMessage;
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  return (
    <article className="message" data-role={message.role}>
      <small>{message.role}</small>
      {message.parts.map((part, index) => (
        <MessagePart
          approveToolAlways={approveToolAlways}
          key={partKey(part, index)}
          part={part}
          respondToToolApproval={respondToToolApproval}
        />
      ))}
    </article>
  );
}

function MessagePart({
  approveToolAlways,
  part,
  respondToToolApproval
}: {
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  part: UIMessage["parts"][number];
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  if (isTextUIPart(part)) {
    return (
      <div className="text-part">
        <Suspense fallback={<p>{part.text}</p>}>
          <MarkdownRenderer>{part.text}</MarkdownRenderer>
        </Suspense>
      </div>
    );
  }

  if (isToolUIPart(part)) {
    const toolCallId = getToolCallId(part);
    const state = getToolPartState(part);
    const toolName = getToolName(part);
    const input = getToolInput(part);
    const output = getToolOutput(part);
    const approval = getToolApproval(part);
    const canRespondToApproval = Boolean(approval?.id && toolCallId);

    return (
      <div className="tool-part" data-state={state}>
        <div className="tool-heading">
          <strong>{toolName}</strong>
          <span className="pill" data-state={state}>{state}</span>
        </div>
        {input ? <pre>{formatJson(input)}</pre> : null}
        {state === "waiting-approval" ? (
          <>
            <p className="tool-note">
              {approval
                ? "Auto asks for risky or unknown MCP tools. Approve once, always allow this tool in this browser, or reject."
                : "This tool is waiting for approval, but no approval ID was provided."}
            </p>
            <div className="tool-actions">
              <button
                className="button button-primary"
                disabled={!canRespondToApproval}
                onClick={() => respondToToolApproval(approval?.id, toolCallId, true)}
                type="button"
              >
                Approve once
              </button>
              <button
                className="button"
                disabled={!canRespondToApproval}
                onClick={() => approveToolAlways(toolName, approval?.id)}
                type="button"
              >
                Always allow tool
              </button>
              <button
                className="button"
                disabled={!canRespondToApproval}
                onClick={() => respondToToolApproval(approval?.id, toolCallId, false)}
                type="button"
              >
                Reject
              </button>
            </div>
          </>
        ) : null}
        {state === "denied" ? <p className="tool-note">Rejected by owner.</p> : null}
        {output ? (
          <>
            <span className="tool-output-label">Output</span>
            <pre>{formatJson(output)}</pre>
          </>
        ) : null}
      </div>
    );
  }

  return null;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function browserTimeContext() {
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    localTime: new Date().toLocaleString()
  };
}

const alwaysAllowedToolsStorageKey = "open-think:always-allowed-tools";

function toolApprovalPreferenceKey(toolName: string): string {
  return toolName.replace(/^tool_[a-z0-9]+_/i, "") || toolName;
}

function readAlwaysAllowedTools(): Set<string> {
  if (typeof window === "undefined") return new Set();

  try {
    const raw = window.localStorage.getItem(alwaysAllowedToolsStorageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    );
  } catch {
    return new Set();
  }
}

function writeAlwaysAllowedTools(tools: Set<string>) {
  try {
    window.localStorage.setItem(alwaysAllowedToolsStorageKey, JSON.stringify([...tools].sort()));
  } catch {
    // Ignore storage failures so approvals still work in private or restricted browsers.
  }
}

function readyStateLabel(value: number) {
  if (value === WebSocket.OPEN) return "Connected";
  if (value === WebSocket.CONNECTING) return "Connecting";
  if (value === WebSocket.CLOSING) return "Closing";
  return "Disconnected";
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

type McpServerState = {
  connectionState?: string;
  state?: string;
  tools?: unknown[];
};

function countPendingApprovals(messages: UIMessage[]) {
  return messages.reduce(
    (total, message) =>
      total +
      message.parts.filter((part) => isToolUIPart(part) && getToolPartState(part) === "waiting-approval")
        .length,
    0
  );
}

function indexPendingApprovals(messages: UIMessage[]) {
  const index = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

      const approval = getToolApproval(part);
      const toolCallId = getToolCallId(part);
      if (approval?.id && toolCallId) index.set(approval.id, toolCallId);
    }
  }
  return index;
}

function isMcpReady(server: McpServerState) {
  const state = String(server.connectionState ?? server.state ?? "").toLowerCase();
  return state === "ready" || state === "connected";
}

function formatMcpStatus(readyCount: number, totalCount: number) {
  if (totalCount === 0) return "Starting";
  return String(readyCount) + "/" + String(totalCount) + " ready";
}

function formatToolApprovalPolicy(policy: string) {
  if (policy === "ask-every-time") return "Ask every time";
  if (policy === "allow-all") return "Allow all";
  return "Auto";
}

function formatToolAllowlist(count: number) {
  if (count === 0) return "None";
  return String(count) + " local " + (count === 1 ? "rule" : "rules");
}

function partKey(part: UIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) return getToolCallId(part) + ":" + String(index);
  return String(index);
}

createRoot(document.getElementById("root")!).render(<App />);
`;
}

function renderServerTs(input: {
  request: DeploymentRequest;
  deploymentId: string;
}): string {
  const agentName = JSON.stringify(input.request.agentName?.trim() || "Personal Agent");
  const deploymentId = JSON.stringify(input.deploymentId);
  const defaultModel = JSON.stringify(input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6");
  const cloudflareAccountId = JSON.stringify(input.request.cloudflareAccountId?.trim() ?? "");
  const personalAgent = normalizePersonalAgentConfig(input.request.personalAgent);
  const personalAgentLiteral = JSON.stringify(personalAgent);
  const publicPersonalAgentLiteral = JSON.stringify(publicPersonalAgentConfig(personalAgent));
  const toolApprovalPolicy = JSON.stringify(personalAgent.toolApprovalPolicy);

  return `import { AIChatAgent } from "@cloudflare/ai-chat";
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
  OPEN_THINK_PERSONAL_AGENT_CONFIG?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
  OPEN_THINK_LAUNCH_BRIEF?: string;
  OPEN_THINK_SOUL_PROMPT?: string;
};

type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all";

const generatedAgentName = ${agentName};
const generatedDeploymentId = ${deploymentId};
const generatedDefaultModel = ${defaultModel};
const generatedCloudflareAccountId = ${cloudflareAccountId};
const generatedPersonalAgentConfig = ${personalAgentLiteral};
const generatedPublicPersonalAgentConfig = ${publicPersonalAgentLiteral};
const generatedToolApprovalPolicy = ${toolApprovalPolicy};
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
        defaultModel: this.runtimeEnv.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel,
        personalAgent: this.publicPersonalAgentConfig(),
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

    if (url.pathname.endsWith("/personal-agent/setup")) {
      return Response.json({
        enabled: Boolean(this.personalAgentConfig().enabled),
        config: this.publicPersonalAgentConfig(),
        toolApprovalPolicy: this.toolApprovalPolicy(),
        setup: {
          status: "agents-sdk-runtime",
          note: "Package-style runtime reads OPEN_THINK_PERSONAL_AGENT_CONFIG, OPEN_THINK_SOUL_PROMPT, and OPEN_THINK_LAUNCH_BRIEF; D1 setup bootstrap is handled by the raw Worker deployment path."
        }
      });
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
      model: workersai(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel),
      system: [
        "You are " + (env.OPEN_THINK_AGENT_NAME ?? generatedAgentName) + ", an open-think personal agent running on Cloudflare Agents SDK.",
        this.personalAgentSystemInstruction(),
        "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
        "Use connected MCP tools when they are relevant. Current MCP tool approval policy: " + this.toolApprovalPolicy() + ".",
        "Deployment id: " + (env.OPEN_THINK_DEPLOYMENT_ID ?? generatedDeploymentId),
        "Cloudflare account id: " + ((env.OPEN_THINK_CF_ACCOUNT_ID ?? generatedCloudflareAccountId) || "not configured")
      ].join("\\n"),
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
            Authorization: \`Bearer \${this.runtimeEnv.OPEN_THINK_CF_API_TOKEN}\`
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
        description: "Request owner approval before a destructive, expensive, or security-sensitive Cloudflare operation. This checkpoint does not execute the operation by itself.",
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
    return normalizeToolApprovalPolicy(
      this.runtimeEnv.OPEN_THINK_TOOL_APPROVAL_POLICY ??
        this.personalAgentConfig().toolApprovalPolicy ??
        generatedToolApprovalPolicy
    );
  }

  private personalAgentConfig(): Record<string, unknown> {
    const raw = this.runtimeEnv.OPEN_THINK_PERSONAL_AGENT_CONFIG;
    let config: Record<string, unknown> = generatedPersonalAgentConfig;
    if (raw) {
      try {
        config = JSON.parse(raw);
      } catch {
        config = generatedPersonalAgentConfig;
      }
    }
    config = { ...config };
    config.toolApprovalPolicy = normalizeToolApprovalPolicy(
      this.runtimeEnv.OPEN_THINK_TOOL_APPROVAL_POLICY ?? config.toolApprovalPolicy
    );
    const enabled = Boolean(config.enabled);
    config.soulPromptConfigured = Boolean(enabled && (config.soulPromptConfigured || config.soulPrompt));
    config.launchBriefConfigured = Boolean(enabled && (config.launchBriefConfigured || config.launchBrief));
    if (enabled && config.soulPromptConfigured && typeof this.runtimeEnv.OPEN_THINK_SOUL_PROMPT === "string" && this.runtimeEnv.OPEN_THINK_SOUL_PROMPT.trim()) {
      config.soulPrompt = this.runtimeEnv.OPEN_THINK_SOUL_PROMPT.trim();
    }
    if (enabled && config.launchBriefConfigured && typeof this.runtimeEnv.OPEN_THINK_LAUNCH_BRIEF === "string" && this.runtimeEnv.OPEN_THINK_LAUNCH_BRIEF.trim()) {
      config.launchBrief = this.runtimeEnv.OPEN_THINK_LAUNCH_BRIEF.trim();
    }
    return config;
  }

  private publicPersonalAgentConfig(): Record<string, unknown> {
    const config = this.personalAgentConfig();
    const copy = { ...config };
    const soulPromptConfigured = Boolean(copy.soulPromptConfigured || copy.soulPrompt);
    const launchBriefConfigured = Boolean(copy.launchBriefConfigured || copy.launchBrief);
    delete copy.soulPrompt;
    delete copy.launchBrief;
    return {
      ...generatedPublicPersonalAgentConfig,
      ...copy,
      soulPromptConfigured,
      launchBriefConfigured,
      toolApprovalPolicy: this.toolApprovalPolicy()
    };
  }

  private personalAgentSystemInstruction(): string {
    const config = this.personalAgentConfig();
    if (!config.enabled) {
      return "Personal agent subsystem setup is disabled. Use the built-in OpenThink runtime defaults.";
    }
    const enabledFeatures = Array.isArray(config.enabledFeatures)
      ? config.enabledFeatures.join(", ")
      : "none";
    return [
      "Personal agent subsystem: " + String(config.label ?? "OpenThink gbrain + gstack") + ".",
      "Stack: " + String(config.stack ?? "gstack") + ". Brain: " + String(config.brain ?? "gbrain") + ".",
      "Setup status: " + String(config.setupStatus ?? "complete") + ". Enabled features: " + enabledFeatures + ".",
      "MCP tool approval policy: " + this.toolApprovalPolicy() + ".",
      typeof config.soulPrompt === "string" && config.soulPrompt.trim()
        ? "Owner soul prompt:\\n" + config.soulPrompt.trim()
        : "",
      typeof config.launchBrief === "string" && config.launchBrief.trim()
        ? "Initial launch brief:\\n" + config.launchBrief.trim()
        : ""
    ].filter(Boolean).join("\\n");
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
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\\s]+/g, "-");
  if (normalized === "ask-every-time" || normalized === "ask-everytime") return "ask-every-time";
  if (normalized === "allow-all" || normalized === "allowall") return "allow-all";
  return "auto";
}

function shouldAutoRequireToolApproval(name: string, definition: ToolSet[string]): boolean {
  const description =
    typeof (definition as { description?: unknown }).description === "string"
      ? String((definition as { description?: unknown }).description)
      : "";
  const normalizedName = name.replace(/^tool_[a-z0-9]+_/i, "").toLowerCase();
  const descriptionText = description.toLowerCase();
  const safeReadPattern =
    /\\b(get|list|read|search|find|lookup|describe|inspect|query|fetch|check|status|audit|analyze|summarize)\\b/;
  const riskyActionPattern =
    /\\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy)\\b/;
  const riskyPattern =
    /\\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy|access|dns|route|worker|r2|d1|queue|vectorize)\\b/;

  if (safeReadPattern.test(normalizedName) && !riskyActionPattern.test(normalizedName)) return false;
  if (riskyPattern.test(normalizedName + " " + descriptionText)) return true;
  return !safeReadPattern.test(descriptionText);
}
`;
}
