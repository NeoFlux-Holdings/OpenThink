import type { DeploymentRequest } from "./deployment-engine";
import {
  buildCloudAgentInstanceProfile,
  cloudAgentGoalInstruction
} from "./cloud-agent-instance";
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
      path: "Dockerfile",
      contents: renderSandboxDockerfile()
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
      "@ai-sdk/react": "^3.0.184",
      "@pierre/diffs": "1.1.22",
      "@cloudflare/ai-chat": "^0.7.0",
      "@cloudflare/codemode": "0.3.6",
      "@cloudflare/sandbox": "0.10.1",
      "@cloudflare/shell": "0.3.7",
      "@cloudflare/think": "0.6.1",
      "@cloudflare/voice": "0.2.0",
      "@modelcontextprotocol/sdk": "1.29.0",
      agents: "^0.12.4",
      ai: "^6.0.182",
      react: "^19.2.5",
      "react-dom": "^19.2.5",
      streamdown: "^2.5.0",
      zod: "^4.4.3",
      "workers-ai-provider": "^3.1.14"
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
    compatibility_date: "2026-05-14",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      directory: "dist/client",
      binding: "ASSETS"
    },
    ai: { binding: "AI" },
    containers: [
      {
        class_name: "Sandbox",
        image: "./Dockerfile"
      }
    ],
    durable_objects: {
      bindings: [
        { name: "PersonalChatAgent", class_name: "PersonalChatAgent" },
        { name: "WORKSPACE_MCP", class_name: "OpenThinkWorkspaceMcp" },
        { name: "Sandbox", class_name: "Sandbox" }
      ]
    },
    migrations: [
      {
        tag: `${input.deploymentId}-agents-sdk-v1`,
        new_sqlite_classes: ["PersonalChatAgent"]
      },
      {
        tag: `${input.deploymentId}-sandbox-v1`,
        new_sqlite_classes: ["Sandbox"]
      },
      {
        tag: `${input.deploymentId}-workspace-mcp-v1`,
        new_sqlite_classes: ["OpenThinkWorkspaceMcp"]
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
      OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE: "enabled",
      OPEN_THINK_SANDBOX_STATUS: "enabled",
      OPEN_THINK_CONTAINER_STATUS: "enabled",
      SANDBOX_TRANSPORT: "rpc",
      OPEN_THINK_CF_ACCOUNT_ID: input.request.cloudflareAccountId?.trim() ?? "",
      ...(input.sourceSha ? { OPEN_THINK_SOURCE_SHA: input.sourceSha } : {})
    }
  };
}

function renderSandboxDockerfile(): string {
  return [
    "FROM docker.io/cloudflare/sandbox:0.10.1-python",
    "",
    "RUN npm install -g typescript ts-node prettier && \\",
    "    apt-get update && \\",
    "    apt-get install -y --no-install-recommends \\",
    "      gawk \\",
    "      jq \\",
    "      ripgrep \\",
    "      rsync \\",
    "      shellcheck && \\",
    "    rm -rf /var/lib/apt/lists/*",
    ""
  ].join("\n");
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
select,
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

.topbar,
.workspace {
  width: min(1440px, calc(100% - 28px));
  margin: 0 auto;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
}

.brand {
  display: flex;
  gap: 10px;
  align-items: center;
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
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.72rem;
  text-transform: uppercase;
}

.status-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.pill[data-state="expired-approval"] {
  border-color: var(--line-strong);
  color: var(--muted);
  background: rgba(21, 23, 22, 0.04);
}

.workspace {
  display: grid;
  grid-template-columns: minmax(150px, 180px) minmax(0, 1fr) minmax(300px, 380px);
  gap: 16px;
  min-height: 0;
  height: 100%;
  padding: 16px 0;
}

.persona-sidebar,
.chat-panel,
.side-panel {
  min-width: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 16px 38px rgba(37, 31, 23, 0.08);
}

.persona-sidebar {
  display: grid;
  align-content: start;
  gap: 7px;
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.persona-sidebar a,
.sidebar-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  width: 100%;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 0 9px;
  color: var(--ink-soft);
  background: transparent;
  text-decoration: none;
  text-align: left;
}

.persona-sidebar a:hover,
.sidebar-link:hover {
  color: var(--ink);
  background: rgba(21, 23, 22, 0.05);
}

.persona-sidebar span {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.72rem;
}

.persona-sidebar small {
  margin-top: 4px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.sidebar-primary {
  width: 100%;
}

.sidebar-divider {
  height: 1px;
  margin: 5px 0;
  background: var(--line);
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
  scroll-behavior: auto;
}

.empty-state,
.message,
.metric,
.tool-group,
.tool-part {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 12px;
  background: var(--surface-strong);
}

.message {
  display: grid;
  gap: 7px;
  max-width: min(820px, 92%);
  line-height: 1.5;
}

.message[data-role="user"] {
  justify-self: end;
  border-color: rgba(223, 111, 33, 0.34);
  background: #fff4e9;
}

.message[data-pending="true"] {
  border-style: dashed;
  color: var(--ink-soft);
}

.message small,
.metric span {
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
  background: rgba(45, 95, 154, 0.06);
}

.tool-group {
  display: grid;
  overflow: hidden;
  padding: 0;
  background: rgba(45, 95, 154, 0.05);
}

.tool-group[data-state="waiting-approval"] {
  border-color: rgba(223, 111, 33, 0.34);
  background: rgba(223, 111, 33, 0.07);
}

.tool-group[data-state="error"] {
  border-color: rgba(180, 59, 53, 0.28);
  background: rgba(180, 59, 53, 0.06);
}

.tool-group[data-state="expired-approval"] {
  border-color: var(--line-strong);
  background: rgba(21, 23, 22, 0.035);
}

.tool-group > summary {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
  padding: 10px 12px;
  cursor: pointer;
  list-style: none;
}

.tool-group > summary::-webkit-details-marker {
  display: none;
}

.tool-group-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.tool-group-title strong {
  overflow-wrap: anywhere;
  font-size: 0.95rem;
}

.tool-group-title small {
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.3;
}

.tool-group-meta {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
}

.tool-group-toggle {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.tool-group-toggle::before {
  content: "+";
}

.tool-group[open] .tool-group-toggle::before {
  content: "-";
}

.tool-group-details {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding: 10px;
  background: rgba(255, 252, 245, 0.58);
}

.tool-part[data-state="waiting-approval"] {
  border-color: rgba(223, 111, 33, 0.34);
  background: rgba(223, 111, 33, 0.08);
}

.tool-part[data-state="expired-approval"] {
  border-color: var(--line-strong);
  background: rgba(21, 23, 22, 0.035);
}

.tool-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
  justify-content: space-between;
}

.tool-summary-copy {
  display: grid;
  min-width: min(100%, 320px);
  flex: 1 1 320px;
  gap: 4px;
}

.tool-summary-copy strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 0.96rem;
}

.tool-summary-copy p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.45;
}

.tool-inline-code {
  width: fit-content;
  border: 1px solid rgba(189, 180, 165, 0.68);
  border-radius: var(--radius-sm);
  padding: 3px 6px;
  color: var(--muted);
  background: rgba(255, 252, 245, 0.72);
  font-family: var(--mono);
  font-size: 0.72rem;
  overflow-wrap: anywhere;
}

.tool-outcome {
  color: var(--ink);
}

.tool-raw-details {
  border-top: 1px solid rgba(189, 180, 165, 0.7);
  padding-top: 8px;
}

.tool-raw-details > summary {
  width: fit-content;
  cursor: pointer;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.7rem;
  list-style: none;
  text-transform: uppercase;
}

.tool-raw-details > summary::-webkit-details-marker {
  display: none;
}

.tool-raw-details > summary::before {
  content: "+";
  margin-right: 6px;
}

.tool-raw-details[open] > summary::before {
  content: "-";
}

.tool-raw-section {
  display: grid;
  gap: 5px;
  margin-top: 8px;
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
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 10px;
  align-items: end;
  border-top: 1px solid var(--line);
  padding: 14px;
}

.composer-mode {
  display: inline-grid;
  grid-template-columns: repeat(3, auto);
  gap: 4px;
  align-self: stretch;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 4px;
  background: rgba(255, 252, 245, 0.72);
}

.mode-chip {
  min-height: 34px;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 0 10px;
  color: var(--ink-soft);
  background: transparent;
  font-size: 0.86rem;
  white-space: nowrap;
}

.mode-chip[data-active="true"] {
  color: #fffaf2;
  background: var(--accent-strong);
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

.train-panel {
  grid-column: 1 / -1;
  display: grid;
  gap: 10px;
  border: 1px solid rgba(45, 95, 154, 0.22);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: rgba(45, 95, 154, 0.055);
}

.train-panel[data-ready="true"] {
  border-color: rgba(36, 117, 82, 0.3);
  background: rgba(36, 117, 82, 0.07);
}

.train-panel-heading,
.train-footer,
.train-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}

.train-panel-heading p,
.train-footer p,
.train-empty {
  margin: 3px 0 0;
  color: var(--ink-soft);
  line-height: 1.4;
}

.train-objective {
  display: grid;
  gap: 5px;
}

.train-objective span,
.train-options span {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.train-objective input {
  min-height: 38px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 0 10px;
  color: var(--ink);
  background: var(--surface-strong);
}

.train-options label,
.train-step-check {
  display: inline-flex;
  gap: 7px;
  align-items: center;
  color: var(--ink-soft);
}

.train-step-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.train-step {
  display: grid;
  grid-template-columns: minmax(104px, auto) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 8px;
  background: rgba(255, 252, 245, 0.72);
}

.train-step[data-approved="true"] {
  border-color: rgba(36, 117, 82, 0.28);
  background: rgba(36, 117, 82, 0.07);
}

.train-step textarea {
  min-height: 56px;
  max-height: 160px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 9px;
  color: var(--ink);
  background: var(--surface-strong);
  resize: vertical;
}

.train-step-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
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

.section-heading {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
}

.section-heading h3,
.section-heading p {
  margin: 0;
}

.section-heading h3 {
  font-size: 1rem;
}

.section-heading p {
  margin-top: 4px;
  color: var(--ink-soft);
  font-size: 0.9rem;
  line-height: 1.35;
}

.subagent-console {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.hosted-agent-panel {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.browser-diagnostics-panel {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px;
  background: var(--surface-strong);
}

.browser-diagnostics-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.diagnostic-stage-list {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.diagnostic-stage-list li {
  display: grid;
  gap: 3px;
  border-left: 3px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 7px 8px;
  background: rgba(245, 241, 232, 0.54);
}

.diagnostic-stage-list li[data-state="complete"] {
  border-left-color: var(--green);
}

.diagnostic-stage-list li[data-state="warning"] {
  border-left-color: var(--accent-strong);
}

.diagnostic-stage-list li[data-state="error"] {
  border-left-color: var(--red);
}

.diagnostic-stage-list span {
  color: var(--ink);
  font-size: 0.84rem;
  font-weight: 700;
}

.diagnostic-stage-list small,
.diagnostic-empty {
  margin: 0;
  color: var(--muted);
  line-height: 1.35;
}

.artifact-stage {
  display: grid;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 10px;
  background: var(--surface-strong);
}

.artifact-stage-header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
}

.artifact-stage-header strong,
.artifact-stage-header small {
  display: block;
}

.artifact-stage-header small {
  margin-top: 2px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.canvas-mode-toggle {
  display: inline-grid;
  grid-template-columns: repeat(3, auto);
  gap: 2px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 2px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.64rem;
  text-transform: uppercase;
}

.canvas-mode-toggle button {
  border: 0;
  border-radius: 4px;
  padding: 4px 6px;
  color: var(--muted);
  background: transparent;
  font: inherit;
  text-transform: uppercase;
  cursor: pointer;
}

.canvas-mode-toggle button[aria-pressed="true"] {
  border-radius: 4px;
  color: #fffaf2;
  background: var(--accent-strong);
}

.artifact-preview {
  display: grid;
  place-items: center;
  min-height: 160px;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 16px;
  text-align: center;
  background:
    linear-gradient(90deg, rgba(21, 23, 22, 0.035) 1px, transparent 1px),
    linear-gradient(rgba(21, 23, 22, 0.032) 1px, transparent 1px),
    rgba(245, 241, 232, 0.52);
  background-size: 22px 22px;
}

.artifact-preview span,
.artifact-preview small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.artifact-preview strong {
  max-width: 100%;
  overflow-wrap: anywhere;
}

.artifact-version-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.artifact-version-picker select {
  max-width: 190px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 5px 7px;
  background: var(--surface);
}

.artifact-preview-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  place-items: stretch;
  text-align: left;
}

.artifact-grid-card,
.artifact-stack-card {
  display: grid;
  gap: 6px;
  min-width: 0;
  border: 1px solid rgba(216, 208, 193, 0.78);
  border-radius: var(--radius-sm);
  padding: 10px;
  text-align: left;
  background: rgba(255, 252, 245, 0.88);
  cursor: pointer;
}

.artifact-grid-card strong,
.artifact-stack-card strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-stack {
  position: relative;
  display: grid;
  min-height: 170px;
  width: min(100%, 360px);
}

.artifact-stack-card {
  grid-area: 1 / 1;
  box-shadow: 0 10px 24px rgba(45, 37, 26, 0.08);
}

.artifact-text-preview {
  display: grid;
  gap: 6px;
  max-width: 100%;
  text-align: left;
}

.artifact-text-preview pre {
  max-height: 220px;
  max-width: 100%;
  overflow: auto;
  border-radius: var(--radius-sm);
  padding: 10px;
  color: #f9f3df;
  background: #151716;
  text-align: left;
  white-space: pre-wrap;
}

.artifact-web-preview {
  width: 100%;
  min-height: 260px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
}

.artifact-preview-heading,
.artifact-preview-actions,
.artifact-slide-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.artifact-preview-heading span {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.artifact-image-preview,
.artifact-slides-preview {
  display: grid;
  gap: 10px;
  width: 100%;
  min-width: 0;
  text-align: left;
}

.artifact-image-frame,
.artifact-slide-frame {
  display: grid;
  place-items: center;
  min-height: 280px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
}

.artifact-image-frame img {
  max-width: 100%;
  max-height: 520px;
  object-fit: contain;
}

.artifact-slide-frame {
  align-content: center;
  justify-items: start;
  padding: 24px;
  background: linear-gradient(180deg, #fffdf7, #f5f7f2);
}

.artifact-slide-frame h3 {
  margin: 0 0 10px;
  font-size: 1.25rem;
}

.artifact-slide-frame pre {
  width: 100%;
  margin: 0;
  overflow: auto;
  color: var(--ink);
  font-family: inherit;
  white-space: pre-wrap;
}

.artifact-slide-controls {
  justify-content: center;
  color: var(--muted);
  font-size: 0.82rem;
}

.artifact-slide-notes {
  margin: 0;
  border-left: 3px solid var(--accent);
  padding-left: 10px;
  color: var(--muted);
}

.artifact-browser-session {
  display: grid;
  gap: 10px;
  width: 100%;
  min-width: 0;
  text-align: left;
}

.browser-chrome {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 7px 8px;
  background: rgba(255, 252, 245, 0.9);
}

.browser-dots {
  display: inline-flex;
  gap: 4px;
}

.browser-dots i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line-strong);
}

.browser-chrome code {
  min-width: 0;
  overflow: hidden;
  color: var(--ink-soft);
  font-family: var(--mono);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.browser-viewport {
  display: grid;
  place-items: center;
  min-height: 280px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
}

.browser-viewport img,
.browser-viewport iframe {
  width: 100%;
  min-height: 280px;
  border: 0;
  object-fit: contain;
}

.browser-empty-state {
  display: grid;
  gap: 6px;
  padding: 20px;
  text-align: center;
}

.browser-session-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  color: var(--muted);
  font-size: 0.82rem;
}

.browser-stream-status {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  background: rgba(255, 252, 245, 0.86);
  color: var(--muted);
}

.browser-stream-status[data-state="streaming"] {
  border-color: rgba(35, 134, 81, 0.34);
  background: rgba(35, 134, 81, 0.08);
  color: var(--success-ink);
}

.browser-stream-status[data-state="failed"] {
  border-color: rgba(184, 48, 48, 0.3);
  background: rgba(184, 48, 48, 0.07);
  color: var(--danger-ink);
}

.browser-session-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--muted);
  font-size: 0.76rem;
}

.browser-session-meta code {
  color: var(--ink-soft);
  font-family: var(--mono);
}

.browser-session-events {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.browser-session-events li {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 7px 8px;
  background: rgba(255, 252, 245, 0.8);
}

.artifact-popout-trigger {
  justify-self: start;
}

.artifact-popout {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(21, 23, 22, 0.38);
}

.artifact-popout-window {
  display: grid;
  gap: 12px;
  width: min(960px, 94vw);
  max-height: min(760px, 92vh);
  overflow: auto;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--surface);
  box-shadow: 0 24px 70px rgba(45, 37, 26, 0.24);
}

.artifact-popout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.artifact-popout-header > div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.artifact-table-preview {
  display: grid;
  gap: 8px;
  width: 100%;
  min-width: 0;
  text-align: left;
}

.artifact-table-scroll {
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: rgba(255, 252, 245, 0.88);
}

.artifact-table-preview table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.82rem;
}

.artifact-table-preview th,
.artifact-table-preview td {
  border-bottom: 1px solid var(--line);
  padding: 7px 8px;
  text-align: left;
  vertical-align: top;
}

.artifact-table-preview th {
  position: sticky;
  top: 0;
  background: var(--surface-elevated);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.artifact-diff-preview {
  display: grid;
  gap: 10px;
  min-width: 0;
  text-align: left;
}

.artifact-diff-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.artifact-diff-stats span {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 4px 7px;
  color: var(--ink-soft);
  background: rgba(255, 252, 245, 0.78);
  font-family: var(--mono);
  font-size: 0.72rem;
}

.artifact-diff-preview pre {
  max-height: 420px;
  overflow: auto;
}

.artifact-diff-preview [class*="diff"] {
  max-width: 100%;
}

.artifact-rail,
.canvas-quicklinks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.artifact-thumb,
.canvas-quicklinks a {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  color: var(--ink-soft);
  background: rgba(255, 252, 245, 0.78);
  font-size: 0.82rem;
  text-decoration: none;
}

.artifact-thumb {
  cursor: pointer;
}

.artifact-thumb[aria-pressed="true"] {
  border-color: rgba(190, 80, 18, 0.52);
  color: var(--accent-strong);
  background: rgba(190, 80, 18, 0.08);
}

.capability-canvas {
  display: grid;
  gap: 12px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.canvas-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.canvas-section {
  display: grid;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: rgba(21, 23, 22, 0.03);
}

.canvas-section > p {
  margin: 0;
  color: var(--ink-soft);
  line-height: 1.38;
}

.canvas-section-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.canvas-section-heading small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.learning-suggestions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.learning-suggestions li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: start;
  border: 1px solid rgba(216, 208, 193, 0.74);
  border-radius: var(--radius-sm);
  padding: 9px;
  background: rgba(255, 252, 245, 0.84);
}

.learning-suggestions span,
.learning-suggestions small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.learning-suggestions small {
  color: var(--ink-soft);
  line-height: 1.35;
}

.learning-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.mcp-observability-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.mcp-server-card {
  display: grid;
  gap: 3px;
  min-width: 0;
  border: 1px solid rgba(216, 208, 193, 0.8);
  border-radius: var(--radius-sm);
  padding: 8px;
  background: rgba(250, 248, 241, 0.88);
}

.mcp-server-card span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-server-card small,
.mcp-event-list small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-list {
  display: grid;
  gap: 7px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.compact-list li {
  display: grid;
  gap: 2px;
  border: 1px solid rgba(216, 208, 193, 0.74);
  border-radius: var(--radius-sm);
  padding: 8px;
  background: rgba(255, 252, 245, 0.78);
}

.compact-list span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compact-list small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.flow-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.flow-step {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 9px;
  background: rgba(255, 252, 245, 0.72);
}

.flow-step > span {
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid rgba(45, 95, 154, 0.22);
  border-radius: var(--radius-sm);
  color: var(--blue);
  background: rgba(45, 95, 154, 0.08);
  font-family: var(--mono);
  font-size: 0.68rem;
  font-weight: 700;
}

.flow-step strong,
.flow-step small,
.sdk-card strong,
.sdk-card small {
  display: block;
}

.flow-step small,
.sdk-card small {
  margin-top: 3px;
  color: var(--ink-soft);
  line-height: 1.35;
}

.sdk-card {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: rgba(21, 23, 22, 0.03);
}

.sdk-snippet {
  max-height: 190px;
  font-size: 0.72rem;
}

.customization-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.subagent-create,
.subagent-detail,
.subagent-prompt {
  display: grid;
  gap: 8px;
}

.form-kicker {
  color: var(--ink-soft);
  font-family: var(--mono);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.workstream-stats,
.subagent-metadata {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.subagent-templates {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.subagent-template {
  display: grid;
  gap: 4px;
  min-height: 78px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: var(--ink);
  background: rgba(255, 252, 245, 0.72);
  text-align: left;
}

.subagent-template:hover {
  border-color: rgba(45, 95, 154, 0.35);
  background: rgba(45, 95, 154, 0.06);
}

.subagent-template small {
  color: var(--ink-soft);
  line-height: 1.32;
}

.subagent-create input,
.subagent-create select,
.subagent-create textarea,
.subagent-prompt textarea {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
  color: var(--ink);
  background: var(--surface-strong);
}

.field-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.75fr) minmax(0, 1fr);
  gap: 8px;
}

.button-block {
  width: 100%;
}

.subagent-roster,
.subagent-messages {
  display: grid;
  gap: 8px;
}

.subagent-row {
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: var(--ink);
  background: rgba(255, 252, 245, 0.72);
  text-align: left;
}

.subagent-row[data-active="true"] {
  border-color: rgba(223, 111, 33, 0.42);
  background: #fff4e9;
}

.subagent-row span:first-child {
  min-width: 0;
}

.subagent-row strong,
.subagent-row small {
  display: block;
}

.subagent-row small,
.subagent-summary small,
.subagent-message small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.subagent-summary {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  background: rgba(21, 23, 22, 0.03);
}

.detail-title {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
}

.detail-title strong,
.detail-title small {
  display: block;
}

.detail-title strong {
  margin-bottom: 3px;
}

.subagent-summary p,
.subagent-message p {
  margin: 5px 0 0;
  color: var(--ink-soft);
  line-height: 1.4;
}

.subagent-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.subagent-chip-row .pill {
  min-height: 24px;
  font-size: 0.66rem;
}

.subagent-message {
  border-left: 3px solid rgba(45, 95, 154, 0.28);
  padding-left: 9px;
}

.subagent-message[data-role="user"] {
  border-left-color: rgba(223, 111, 33, 0.42);
}

.inline-error {
  border: 1px solid rgba(180, 59, 53, 0.28);
  border-radius: var(--radius-sm);
  padding: 9px;
  color: var(--red);
  background: rgba(180, 59, 53, 0.08);
}

.compact {
  padding: 10px;
  font-size: 0.9rem;
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

.command-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  align-items: start;
  justify-items: center;
  padding: max(54px, 8vh) 18px 18px;
  background: rgba(21, 23, 22, 0.28);
  backdrop-filter: blur(6px);
}

.command-palette {
  display: grid;
  gap: 10px;
  width: min(720px, 100%);
  max-height: min(720px, calc(100dvh - 72px));
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  padding: 12px;
  background: var(--surface);
  box-shadow: 0 24px 70px rgba(21, 23, 22, 0.24);
}

.command-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.command-input-row input {
  min-height: 46px;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 0 12px;
  color: var(--ink);
  background: var(--surface-strong);
}

.command-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.command-tabs span,
.command-footer {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.command-tabs span {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 5px 7px;
  background: rgba(255, 252, 245, 0.74);
}

.command-results {
  display: grid;
  gap: 8px;
  overflow: auto;
  padding-right: 2px;
}

.command-results > p {
  margin: 0;
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 14px;
  color: var(--ink-soft);
  background: rgba(21, 23, 22, 0.03);
}

.command-result {
  display: grid;
  gap: 3px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 10px;
  color: var(--ink);
  background: var(--surface-strong);
  text-decoration: none;
}

.command-result:hover {
  border-color: rgba(45, 95, 154, 0.34);
  background: rgba(45, 95, 154, 0.06);
}

.command-result span,
.command-result small {
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.command-result small {
  line-height: 1.36;
  text-transform: none;
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

  .persona-sidebar {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    overflow-x: auto;
  }

  .persona-sidebar small,
  .sidebar-divider {
    display: none;
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
  .topbar,
  .workspace {
    width: min(100% - 18px, 1440px);
  }

  .composer {
    grid-template-columns: 1fr;
  }

  .composer-mode {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .message {
    max-width: 100%;
  }

  .customization-grid {
    grid-template-columns: 1fr;
  }

  .train-step {
    grid-template-columns: 1fr;
  }

  .train-step-actions {
    justify-content: flex-start;
  }

  .workstream-stats,
  .subagent-metadata,
  .subagent-templates {
    grid-template-columns: 1fr;
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
    toolApprovalPolicy: personalAgent.toolApprovalPolicy,
    sdkPackage: "@open-think/core",
    sdkFactory: "createHostedCloudAgentClient"
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

const PatchDiffRenderer = lazy(async () => {
  const { PatchDiff } = await import("@pierre/diffs/react");
  return {
    default: function PatchDiffRenderer({ patch }: { patch: string }) {
      return (
        <PatchDiff
          disableWorkerPool
          options={{
            diffIndicators: "bars",
            diffStyle: "unified",
            lineDiffType: "word",
            overflow: "wrap",
            theme: "pierre-light",
            themeType: "light"
          }}
          patch={patch}
        />
      );
    }
  };
});

const clientConfig = ${JSON.stringify(clientConfig, null, 2)} as const;

const runModes = [
  { id: "auto", label: "Auto" },
  { id: "plan-first", label: "Plan first" },
  { id: "train", label: "Train" }
] as const;

type RunMode = (typeof runModes)[number]["id"];

type SocketDiagnostic = {
  state: "closed" | "error" | "reconnecting";
  detail: string;
  at: string;
};

type TrainStep = {
  id: string;
  text: string;
  approved: boolean;
};

type TrainPlanState = {
  objective: string;
  steps: TrainStep[];
  draftVisible: boolean;
  granular: boolean;
};

function App() {
  return (
    <main className="app">
      <Chat />
    </main>
  );
}

function Chat() {
  const [runMode, setRunMode] = useState<RunMode>("auto");
  const [trainPlan, setTrainPlan] = useState<TrainPlanState>(() => defaultTrainPlanState());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mcpServers, setMcpServers] = useState<Record<string, McpServerState>>({});
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [browserDiagnostics, setBrowserDiagnostics] = useState<BrowserDiagnosticsResponse | null>(null);
  const [browserDiagnosticsBusy, setBrowserDiagnosticsBusy] = useState(false);
  const [capabilitySummary, setCapabilitySummary] = useState<CapabilitySummary | null>(null);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState("");
  const [subAgentMessages, setSubAgentMessages] = useState<SubAgentMessage[]>([]);
  const [subAgentAction, setSubAgentAction] = useState<SubAgentAction | null>(null);
  const [subAgentError, setSubAgentError] = useState<string | null>(null);
  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentDraft>(defaultSubAgentDraft);
  const [learningActionId, setLearningActionId] = useState<string | null>(null);
  const [sdkCopied, setSdkCopied] = useState(false);
  const [sessionApprovalIds, setSessionApprovalIds] = useState<Set<string>>(() => new Set());
  const [pendingUserMessage, setPendingUserMessage] = useState<PendingUserMessage | null>(null);
  const [pendingAssistantMessage, setPendingAssistantMessage] = useState<PendingAssistantMessage | null>(null);
  const [emptyResponseMessage, setEmptyResponseMessage] = useState<string | null>(null);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const [socketDiagnostic, setSocketDiagnostic] = useState<SocketDiagnostic | null>(null);
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const toolContinuationAttemptSignaturesRef = useRef<Set<string>>(new Set());
  const sessionTurnStartIndexRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottomRef = useRef(true);
  const socketRecoveryAttemptsRef = useRef(0);

  const handleMcpUpdate = useCallback((servers: unknown) => {
    setMcpServers((previous) => {
      const next = normalizeMcpServers(servers);
      return mcpServerSnapshotsEqual(previous, next) ? previous : next;
    });
  }, []);

  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    query: { ot_socket: String(socketGeneration) },
    onMcpUpdate: handleMcpUpdate,
    onOpen: () => {
      socketRecoveryAttemptsRef.current = 0;
      setSocketDiagnostic(null);
    },
    onClose: (event) => {
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: formatSocketClose(event),
        state: "closed"
      });
    },
    onError: () => {
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: "WebSocket error while connecting to the agent.",
        state: "error"
      });
    }
  });
  const {
    messages,
    setMessages,
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
    autoContinueAfterToolResult: true,
    resume: true,
    cancelOnClientAbort: false,
    getInitialMessages: getInitialAgentMessages,
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
  const mcpServerValues = Object.values(mcpServers);
  const mcpReadyCount = mcpServerValues.filter((server) => isMcpReady(server)).length;
  const alwaysAllowedToolCount = alwaysAllowedTools.size;
  const activityLabel = busy ? (isToolContinuation ? "Continuing tool" : "Streaming") : "Idle";
  const activeApprovalIds = sessionApprovalIds;
  const approvalToolCallIds = useMemo(
    () => indexActivePendingApprovals(messages, activeApprovalIds),
    [messages, activeApprovalIds]
  );
  const visibleMessages = useMemo(() => compactVisibleMessages(messages, activeApprovalIds), [messages, activeApprovalIds]);
  const pendingApprovalCount = approvalToolCallIds.size;
  const approvalErrorMessage = formatChatErrorMessage(error);
  const visibleEmptyResponseMessage = busy ? null : emptyResponseMessage;
  const chatErrorMessage = approvalErrorMessage ?? visibleEmptyResponseMessage;
  const retryIsSafe = !isProtocolRecoveryError(error);
  const canRetry =
    connected &&
    !busy &&
    retryIsSafe &&
    pendingApprovalCount === 0 &&
    messages.some((message) => message.role === "user");
  const selectedSubAgent = subAgents.find((subAgent) => subAgent.id === selectedSubAgentId) ?? subAgents[0] ?? null;
  const activeSubAgentCount = subAgents.filter((subAgent) => subAgent.status !== "archived").length;
  const searchResults = useMemo(
    () => searchPaletteResults(searchQuery, messages, activeApprovalIds, capabilitySummary, subAgents),
    [activeApprovalIds, capabilitySummary, messages, searchQuery, subAgents]
  );
  const subAgentBusy = subAgentAction !== null;
  const executionState = runtimeHealth?.cloudAgentInstance?.execution;
  const codeModeState = runtimeHealth?.cloudAgentInstance?.codeMode;
  const workspaceState = runtimeHealth?.cloudAgentInstance?.workspace;
  const showAssistantPlaceholder = pendingAssistantMessage !== null && pendingApprovalCount === 0;
  const assistantPlaceholderText = busy ? "Working..." : "No assistant output was received.";

  const forceReconnect = useCallback(() => {
    socketRecoveryAttemptsRef.current = 0;
    setSocketDiagnostic({
      at: new Date().toISOString(),
      detail: "Opening a fresh agent socket.",
      state: "reconnecting"
    });
    setSocketGeneration((generation) => generation + 1);
    agent.reconnect();
  }, [agent]);

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !stickToBottomRef.current) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, isStreaming, isServerStreaming]);

  useEffect(() => {
    if (agent.readyState !== WebSocket.CLOSING) return;
    if (socketRecoveryAttemptsRef.current >= 3) return;

    const timeout = window.setTimeout(() => {
      if (agent.readyState !== WebSocket.CLOSING) return;
      socketRecoveryAttemptsRef.current += 1;
      setSocketDiagnostic({
        at: new Date().toISOString(),
        detail: "Agent socket was stuck closing; opening a fresh socket.",
        state: "reconnecting"
      });
      setSocketGeneration((generation) => generation + 1);
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [agent.readyState, socketGeneration]);

  useEffect(() => {
    void loadSubAgents();
    void loadRuntimeHealth();
    void loadBrowserDiagnostics();
    void loadCapabilitySummary();
  }, []);

  useEffect(() => {
    if (!selectedSubAgent?.id) {
      setSubAgentMessages([]);
      return;
    }
    void loadSubAgentMessages(selectedSubAgent.id);
  }, [selectedSubAgent?.id]);

  useEffect(() => {
    const startIndex = sessionTurnStartIndexRef.current;
    if (startIndex === null) return;

    const nextApprovalIds = indexPendingApprovalIdsAfter(messages, startIndex);
    if (nextApprovalIds.size === 0) return;
    setSessionApprovalIds((previous) => (stringSetsEqual(previous, nextApprovalIds) ? previous : nextApprovalIds));
  }, [messages]);

  useEffect(() => {
    if (!pendingUserMessage) return;
    if (messagesContainUserTextAfter(messages, pendingUserMessage.text, pendingUserMessage.startIndex)) {
      setPendingUserMessage(null);
    }
  }, [messages, pendingUserMessage]);

  useEffect(() => {
    if (!pendingAssistantMessage) return;
    if (messagesContainRenderableAssistantAfter(messages, pendingAssistantMessage.startIndex, sessionApprovalIds)) {
      setPendingAssistantMessage(null);
      setEmptyResponseMessage(null);
    }
  }, [messages, pendingAssistantMessage, sessionApprovalIds]);

  useEffect(() => {
    if (!emptyResponseMessage) return;
    const latestUserMessage = latestUserTextMessageAfter(messages, 0);
    if (!latestUserMessage) return;
    if (messagesContainRenderableAssistantAfter(messages, latestUserMessage.index, sessionApprovalIds)) {
      setEmptyResponseMessage(null);
    }
  }, [emptyResponseMessage, messages, sessionApprovalIds]);

  useEffect(() => {
    if (!error) return;
    setPendingUserMessage(null);
    setPendingAssistantMessage(null);
  }, [error]);

  useEffect(() => {
    function onWindowKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
      }
    }

    window.addEventListener("keydown", onWindowKeyDown);
    return () => window.removeEventListener("keydown", onWindowKeyDown);
  }, []);

  useEffect(() => {
    if (!pendingAssistantMessage || busy || !connected || error || pendingApprovalCount > 0) return;
    if (messagesContainRenderableAssistantAfter(messages, pendingAssistantMessage.startIndex, sessionApprovalIds)) return;

    const startIndex = pendingAssistantMessage.startIndex;
    const refreshTimer = window.setTimeout(() => {
      void getAgentMessages()
        .then((refreshedMessages) => {
          if (messagesContainRenderableAssistantAfter(refreshedMessages, startIndex, sessionApprovalIds)) {
            setMessages(refreshedMessages);
            setPendingAssistantMessage(null);
            setEmptyResponseMessage(null);
            return;
          }

          setPendingAssistantMessage(null);
          setEmptyResponseMessage("No assistant output was received. Retry the last message when ready.");
        })
        .catch(() => {
          setPendingAssistantMessage(null);
          setEmptyResponseMessage("No assistant output was received. Retry the last message when ready.");
        });
    }, 800);

    return () => window.clearTimeout(refreshTimer);
  }, [busy, connected, error, messages, pendingAssistantMessage, pendingApprovalCount, sessionApprovalIds, setMessages]);

  useEffect(() => {
    if (!connected) return;
    const recoveredContinuation = toolContinuationCandidate(messages);
    if (!recoveredContinuation) return;
    if (!pendingToolContinuationMarkerMatches(recoveredContinuation, readPendingToolContinuationMarker())) return;
    if (toolContinuationAttemptSignaturesRef.current.has(recoveredContinuation.signature)) return;
    toolContinuationAttemptSignaturesRef.current.add(recoveredContinuation.signature);
    clearPendingToolContinuationMarker();
  }, [connected, messages]);

  function onMessageListScroll() {
    const messageList = messageListRef.current;
    if (!messageList) return;
    stickToBottomRef.current = isNearScrollBottom(messageList);
  }

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
    if (!connected) return;

    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

        const approval = getToolApproval(part);
        const toolCallId = getToolCallId(part);
        const toolName = getToolName(part);
        if (!approval?.id || approvalToolCallIds.get(approval.id) !== toolCallId) continue;
        if (!alwaysAllowedTools.has(toolApprovalPreferenceKey(toolName))) continue;
        if (autoApprovedApprovalIdsRef.current.has(approval.id)) continue;

        if (respondToToolApproval(approval.id, toolCallId, true)) {
          autoApprovedApprovalIdsRef.current.add(approval.id);
        }
      }
    }
  }, [alwaysAllowedTools, approvalToolCallIds, connected, messages, respondToToolApproval]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("message") as HTMLTextAreaElement | null;
    const text = input?.value.trim();
    if (!text || !connected || busy) return;
    const trainSubmission = runMode === "train" ? buildTrainModeSubmission(text, trainPlan) : null;
    if (trainSubmission && !trainSubmission.ready) {
      setTrainPlan(draftTrainPlan(trainSubmission.objective || text, trainPlan));
      composerInputRef.current?.focus();
      return;
    }
    const outboundText = trainSubmission?.text ?? applyRunModeToMessage(text, runMode);
    clearError();
    setEmptyResponseMessage(null);
    clearPendingToolContinuationMarker();
    sessionTurnStartIndexRef.current = messages.length;
    setSessionApprovalIds(new Set());
    setPendingUserMessage({
      text: outboundText,
      startIndex: messages.length
    });
    setPendingAssistantMessage({
      startIndex: messages.length
    });
    stickToBottomRef.current = true;
    sendMessage({ text: outboundText });
    if (input) input.value = "";
    if (runMode === "train") setTrainPlan(defaultTrainPlanState());
  }

  function draftTrainPlanFromComposer() {
    const objective = composerInputRef.current?.value.trim() || trainPlan.objective;
    if (!objective.trim()) {
      composerInputRef.current?.focus();
      return;
    }
    setTrainPlan(draftTrainPlan(objective, trainPlan));
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearPendingToolContinuationMarker();
      sessionTurnStartIndexRef.current = null;
      setSessionApprovalIds(new Set());
      setPendingUserMessage(null);
      setPendingAssistantMessage(null);
      setEmptyResponseMessage(null);
      clearHistory();
    }
  }

  function onRetry() {
    if (!canRetry) return;
    clearError();
    setEmptyResponseMessage(null);
    const retryTarget = latestUserTextMessageAfter(messages, 0);
    if (retryTarget) {
      setPendingAssistantMessage({ startIndex: retryTarget.index });
      stickToBottomRef.current = true;
      void Promise.resolve(sendMessage({ text: retryTarget.text, messageId: retryTarget.id })).catch((retryError: unknown) => {
        console.error("[useAgentChat] Retry failed", retryError);
        setPendingAssistantMessage(null);
        setEmptyResponseMessage("Retry failed. Send the request again if needed.");
      });
      return;
    }
    stickToBottomRef.current = true;
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

  async function loadSubAgents(preferredId?: string) {
    try {
      const data = await jsonFetch<{ available?: boolean; subAgents?: SubAgent[]; error?: string }>("/subagents");
      const nextSubAgents = data.subAgents ?? [];
      setSubAgents(nextSubAgents);
      setSelectedSubAgentId((current) => preferredId || current || nextSubAgents[0]?.id || "");
      setSubAgentError(data.available === false && data.error ? data.error : null);
    } catch (loadError) {
      setSubAgentError(loadError instanceof Error ? loadError.message : "Could not load sub-agents.");
    }
  }

  async function loadRuntimeHealth() {
    try {
      const data = await jsonFetch<RuntimeHealth>("/health");
      setRuntimeHealth(data);
    } catch {
      setRuntimeHealth(null);
    }
  }

  async function loadBrowserDiagnostics() {
    try {
      const data = await fetchBrowserDiagnostics();
      setBrowserDiagnostics(data);
    } catch (loadError) {
      setBrowserDiagnostics({
        ok: false,
        status: "unavailable",
        mode: "read-only",
        summary: loadError instanceof Error ? loadError.message : "Could not load Browser Run diagnostics.",
        stages: []
      });
    }
  }

  async function runBrowserDiagnostics() {
    setBrowserDiagnosticsBusy(true);
    try {
      const data = await fetchBrowserDiagnostics({
        method: "POST",
        body: JSON.stringify({ live: true })
      });
      setBrowserDiagnostics(data);
    } catch (runError) {
      setBrowserDiagnostics({
        ok: false,
        status: "live-check-failed",
        mode: "live",
        summary: runError instanceof Error ? runError.message : "Browser Run live check failed.",
        stages: []
      });
    } finally {
      setBrowserDiagnosticsBusy(false);
    }
  }

  async function loadCapabilitySummary() {
    const [skills, learning, artifacts, contributions, executor, mcp, mcpObservability] = await Promise.all([
      optionalJsonFetch<SkillListResponse>("/skills"),
      optionalJsonFetch<LearningResponse>("/learning"),
      optionalJsonFetch<ArtifactListResponse>("/artifacts"),
      optionalJsonFetch<ContributionStatusResponse>("/contributions"),
      optionalJsonFetch<ExecutorResponse>("/executor"),
      optionalJsonFetch<McpServerCatalogResponse>("/mcp/servers"),
      optionalJsonFetch<McpObservabilityResponse>("/mcp/observability")
    ]);
    setCapabilitySummary({ skills, learning, artifacts, contributions, executor, mcp, mcpObservability });
  }

  async function curateLearningSuggestion(id: string, status: LearningSuggestionStatus, summary?: string) {
    setLearningActionId(id);
    try {
      await jsonFetch("/learning/" + encodeURIComponent(id), {
        method: "PATCH",
        body: JSON.stringify(summary === undefined ? { status } : { status, summary })
      });
      await loadCapabilitySummary();
    } finally {
      setLearningActionId(null);
    }
  }

  async function editLearningSuggestion(suggestion: LearningSuggestion) {
    const nextSummary = window.prompt("Edit learning suggestion", suggestion.summary);
    if (nextSummary === null) return;
    await curateLearningSuggestion(suggestion.id, "pending", nextSummary);
  }

  async function loadSubAgentMessages(id: string) {
    try {
      const data = await jsonFetch<{ messages?: SubAgentMessage[] }>("/subagents/" + encodeURIComponent(id) + "/messages");
      setSubAgentMessages(data.messages ?? []);
    } catch (loadError) {
      setSubAgentError(loadError instanceof Error ? loadError.message : "Could not load sub-agent messages.");
    }
  }

  async function onCreateSubAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubAgentAction("create");
    setSubAgentError(null);
    try {
      const result = await jsonFetch<{ subAgent?: SubAgent }>("/subagents", {
        method: "POST",
        body: JSON.stringify({
          ...subAgentDraft,
          skills: subAgentDraft.skills.split(",").map((skill) => skill.trim()).filter(Boolean)
        })
      });
      if (result.subAgent) {
        setSubAgentDraft(defaultSubAgentDraft);
        await loadSubAgents(result.subAgent.id);
      }
    } catch (createError) {
      setSubAgentError(createError instanceof Error ? createError.message : "Could not create sub-agent.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function controlSubAgent(status: SubAgentStatus) {
    if (!selectedSubAgent) return;
    setSubAgentAction(status === "paused" ? "pause" : status === "archived" ? "archive" : "resume");
    setSubAgentError(null);
    try {
      await jsonFetch("/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/control", {
        method: "POST",
        body: JSON.stringify({ status })
      });
      await loadSubAgents(selectedSubAgent.id);
    } catch (controlError) {
      setSubAgentError(controlError instanceof Error ? controlError.message : "Could not update sub-agent.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function refreshSubAgentSummary() {
    if (!selectedSubAgent) return;
    setSubAgentAction("summarize");
    setSubAgentError(null);
    try {
      await jsonFetch("/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/summary", { method: "POST" });
      await loadSubAgents(selectedSubAgent.id);
    } catch (summaryError) {
      setSubAgentError(summaryError instanceof Error ? summaryError.message : "Could not refresh summary.");
    } finally {
      setSubAgentAction(null);
    }
  }

  async function sendSubAgentText(prompt: string, action: SubAgentAction = "send"): Promise<boolean> {
    if (!selectedSubAgent) return false;
    setSubAgentAction(action);
    setSubAgentError(null);
    try {
      const result = await jsonFetch<{ subAgent?: SubAgent; messages?: SubAgentMessage[] }>(
        "/subagents/" + encodeURIComponent(selectedSubAgent.id) + "/messages",
        { method: "POST", body: JSON.stringify({ message: prompt }) }
      );
      if (result.messages) setSubAgentMessages(result.messages);
      await loadSubAgents(result.subAgent?.id || selectedSubAgent.id);
      return true;
    } catch (sendError) {
      setSubAgentError(sendError instanceof Error ? sendError.message : "Could not message sub-agent.");
      return false;
    } finally {
      setSubAgentAction(null);
    }
  }

  async function sendSubAgentPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem("subAgentPrompt") as HTMLTextAreaElement | null;
    const prompt = input?.value.trim();
    if (!prompt) return;
    if (await sendSubAgentText(prompt, "send")) {
      if (input) input.value = "";
    }
  }

  function exploreSelectedSubAgent() {
    if (!selectedSubAgent || subAgentBusy) return;
    void sendSubAgentText(subAgentExplorePrompt, "explore");
  }

  async function copySdkSnippet() {
    const snippet = hostedAgentSdkSnippet();
    try {
      await navigator.clipboard.writeText(snippet);
      setSdkCopied(true);
      window.setTimeout(() => setSdkCopied(false), 1800);
    } catch {
      setSdkCopied(false);
    }
  }

  function briefSubAgentInMainChat() {
    if (!selectedSubAgent || !connected || busy) return;
    sendMessage({
      text:
        "Review sub-agent " +
        selectedSubAgent.name +
        " (" +
        selectedSubAgent.status +
        "). Purpose: " +
        selectedSubAgent.purpose +
        "\\n\\nCurrent summary: " +
        selectedSubAgent.summary
    });
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
        <PersonaSidebar
          activeSubAgentCount={activeSubAgentCount}
          focusComposer={() => composerInputRef.current?.focus()}
          openSearch={() => setSearchOpen(true)}
          pendingApprovalCount={pendingApprovalCount}
          summary={capabilitySummary}
        />

        <section className="chat-panel" aria-busy={busy} aria-label="Chat">
          <div className="panel-header">
            <h1>Conversation</h1>
            <p>Streaming, message persistence, client tools, and approvals are handled by Cloudflare Agents SDK.</p>
          </div>

          <div className="message-list" aria-live="polite" id="chat-feed" onScroll={onMessageListScroll} ref={messageListRef} role="log">
            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                Use /goal to set an active objective, or ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              visibleMessages.map(({ key, message }, index) => (
                <Message
                  activeApprovalIds={activeApprovalIds}
                  approveToolAlways={approveToolAlways}
                  key={key + ":" + String(index)}
                  message={message}
                  respondToToolApproval={respondToToolApproval}
                />
              ))
            )}
            {pendingUserMessage ? <PendingMessage role="user" text={pendingUserMessage.text} /> : null}
            {showAssistantPlaceholder ? <PendingMessage role="assistant" text={assistantPlaceholderText} /> : null}
            {chatErrorMessage ? (
              <div className="error" role="alert">
                <span>{chatErrorMessage}</span>
                <div className="button-row">
                  <button
                    className="button button-compact"
                    onClick={() => {
                      clearError();
                      setEmptyResponseMessage(null);
                    }}
                    type="button"
                  >
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
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <div className="composer-mode" aria-label="Run mode" role="radiogroup">
              {runModes.map((mode) => (
                <button
                  aria-checked={runMode === mode.id}
                  className="mode-chip"
                  data-active={runMode === mode.id ? "true" : "false"}
                  key={mode.id}
                  onClick={() => setRunMode(mode.id)}
                  role="radio"
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {runMode === "train" ? (
              <TrainPlanPanel
                connected={connected}
                onAddStep={() => setTrainPlan((current) => addTrainStep(current))}
                onApproveAll={() => setTrainPlan((current) => approveAllTrainSteps(current))}
                onClear={() => setTrainPlan(defaultTrainPlanState())}
                onDraft={draftTrainPlanFromComposer}
                onGranularChange={(granular) => setTrainPlan((current) => ({ ...current, granular }))}
                onMoveStep={(id, direction) => setTrainPlan((current) => moveTrainStep(current, id, direction))}
                onObjectiveChange={(objective) => setTrainPlan((current) => ({ ...current, objective, draftVisible: true }))}
                onRemoveStep={(id) => setTrainPlan((current) => removeTrainStep(current, id))}
                onStepApprovalChange={(id, approved) => setTrainPlan((current) => updateTrainStep(current, id, { approved }))}
                onStepTextChange={(id, text) => setTrainPlan((current) => updateTrainStep(current, id, { text }))}
                plan={trainPlan}
              />
            ) : null}
            <textarea
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              onKeyDown={onComposerKeyDown}
              placeholder={connected ? "Ask, or start with /goal to set an active objective..." : "Reconnect to continue..."}
              ref={composerInputRef}
              rows={1}
            />
            <button className="button button-primary" disabled={!connected || busy} type="submit">
              {busy ? "Working" : "Send"}
            </button>
          </form>
        </section>

        <aside className="side-panel" aria-label="Artifact canvas and runtime details">
          <div className="panel-header">
            <h2>Canvas</h2>
            <p>Artifacts, workspace state, and runtime controls for this deployed agent.</p>
          </div>
          <div className="side-body" id="runtime">
            <ArtifactStage summary={capabilitySummary} />
            <Metric label="Transport" value="useAgent WebSocket" />
            <Metric label="Chat lifecycle" value="useAgentChat" />
            <Metric label="Socket detail" value={socketDiagnostic?.detail ?? connectionState} />
            <Metric label="Model" value={clientConfig.defaultModel} />
            <Metric label="MCP policy" value={formatToolApprovalPolicy(clientConfig.toolApprovalPolicy)} />
            <Metric label="Code Mode" value={formatCodeMode(codeModeState)} />
            <Metric label="History" value="SQLite persisted" />
            <Metric label="MCP servers" value={formatMcpStatus(mcpReadyCount, mcpServerValues.length)} />
            <Metric label="Approvals" value={pendingApprovalCount ? \`\${pendingApprovalCount} pending\` : "None pending"} />
            <Metric label="Tool allowlist" value={formatToolAllowlist(alwaysAllowedToolCount)} />
            <Metric label="Executor MCP" value={formatExecutionPlane(executionState?.executor)} />
            <Metric label="Sandbox" value={formatExecutionPlane(executionState?.sandbox)} />
            <Metric label="Containers" value={formatExecutionPlane(executionState?.containers)} />
            <BrowserRunDiagnosticsPanel
              diagnostics={browserDiagnostics}
              loading={browserDiagnosticsBusy}
              onRefresh={loadBrowserDiagnostics}
              onRun={runBrowserDiagnostics}
            />
            <Metric label="Slash commands" value="/goal enabled" />
            <Metric label="Workspace" value={formatWorkspaceState(workspaceState)} />
            <Metric label="Sub-agents" value={subAgents.length ? \`\${activeSubAgentCount}/\${subAgents.length} active\` : "None"} />
            <div className="button-row">
              {busy ? (
                <button className="button" onClick={stop} type="button">
                  Stop
                </button>
              ) : null}
              <button
                className="button"
                disabled={connected}
                onClick={forceReconnect}
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
            <HostedAgentPanel copied={sdkCopied} onCopy={copySdkSnippet} />
            <CapabilityCanvas
              learningActionId={learningActionId}
              onCurateLearning={curateLearningSuggestion}
              onEditLearning={editLearningSuggestion}
              onRefresh={loadCapabilitySummary}
              summary={capabilitySummary}
            />
            <SubAgentConsole
              briefSubAgentInMainChat={briefSubAgentInMainChat}
              connected={connected}
              controlSubAgent={controlSubAgent}
              draft={subAgentDraft}
              error={subAgentError}
              loading={subAgentBusy}
              mainBusy={busy}
              messages={subAgentMessages}
              onCreate={onCreateSubAgent}
              onDraftChange={setSubAgentDraft}
              onExplore={exploreSelectedSubAgent}
              onRefreshSummary={refreshSubAgentSummary}
              onSelect={setSelectedSubAgentId}
              onSendMessage={sendSubAgentPrompt}
              selected={selectedSubAgent}
              loadingAction={subAgentAction}
              subAgents={subAgents}
            />
          </div>
        </aside>
      </section>

      <CommandPalette
        onClose={() => setSearchOpen(false)}
        onQueryChange={setSearchQuery}
        open={searchOpen}
        query={searchQuery}
        results={searchResults}
      />
    </>
  );
}

function TrainPlanPanel({
  connected,
  onAddStep,
  onApproveAll,
  onClear,
  onDraft,
  onGranularChange,
  onMoveStep,
  onObjectiveChange,
  onRemoveStep,
  onStepApprovalChange,
  onStepTextChange,
  plan
}: {
  connected: boolean;
  onAddStep: () => void;
  onApproveAll: () => void;
  onClear: () => void;
  onDraft: () => void;
  onGranularChange: (granular: boolean) => void;
  onMoveStep: (id: string, direction: -1 | 1) => void;
  onObjectiveChange: (objective: string) => void;
  onRemoveStep: (id: string) => void;
  onStepApprovalChange: (id: string, approved: boolean) => void;
  onStepTextChange: (id: string, text: string) => void;
  plan: TrainPlanState;
}) {
  const approvedCount = plan.steps.filter((step) => step.approved).length;
  const ready = trainPlanReadyToRun(plan);

  return (
    <section className="train-panel" aria-label="Editable train plan" data-ready={ready ? "true" : "false"}>
      <div className="train-panel-heading">
        <div>
          <strong>Train plan</strong>
          <p>
            Draft, edit, and approve a repeatable plan before the agent acts. Send runs only after the plan is approved.
          </p>
        </div>
        <div className="button-row">
          <button className="button button-compact" disabled={!connected} onClick={onDraft} type="button">
            Draft plan
          </button>
          {plan.draftVisible ? (
            <button className="button button-compact" onClick={onClear} type="button">
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {plan.draftVisible ? (
        <>
          <label className="train-objective">
            <span>Objective</span>
            <input
              onChange={(event) => onObjectiveChange(event.currentTarget.value)}
              placeholder="What should this train-mode run accomplish?"
              type="text"
              value={plan.objective}
            />
          </label>

          <div className="train-options">
            <label>
              <input
                checked={plan.granular}
                onChange={(event) => onGranularChange(event.currentTarget.checked)}
                type="checkbox"
              />
              Step-by-step approval
            </label>
            <span>
              {approvedCount}/{plan.steps.length} approved
            </span>
          </div>

          <ol className="train-step-list">
            {plan.steps.map((step, index) => (
              <li className="train-step" data-approved={step.approved ? "true" : "false"} key={step.id}>
                <label className="train-step-check">
                  <input
                    checked={step.approved}
                    onChange={(event) => onStepApprovalChange(step.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{step.approved ? "Approved" : "Review"}</span>
                </label>
                <textarea
                  aria-label={"Train step " + String(index + 1)}
                  onChange={(event) => onStepTextChange(step.id, event.currentTarget.value)}
                  rows={2}
                  value={step.text}
                />
                <div className="train-step-actions">
                  <button className="button button-compact" disabled={index === 0} onClick={() => onMoveStep(step.id, -1)} type="button">
                    Up
                  </button>
                  <button
                    className="button button-compact"
                    disabled={index === plan.steps.length - 1}
                    onClick={() => onMoveStep(step.id, 1)}
                    type="button"
                  >
                    Down
                  </button>
                  <button className="button button-compact" onClick={() => onRemoveStep(step.id)} type="button">
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>

          <div className="train-footer">
            <p>{ready ? "Ready to run. Press Send to execute the approved train plan." : trainPlanReadinessCopy(plan)}</p>
            <div className="button-row">
              <button className="button button-compact" onClick={onAddStep} type="button">
                Add step
              </button>
              <button className="button button-compact" disabled={plan.steps.length === 0} onClick={onApproveAll} type="button">
                Approve all
              </button>
            </div>
          </div>
        </>
      ) : (
        <p className="train-empty">
          Type the objective, then press Send or Draft plan. The editable plan appears here before any tools run.
        </p>
      )}
    </section>
  );
}

function Message({
  activeApprovalIds,
  approveToolAlways,
  message,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  message: UIMessage;
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  const parts = compactMessageParts(message.parts).filter(({ part }) => partHasVisibleContent(part, activeApprovalIds));
  if (parts.length === 0) return null;
  const blocks = messageRenderBlocks(parts);

  return (
    <article className="message" data-role={message.role}>
      <small>{message.role}</small>
      {blocks.map((block, index) =>
        block.kind === "tool-group" ? (
          <ToolPartGroup
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key + ":" + String(index)}
            parts={block.parts}
            respondToToolApproval={respondToToolApproval}
          />
        ) : (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={block.key + ":" + String(index)}
            part={block.part}
            respondToToolApproval={respondToToolApproval}
          />
        )
      )}
    </article>
  );
}

function shouldRenderMessagePart(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  if (!isToolUIPart(part)) return true;

  const approval = getToolApproval(part);
  if (!approval?.id || activeApprovalIds.has(approval.id)) return true;

  const stateKey = String(getToolPartState(part));
  return stateKey !== "waiting-approval" && stateKey !== "approved" && stateKey !== "approval-responded";
}

function ToolPartGroup({
  activeApprovalIds,
  approveToolAlways,
  parts,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
  approveToolAlways: (toolName: string, approvalId?: string) => void;
  parts: MessagePartEntry[];
  respondToToolApproval: (approvalId: string | undefined, toolCallId: string | undefined, approved: boolean) => boolean;
}) {
  const summary = summarizeToolGroup(parts, activeApprovalIds);
  const renderDetails = summary.defaultOpen || summary.state !== "streaming";

  return (
    <details className="tool-group" data-state={summary.state} open={summary.defaultOpen ? true : undefined}>
      <summary>
        <span className="tool-group-title">
          <strong>{summary.title}</strong>
          <small>{summary.detail}</small>
        </span>
        <span className="tool-group-meta">
          <span className="pill" data-state={summary.state}>{toolStateLabel(summary.state)}</span>
          <span className="tool-group-toggle">Details</span>
        </span>
      </summary>
      <div className="tool-group-details">
        {renderDetails ? parts.map(({ part, index }, partIndex) => (
          <MessagePart
            activeApprovalIds={activeApprovalIds}
            approveToolAlways={approveToolAlways}
            key={partKey(part, index) + ":" + String(partIndex)}
            part={part}
            respondToToolApproval={respondToToolApproval}
          />
        )) : <p className="tool-note">Details are available when this tool call settles.</p>}
      </div>
    </details>
  );
}

function MessagePart({
  activeApprovalIds,
  approveToolAlways,
  part,
  respondToToolApproval
}: {
  activeApprovalIds: ReadonlySet<string>;
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
    const stateKey = String(state);
    const isApprovalState = stateKey === "waiting-approval" || stateKey === "approved" || stateKey === "approval-responded";
    const approvalIsActive = toolPartHasActiveApproval(part, activeApprovalIds);
    const displayState = toolPartDisplayState(part, activeApprovalIds);
    const canRespondToApproval = Boolean(approval?.id && toolCallId && approvalIsActive);
    const showToolPayload = displayState !== "expired-approval";
    const presentation = summarizeToolPart(part, activeApprovalIds);
    const hasRawPayload = showToolPayload && (Boolean(input) || Boolean(output));

    return (
      <div className="tool-part" data-state={displayState}>
        <div className="tool-heading">
          <div className="tool-summary-copy">
            <strong>{presentation.title}</strong>
            {presentation.description ? <p>{presentation.description}</p> : null}
            {presentation.outcome ? <p className="tool-outcome">{presentation.outcome}</p> : null}
          </div>
          <span className="pill" data-state={displayState}>{toolStateLabel(displayState)}</span>
        </div>
        {state === "waiting-approval" && approvalIsActive ? (
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
        {isApprovalState && !approvalIsActive ? (
          <p className="tool-note">
            This approval belongs to an older turn and is no longer actionable. Send a new request to run it again.
          </p>
        ) : null}
        {state === "denied" ? <p className="tool-note">Rejected by owner.</p> : null}
        {hasRawPayload ? (
          <details className="tool-raw-details">
            <summary>Raw details</summary>
            <div className="tool-raw-section">
              <span className="tool-output-label">Tool</span>
              <code className="tool-inline-code">{presentation.rawName}</code>
            </div>
            {input ? (
              <div className="tool-raw-section">
                <span className="tool-output-label">Input</span>
                <pre>{formatJson(input)}</pre>
              </div>
            ) : null}
            {output ? (
              <div className="tool-raw-section">
                <span className="tool-output-label">Output</span>
                <pre>{formatJson(output)}</pre>
              </div>
            ) : null}
          </details>
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

function CommandPalette({
  onClose,
  onQueryChange,
  open,
  query,
  results
}: {
  onClose: () => void;
  onQueryChange: (query: string) => void;
  open: boolean;
  query: string;
  results: SearchResult[];
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="command-overlay" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Search workspace"
        aria-modal="true"
        className="command-palette"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="command-input-row">
          <input
            aria-label="Search threads, artifacts, skills, and memories"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search threads, artifacts, skills, memories..."
            ref={inputRef}
            value={query}
          />
          <button className="button button-compact" onClick={onClose} type="button">
            Esc
          </button>
        </div>
        <div className="command-tabs" aria-label="Search scopes">
          <span>Threads</span>
          <span>Artifacts</span>
          <span>Memories</span>
          <span>Agents</span>
        </div>
        <div className="command-results">
          {results.length > 0 ? (
            results.map((result, index) => (
              <a className="command-result" href={result.target} key={result.id + ":" + String(index)} onClick={onClose}>
                <span>{result.kind}</span>
                <strong>{result.title}</strong>
                <small>{result.detail}</small>
              </a>
            ))
          ) : (
            <p>No results yet. Try a message, artifact name, skill, or sub-agent.</p>
          )}
        </div>
        <footer className="command-footer">Ctrl K opens search. Enter opens the selected result in its workspace surface.</footer>
      </section>
    </div>
  );
}

function PersonaSidebar({
  activeSubAgentCount,
  focusComposer,
  openSearch,
  pendingApprovalCount,
  summary
}: {
  activeSubAgentCount: number;
  focusComposer: () => void;
  openSearch: () => void;
  pendingApprovalCount: number;
  summary: CapabilitySummary | null;
}) {
  const artifactCount = summary?.artifacts?.artifacts?.length ?? 0;
  const skillCount = summary?.skills?.skills?.length ?? 0;
  const learningCount =
    Number(summary?.learning?.memories?.pending ?? 0) +
    Number(summary?.learning?.skills?.pending ?? 0);
  const recentThreads = ["Current conversation", "Workspace brief", "Sub-agent reports"];

  return (
    <nav className="persona-sidebar" aria-label="Workspace navigation">
      <button className="button button-primary sidebar-primary" onClick={focusComposer} type="button">
        New Task
      </button>
      <button className="sidebar-link" onClick={openSearch} type="button">
        Search <span>Ctrl K</span>
      </button>
      <a href="#artifact-canvas">
        Library <span>{artifactCount}</span>
      </a>
      <a href="#learning">
        Learning <span>{learningCount}</span>
      </a>
      <a href="#skills">
        Skills <span>{skillCount}</span>
      </a>
      <div className="sidebar-divider" />
      <small>Recent</small>
      {recentThreads.map((thread) => (
        <a href="#chat-feed" key={thread}>{thread}</a>
      ))}
      <div className="sidebar-divider" />
      <a href="#subagents">
        Sub-agents <span>{activeSubAgentCount}</span>
      </a>
      <a href="#runtime">
        Approvals <span>{pendingApprovalCount}</span>
      </a>
    </nav>
  );
}

function ArtifactStage({ summary }: { summary: CapabilitySummary | null }) {
  const artifacts = summary?.artifacts?.artifacts ?? [];
  const [mode, setMode] = useState<ArtifactCanvasMode>("single");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedVersion, setSelectedVersion] = useState("");
  const [detail, setDetail] = useState<ArtifactDetailResponse | null>(null);
  const [poppedArtifact, setPoppedArtifact] = useState(false);
  const featured = artifacts.find((artifact) => artifact.key === selectedKey) ?? artifacts[0];
  const learning = summary?.learning;
  const skills = summary?.skills?.skills ?? [];

  useEffect(() => {
    if (!artifacts.length) {
      setSelectedKey("");
      setSelectedVersion("");
      setDetail(null);
      return;
    }
    if (!featured) {
      setSelectedKey(artifacts[0]?.key ?? "");
    }
  }, [artifacts, featured]);

  useEffect(() => {
    if (!featured?.key) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ key: featured.key, versions: "1" });
    if (selectedVersion) params.set("version", selectedVersion);
    optionalJsonFetch<ArtifactDetailResponse>("/artifacts?" + params.toString(), { signal: controller.signal })
      .then((next) => {
        if (!controller.signal.aborted) setDetail(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setDetail(null);
      });
    return () => controller.abort();
  }, [featured?.key, selectedVersion]);

  const versions = detail?.versions ?? [];
  const artifactText = detail?.text ?? "";

  return (
    <section className="artifact-stage" id="artifact-canvas" aria-label="Artifact canvas">
      <div className="artifact-stage-header">
        <div>
          <strong>{featured?.title || featured?.key || "No artifact selected"}</strong>
          <small>{featured?.type || "Workspace canvas"}{featured?.versions ? " / v" + String(featured.versions) : ""}</small>
        </div>
        <div className="canvas-mode-toggle" aria-label="Canvas mode">
          {(["single", "grid", "stack"] as const).map((nextMode) => (
            <button
              aria-pressed={mode === nextMode}
              key={nextMode}
              onClick={() => setMode(nextMode)}
              type="button"
            >
              {titleCase(nextMode)}
            </button>
          ))}
        </div>
      </div>
      {versions.length > 1 ? (
        <label className="artifact-version-picker">
          <span>Version</span>
          <select onChange={(event) => setSelectedVersion(event.target.value)} value={selectedVersion}>
            {versions.map((version) => (
              <option key={version.versionKey} value={version.current ? "" : version.versionKey}>
                {version.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className={"artifact-preview artifact-preview-" + mode}>
        {featured ? (
          mode === "grid" ? (
            artifacts.slice(0, 4).map((artifact, index) => (
              <button className="artifact-grid-card" key={artifact.key + ":" + String(index)} onClick={() => setSelectedKey(artifact.key)} type="button">
                <span>{artifact.type || "artifact"}</span>
                <strong>{artifact.title || artifact.key}</strong>
                <small>{artifact.uploaded ? formatRelativeTime(artifact.uploaded) : "Ready"}</small>
              </button>
            ))
          ) : mode === "stack" ? (
            <div className="artifact-stack">
              {artifacts.slice(0, 8).map((artifact, index) => (
                <button
                  className="artifact-stack-card"
                  key={artifact.key + ":" + String(index)}
                  onClick={() => setSelectedKey(artifact.key)}
                  style={{ transform: "translateY(" + String(index * 6) + "px)" }}
                  type="button"
                >
                  <span>{artifact.type || "artifact"}</span>
                  <strong>{artifact.title || artifact.key}</strong>
                </button>
              ))}
            </div>
          ) : (
            <ArtifactInlinePreview artifact={featured} text={artifactText} />
          )
        ) : (
          <>
            <span>Workspace</span>
            <strong>Artifacts will appear here</strong>
            <small>Documents, code, tables, images, and app previews</small>
          </>
        )}
      </div>
      {featured ? (
        <button className="button button-compact artifact-popout-trigger" onClick={() => setPoppedArtifact(true)} type="button">
          Pop out artifact
        </button>
      ) : null}
      <div className="artifact-rail" aria-label="Artifact thumbnails">
        {artifacts.slice(0, 6).map((artifact, index) => (
          <button
            aria-pressed={featured?.key === artifact.key}
            className="artifact-thumb"
            key={artifact.key + ":" + String(index)}
            onClick={() => {
              setSelectedKey(artifact.key);
              setSelectedVersion("");
            }}
            type="button"
          >
            {artifact.type || "file"}
          </button>
        ))}
        {artifacts.length === 0 ? <span className="artifact-thumb">empty</span> : null}
      </div>
      <div className="canvas-quicklinks">
        <a href="#learning" id="learning">Train {learning ? formatLearningState(learning) : "ready"}</a>
        <a href="#skills" id="skills">Skills {skills.length}</a>
      </div>
      {poppedArtifact && featured ? (
        <div className="artifact-popout" role="dialog" aria-modal="true" aria-label="Artifact preview">
          <div className="artifact-popout-window">
            <div className="artifact-popout-header">
              <div>
                <strong>{featured.title || featured.key}</strong>
                <small>{featured.type || "artifact"}</small>
              </div>
              <button className="button button-compact" onClick={() => setPoppedArtifact(false)} type="button">
                Close
              </button>
            </div>
            <ArtifactInlinePreview artifact={featured} text={artifactText} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ArtifactInlinePreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const type = artifact.type || "artifact";
  if (type === "browser-session") {
    return <BrowserSessionPreview artifact={artifact} session={parseBrowserSessionArtifact(text)} />;
  }
  if (type === "webpage" && text) {
    return <iframe className="artifact-web-preview" sandbox="" srcDoc={text} title={artifact.title || artifact.key} />;
  }
  if (type === "image") {
    return <ImageArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "slides") {
    return <SlidesArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "diff" || isDiffArtifactKey(artifact.key)) {
    return <DiffArtifactPreview artifact={artifact} text={text} />;
  }
  if (type === "table" && text) {
    const rows = parseDelimitedRows(text).slice(0, 12);
    if (rows.length > 0) {
      const [header = [], ...body] = rows;
      return (
        <div className="artifact-table-preview">
          <span>{type}</span>
          <strong>{artifact.title || artifact.key}</strong>
          <div className="artifact-table-scroll">
            <table>
              <thead>
                <tr>
                  {header.map((cell, index) => <th key={String(index)}>{cell || "Column " + String(index + 1)}</th>)}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={String(rowIndex)}>
                    {header.map((_cell, cellIndex) => <td key={String(cellIndex)}>{row[cellIndex] ?? ""}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
  }
  return (
    <div className="artifact-text-preview">
      <span>{type}</span>
      <strong>{artifact.title || artifact.key}</strong>
      <small>{artifact.uploaded ? formatRelativeTime(artifact.uploaded) : "Ready"}</small>
      {text ? <pre>{text.slice(0, 2400)}</pre> : <p>Open or generate content to preview this artifact.</p>}
    </div>
  );
}

function DiffArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const patch = text.trim();
  const stats = summarizePatch(patch);
  return (
    <div className="artifact-diff-preview">
      <div className="artifact-preview-heading">
        <span>diff</span>
        <strong>{artifact.title || artifact.key}</strong>
      </div>
      <div className="artifact-diff-stats">
        <span>{stats.files} files</span>
        <span>+{stats.additions}</span>
        <span>-{stats.deletions}</span>
      </div>
      {patch ? (
        <Suspense fallback={<pre>{patch.slice(0, 2400)}</pre>}>
          <PatchDiffRenderer patch={patch} />
        </Suspense>
      ) : (
        <p>No patch content is available for this artifact.</p>
      )}
    </div>
  );
}

function ImageArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const source = imageSourceFromText(text);
  const title = artifact.title || artifact.key;
  return (
    <div className="artifact-image-preview">
      <div className="artifact-preview-heading">
        <span>image</span>
        <strong>{title}</strong>
      </div>
      {source ? (
        <>
          <div className="artifact-image-frame">
            <img alt={title} src={source} />
          </div>
          <div className="artifact-preview-actions">
            <a className="button button-compact" href={source} rel="noreferrer" target="_blank">Open</a>
            <a className="button button-compact" download={artifact.key.split("/").pop() || "image"} href={source}>Download</a>
          </div>
        </>
      ) : (
        <p>Image content is available, but it is not a URL, data URL, markdown image, or base64 image payload.</p>
      )}
    </div>
  );
}

function SlidesArtifactPreview({ artifact, text }: { artifact: ArtifactListItem; text: string }) {
  const slides = parseSlidesArtifact(text);
  const [index, setIndex] = useState(0);
  const activeIndex = Math.min(index, Math.max(slides.length - 1, 0));
  const slide = slides[activeIndex];

  return (
    <div className="artifact-slides-preview">
      <div className="artifact-preview-heading">
        <span>slides</span>
        <strong>{artifact.title || artifact.key}</strong>
      </div>
      {slide ? (
        <>
          <div className="artifact-slide-frame">
            {slide.title ? <h3>{slide.title}</h3> : null}
            {slide.body ? <pre>{slide.body}</pre> : <p>No slide body.</p>}
          </div>
          <div className="artifact-slide-controls">
            <button className="button button-compact" disabled={activeIndex <= 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} type="button">Prev</button>
            <span>{activeIndex + 1} / {Math.max(slides.length, 1)}</span>
            <button className="button button-compact" disabled={activeIndex >= slides.length - 1} onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} type="button">Next</button>
          </div>
          {slide.notes ? <p className="artifact-slide-notes">{slide.notes}</p> : null}
        </>
      ) : (
        <p>No slides found. Use JSON with a "slides" array or markdown slides separated by "---".</p>
      )}
    </div>
  );
}

type BrowserSessionArtifact = {
  mode?: string | null;
  url?: string | null;
  title?: string | null;
  status?: string | null;
  capturedAt?: string | null;
  createdAt?: string | null;
  sessionId?: string | null;
  screenshotDataUrl?: string | null;
  screenshotUrl?: string | null;
  html?: string | null;
  devtoolsFrontendUrl?: string | null;
  takeoverUrl?: string | null;
  webSocketDebuggerUrl?: string | null;
  target?: BrowserSessionTarget | null;
  targets?: BrowserSessionTarget[];
  events?: Array<{
    label?: string;
    status?: string;
    at?: string;
  }>;
};

type BrowserSessionTarget = {
  id?: string;
  type?: string;
  url?: string;
  title?: string;
  devtoolsFrontendUrl?: string;
  webSocketDebuggerUrl?: string;
};

function BrowserSessionPreview({
  artifact,
  session
}: {
  artifact: ArtifactListItem;
  session: BrowserSessionArtifact | null;
}) {
  const [streamFrame, setStreamFrame] = useState("");
  const [streamStatus, setStreamStatus] = useState<"idle" | "connecting" | "streaming" | "failed" | "done">("idle");
  const title = session?.title || artifact.title || artifact.key;
  const primaryTarget = session?.target || session?.targets?.find((target) => target.devtoolsFrontendUrl || target.url) || null;
  const liveViewUrl = session?.devtoolsFrontendUrl || session?.takeoverUrl || primaryTarget?.devtoolsFrontendUrl || "";
  const webSocketUrl = session?.webSocketDebuggerUrl || primaryTarget?.webSocketDebuggerUrl || "";
  const targetUrl = session?.url || primaryTarget?.url || "about:blank";
  const screenshot = session?.screenshotDataUrl || session?.screenshotUrl || "";
  const frameStreamUrl = session?.mode === "live" && session?.sessionId && primaryTarget?.id
    ? \`/browser/sessions/\${encodeURIComponent(session.sessionId)}/targets/\${encodeURIComponent(primaryTarget.id)}/frames?fps=4\`
    : "";
  const frameStreamStatusUrl = session?.mode === "live" && session?.sessionId && primaryTarget?.id
    ? \`/browser/sessions/\${encodeURIComponent(session.sessionId)}/targets/\${encodeURIComponent(primaryTarget.id)}/frames/status?fps=4\`
    : "";
  const liveFrame = streamFrame || screenshot;
  const status = session?.status || "ready";
  const timestamp = session?.capturedAt || session?.createdAt || null;

  useEffect(() => {
    if (!frameStreamUrl || !frameStreamStatusUrl) {
      setStreamFrame("");
      setStreamStatus("idle");
      return undefined;
    }
    let cancelled = false;
    let events: EventSource | null = null;
    setStreamStatus("connecting");
    void fetch(frameStreamStatusUrl, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ hasWebSocketDebuggerUrl?: boolean }>)
      .then((data) => {
        if (cancelled) return;
        if (!data.hasWebSocketDebuggerUrl) {
          setStreamStatus("failed");
          return;
        }
        events = new EventSource(frameStreamUrl);
        events.addEventListener("status", (event) => {
          const eventData = parseJsonEventData(event);
          setStreamStatus(eventData?.status === "streaming" ? "streaming" : "connecting");
        });
        events.addEventListener("frame", (event) => {
          const eventData = parseJsonEventData(event);
          if (typeof eventData?.screenshotDataUrl === "string") {
            setStreamFrame(eventData.screenshotDataUrl);
            setStreamStatus("streaming");
          }
        });
        events.addEventListener("done", () => setStreamStatus("done"));
        events.addEventListener("error", () => setStreamStatus("failed"));
        events.onerror = () => setStreamStatus("failed");
      })
      .catch(() => {
        if (!cancelled) setStreamStatus("failed");
      });
    return () => {
      cancelled = true;
      events?.close();
    };
  }, [frameStreamUrl, frameStreamStatusUrl]);

  return (
    <div className="artifact-browser-session">
      <div className="browser-chrome">
        <span className="browser-dots" aria-hidden="true"><i /><i /><i /></span>
        <code>{targetUrl}</code>
        <span className="pill" data-state={status === "captured" ? "ready" : undefined}>{status}</span>
      </div>
      <div className="browser-viewport">
        {liveFrame ? (
          <img alt={title} src={liveFrame} />
        ) : liveViewUrl ? (
          <iframe
            allow="clipboard-read; clipboard-write; fullscreen"
            referrerPolicy="no-referrer"
            src={liveViewUrl}
            title={title + " live view"}
          />
        ) : session?.html ? (
          <iframe sandbox="" srcDoc={session.html} title={title} />
        ) : (
          <div className="browser-empty-state">
            <strong>{title}</strong>
            <small>Browser session metadata is ready. Capture a snapshot to show the viewport.</small>
          </div>
        )}
      </div>
      <div className="browser-session-actions">
        {liveViewUrl ? <a className="button button-compact" href={liveViewUrl} rel="noreferrer" target="_blank">Live View</a> : null}
        {webSocketUrl ? <span title={webSocketUrl}>CDP session ready</span> : null}
        {frameStreamUrl ? <span className="browser-stream-status" data-state={streamStatus}>{streamStatus === "streaming" ? "Frames 4 fps" : streamStatus}</span> : null}
        <span>{timestamp ? "Updated " + formatRelativeTime(timestamp) : "Ready for Browser Run sessions"}</span>
      </div>
      {session?.sessionId || primaryTarget?.id ? (
        <div className="browser-session-meta">
          {session?.sessionId ? <span>Session <code>{session.sessionId}</code></span> : null}
          {primaryTarget?.id ? <span>Target <code>{primaryTarget.id}</code></span> : null}
        </div>
      ) : null}
      {session?.events?.length ? (
        <ul className="browser-session-events">
          {session.events.slice(0, 4).map((event, index) => (
            <li key={String(index)}>
              <span>{event.label || "Browser event"}</span>
              <small>{event.status || "recorded"}{event.at ? " / " + formatRelativeTime(event.at) : ""}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function parseJsonEventData(event: Event): Record<string, unknown> | null {
  const message = event as MessageEvent<string>;
  try {
    return JSON.parse(message.data) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseBrowserSessionArtifact(text: string): BrowserSessionArtifact | null {
  if (!text.trim()) return null;
  try {
    const value = JSON.parse(text) as BrowserSessionArtifact;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

type SlidePreview = {
  title?: string;
  body?: string;
  notes?: string;
};

function isDiffArtifactKey(key: string): boolean {
  return /\\.(diff|patch)$/i.test(key);
}

function summarizePatch(patch: string): { files: number; additions: number; deletions: number } {
  const lines = patch.split(/\\r?\\n/);
  const files = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) files.add(line);
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return {
    files: files.size || (patch.trim() ? 1 : 0),
    additions,
    deletions
  };
}

function imageSourceFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/^data:image\\//i.test(trimmed)) return trimmed;
  if (/^https?:\\/\\//i.test(trimmed)) return trimmed;
  const markdownMatch = trimmed.match(/!\\[[^\\]]*]\\(([^)]+)\\)/);
  if (markdownMatch?.[1]) return markdownMatch[1].trim();
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const candidate = parsed.src ?? parsed.url ?? parsed.dataUrl ?? parsed.image;
    if (typeof candidate === "string") return imageSourceFromText(candidate);
  } catch {
    // Fall through to raw base64 detection.
  }
  if (/^[A-Za-z0-9+/=\\s]+$/.test(trimmed) && trimmed.replace(/\\s/g, "").length > 120) {
    return "data:image/png;base64," + trimmed.replace(/\\s/g, "");
  }
  return "";
}

function parseSlidesArtifact(text: string): SlidePreview[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const rawSlides = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { slides?: unknown }).slides)
        ? (parsed as { slides: unknown[] }).slides
        : [];
    if (rawSlides.length > 0) {
      return rawSlides.map((item, index) => {
        if (typeof item === "string") return { title: "Slide " + String(index + 1), body: item };
        if (item && typeof item === "object") {
          const record = item as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title : typeof record.heading === "string" ? record.heading : "Slide " + String(index + 1);
          const body = typeof record.body === "string"
            ? record.body
            : Array.isArray(record.bullets)
              ? record.bullets.map((bullet) => "- " + String(bullet)).join("\\n")
              : typeof record.content === "string"
                ? record.content
                : "";
          const notes = typeof record.notes === "string" ? record.notes : "";
          return notes ? { title, body, notes } : { title, body };
        }
        return { title: "Slide " + String(index + 1), body: String(item) };
      });
    }
  } catch {
    // Markdown slides are parsed below.
  }

  return trimmed
    .split(/\\n-{3,}\\n/g)
    .map((chunk, index) => {
      const lines = chunk.trim().split(/\\r?\\n/);
      const first = lines[0]?.replace(/^#+\\s*/, "").trim();
      const body = lines.slice(first ? 1 : 0).join("\\n").trim();
      return { title: first || "Slide " + String(index + 1), body };
    })
    .filter((slide) => slide.title || slide.body);
}

function parseDelimitedRows(text: string): string[][] {
  const lines = text.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
  const delimiter = lines.some((line) => line.includes("\t")) ? "\t" : ",";
  return lines.map((line) =>
    line
      .split(delimiter)
      .map((cell) => cell.trim().replace(/^"|"$/g, ""))
  );
}

function HostedAgentPanel({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  const origin = typeof window === "undefined" ? "https://your-agent.workers.dev" : window.location.origin;
  return (
    <section className="hosted-agent-panel" aria-label="Hosted Cloud Agent developer flow">
      <div className="section-heading">
        <div>
          <h3>Hosted Agent</h3>
          <p>End-to-end Cloudflare agent surface for app developers and sub-agents.</p>
        </div>
        <span className="pill">SDK</span>
      </div>
      <ol className="flow-list">
        {hostedFlowSteps.map((step) => (
          <li className="flow-step" key={step.title}>
            <span>{step.index}</span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="sdk-card">
        <div>
          <strong>{clientConfig.sdkPackage}</strong>
          <small>{clientConfig.sdkFactory}({"{ baseUrl }"})</small>
        </div>
        <button className="button button-compact" onClick={onCopy} type="button">
          {copied ? "Copied" : "Copy SDK snippet"}
        </button>
      </div>
      <pre className="sdk-snippet">{hostedAgentSdkSnippet(origin)}</pre>
      <div className="customization-grid" aria-label="Customization options">
        <Metric label="Personal agent" value="Prompt, brain, skills" />
        <Metric label="Sub-agents" value="Purpose, mode, model" />
        <Metric label="Runtime" value="Model, approvals, executor" />
      </div>
    </section>
  );
}

function BrowserRunDiagnosticsPanel({
  diagnostics,
  loading,
  onRefresh,
  onRun
}: {
  diagnostics: BrowserDiagnosticsResponse | null;
  loading: boolean;
  onRefresh: () => void;
  onRun: () => void;
}) {
  const stages = diagnostics?.stages ?? [];
  const state = browserDiagnosticsPillState(diagnostics);
  return (
    <section className="browser-diagnostics-panel" aria-label="Browser Run diagnostics">
      <div className="section-heading">
        <div>
          <h3>Browser Run</h3>
          <p>{diagnostics?.summary ?? "Check Browser Rendering credentials, API access, CDP, and frame capture."}</p>
        </div>
        <span className="pill" data-state={state}>{diagnostics ? titleCase(diagnostics.status) : "Checking"}</span>
      </div>
      <div className="browser-diagnostics-actions">
        <button className="button button-compact" disabled={loading} onClick={onRefresh} type="button">
          Refresh
        </button>
        <button className="button button-compact button-primary" disabled={loading} onClick={onRun} type="button">
          {loading ? "Running" : "Run live check"}
        </button>
      </div>
      {stages.length > 0 ? (
        <ol className="diagnostic-stage-list">
          {stages.map((stage) => (
            <li data-state={stage.status} key={stage.id}>
              <span>{stage.label}</span>
              <small>{stage.summary}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="diagnostic-empty">No Browser Run diagnostics have been loaded yet.</p>
      )}
    </section>
  );
}

function CapabilityCanvas({
  learningActionId,
  onCurateLearning,
  onEditLearning,
  onRefresh,
  summary
}: {
  learningActionId: string | null;
  onCurateLearning: (id: string, status: LearningSuggestionStatus) => void;
  onEditLearning: (suggestion: LearningSuggestion) => void;
  onRefresh: () => void;
  summary: CapabilitySummary | null;
}) {
  const artifacts = summary?.artifacts?.artifacts ?? [];
  const skills = summary?.skills?.skills ?? [];
  const learning = summary?.learning;
  const learningSuggestions = learning?.suggestions?.items ?? [];
  const pendingLearningSuggestions = learningSuggestions.filter((suggestion) => suggestion.status === "pending");
  const mcpServers = summary?.mcp?.servers ?? [];
  const mcpObservability = summary?.mcpObservability;
  const contributions = summary?.contributions;
  const mcpEvents = mcpObservability?.recentEvents ?? [];
  const observedServers = mcpObservability?.servers ?? [];
  const executorStatus = summary?.executor?.status ?? "checking";

  return (
    <section className="capability-canvas" aria-label="Agent workspace canvas">
      <div className="section-heading">
        <div>
          <h3>Workspace Canvas</h3>
          <p>Artifacts, learning, skills, and execution status exposed through the hosted-agent SDK.</p>
        </div>
        <button className="button button-compact" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      <div className="canvas-grid">
        <Metric label="Artifacts" value={summary ? formatCapabilityCount(artifacts.length, summary.artifacts?.available) : "Loading"} />
        <Metric label="Learning" value={learning ? formatLearningState(learning) : "Loading"} />
        <Metric label="Skills" value={summary ? formatCapabilityCount(skills.length, summary.skills?.available) : "Loading"} />
        <Metric label="Executor" value={titleCase(executorStatus)} />
        <Metric label="PR lane" value={contributions ? (contributions.available ? "Ready" : "Token needed") : "Loading"} />
      </div>

      <div className="canvas-section">
        <strong>Library preview</strong>
        {artifacts.length > 0 ? (
          <ul className="compact-list">
            {artifacts.slice(0, 4).map((artifact, index) => (
              <li key={artifact.key + ":" + String(index)}>
                <span>{artifact.title || artifact.key}</span>
                <small>{artifact.type || "artifact"}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{summary?.artifacts?.note ?? "No artifacts yet. Generated documents, code, and app previews will appear here when AGENT_STORAGE is bound."}</p>
        )}
      </div>

      <div className="canvas-section">
        <strong>Active capabilities</strong>
        <div className="subagent-chip-row">
          {skills.slice(0, 6).map((skill, index) => (
            <span className="pill" data-state={skill.enabled ? "ready" : undefined} key={skill.id + ":" + String(index)}>
              {skill.label}
            </span>
          ))}
          {mcpServers.slice(0, 4).map((server, index) => (
            <span className="pill" data-state={server.configured ? "ready" : undefined} key={server.id + ":" + String(index)}>
              {server.label}
            </span>
          ))}
        </div>
      </div>

      <div className="canvas-section">
        <strong>Contribution lane</strong>
        <p>
          {contributions?.note ?? "The agent can prepare upstream pull requests when GitHub credentials are configured."}
        </p>
        <div className="subagent-chip-row">
          <span className="pill" data-state={contributions?.available ? "ready" : undefined}>
            {contributions?.repository ?? "NeoFlux-Holdings/OpenThink"}
          </span>
          <span className="pill" data-state={contributions?.artifactSourceAvailable ? "ready" : undefined}>
            Artifacts source
          </span>
        </div>
      </div>

      <div className="canvas-section mcp-observability-panel" id="mcp-observability">
        <div className="canvas-section-heading">
          <strong>MCP activity</strong>
          <small>{mcpObservability ? formatMcpObservabilityState(mcpObservability) : "Loading"}</small>
        </div>
        {observedServers.length > 0 ? (
          <div className="mcp-observability-grid">
            {observedServers.slice(0, 4).map((server, index) => (
              <div className="mcp-server-card" key={server.name + ":" + String(index)}>
                <span>{server.name}</span>
                <small>{server.transport || "unknown"} / {server.calls ?? 0} calls / {server.failures ?? 0} failures</small>
              </div>
            ))}
          </div>
        ) : null}
        {mcpEvents.length > 0 ? (
          <ul className="compact-list mcp-event-list">
            {mcpEvents.slice(0, 5).map((event, index) => (
              <li key={event.id + ":" + String(index)}>
                <span>{event.server} / {event.tool}</span>
                <small>{event.status} / {event.latencyMs}ms / {truncateText(event.summary, 90)}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{mcpObservability?.note ?? "MCP and executor activity will appear here after the first tool discovery, executor call, or workspace RPC call."}</p>
        )}
      </div>

      <div className="canvas-section learning-review-panel" id="learning">
        <div className="canvas-section-heading">
          <strong>Learning review</strong>
          <small>{learning ? formatLearningState(learning) : "Loading"}</small>
        </div>
        {pendingLearningSuggestions.length > 0 ? (
          <ul className="learning-suggestions">
            {pendingLearningSuggestions.slice(0, 4).map((suggestion, index) => (
              <li key={suggestion.id + ":" + String(index)}>
                <div>
                  <span>{suggestion.title}</span>
                  <small>{suggestion.kind} / {truncateText(suggestion.summary, 120)}</small>
                </div>
                <div className="learning-actions">
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onCurateLearning(suggestion.id, "accepted")}
                    type="button"
                  >
                    Accept
                  </button>
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onEditLearning(suggestion)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="button button-compact"
                    disabled={learningActionId === suggestion.id}
                    onClick={() => onCurateLearning(suggestion.id, "rejected")}
                    type="button"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>{learning ? "No pending learning suggestions. Accepted and rejected items stay in the learning log." : "Learning status is loading."}</p>
        )}
      </div>
    </section>
  );
}

function SubAgentConsole({
  briefSubAgentInMainChat,
  connected,
  controlSubAgent,
  draft,
  error,
  loading,
  mainBusy,
  messages,
  onCreate,
  onDraftChange,
  onExplore,
  onRefreshSummary,
  onSelect,
  onSendMessage,
  selected,
  loadingAction,
  subAgents
}: {
  briefSubAgentInMainChat: () => void;
  connected: boolean;
  controlSubAgent: (status: SubAgentStatus) => void;
  draft: SubAgentDraft;
  error: string | null;
  loading: boolean;
  mainBusy: boolean;
  messages: SubAgentMessage[];
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onDraftChange: (draft: SubAgentDraft) => void;
  onExplore: () => void;
  onRefreshSummary: () => void;
  onSelect: (id: string) => void;
  onSendMessage: (event: FormEvent<HTMLFormElement>) => void;
  selected: SubAgent | null;
  loadingAction: SubAgentAction | null;
  subAgents: SubAgent[];
}) {
  const readyCount = subAgents.filter((subAgent) => subAgent.status === "ready").length;
  const workingCount = subAgents.filter((subAgent) => subAgent.status === "working").length;
  const pausedCount = subAgents.filter((subAgent) => subAgent.status === "paused").length;

  return (
    <section className="subagent-console" id="subagents" aria-label="Sub-agent console">
      <div className="section-heading">
        <div>
          <h3>Agent Workstreams</h3>
          <p>Create focused child agents, track their state, and pull useful briefs back into chat.</p>
        </div>
        <span className="pill" data-state={subAgents.length ? "ready" : undefined}>{subAgents.length}</span>
      </div>

      {error ? <div className="inline-error">{error}</div> : null}

      <div className="workstream-stats" aria-label="Sub-agent status counts">
        <Metric label="Ready" value={String(readyCount)} />
        <Metric label="Working" value={String(workingCount)} />
        <Metric label="Paused" value={String(pausedCount)} />
      </div>

      <div className="subagent-templates" aria-label="Sub-agent templates">
        {subAgentTemplates.map((template) => (
          <button
            className="subagent-template"
            key={template.id}
            onClick={() => onDraftChange({ ...draft, ...template.draft })}
            type="button"
          >
            <strong>{template.label}</strong>
            <small>{template.summary}</small>
          </button>
        ))}
      </div>

      <form className="subagent-create" onSubmit={onCreate}>
        <strong className="form-kicker">New delegated workstream</strong>
        <input
          aria-label="Sub-agent name"
          onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
          placeholder="Sub-agent name"
          value={draft.name}
        />
        <textarea
          aria-label="Sub-agent purpose"
          onChange={(event) => onDraftChange({ ...draft, purpose: event.target.value })}
          placeholder="Mission or responsibility"
          rows={2}
          value={draft.purpose}
        />
        <div className="field-grid">
          <select
            aria-label="Sub-agent mode"
            onChange={(event) => onDraftChange({ ...draft, mode: event.target.value as SubAgentMode })}
            value={draft.mode}
          >
            <option value="hybrid">Hybrid</option>
            <option value="agents-sdk">Agents SDK</option>
            <option value="executor">Executor</option>
          </select>
          <input
            aria-label="Sub-agent brain"
            onChange={(event) => onDraftChange({ ...draft, brain: event.target.value })}
            placeholder="Brain"
            value={draft.brain}
          />
        </div>
        <input
          aria-label="Sub-agent model"
          onChange={(event) => onDraftChange({ ...draft, model: event.target.value })}
          placeholder="Model override, optional"
          value={draft.model}
        />
        <input
          aria-label="Sub-agent skills"
          onChange={(event) => onDraftChange({ ...draft, skills: event.target.value })}
          placeholder="skills, comma separated"
          value={draft.skills}
        />
        <textarea
          aria-label="Sub-agent system prompt"
          onChange={(event) => onDraftChange({ ...draft, systemPrompt: event.target.value })}
          placeholder="Optional custom system prompt"
          rows={2}
          value={draft.systemPrompt}
        />
        <button className="button button-primary button-block" disabled={loading || !draft.name.trim() || !draft.purpose.trim()} type="submit">
          {loadingAction === "create" ? "Creating" : "Create sub-agent"}
        </button>
      </form>

      <div className="subagent-roster" aria-label="Tracked sub-agents">
        {subAgents.length ? (
          subAgents.map((subAgent, index) => (
            <button
              className="subagent-row"
              data-active={String(selected?.id === subAgent.id)}
              key={subAgent.id + ":" + String(index)}
              onClick={() => onSelect(subAgent.id)}
              type="button"
            >
              <span>
                <strong>{subAgent.name}</strong>
                <small>{subAgent.mode} / {subAgent.brain}</small>
              </span>
              <span className="pill" data-state={subAgent.status}>{subAgent.status}</span>
            </button>
          ))
        ) : (
          <div className="empty-state compact">No sub-agents yet.</div>
        )}
      </div>

      {selected ? (
        <div className="subagent-detail">
          <div className="subagent-summary">
            <div className="detail-title">
              <div>
                <strong>{selected.name}</strong>
                <small>{selected.purpose}</small>
              </div>
              <span className="pill" data-state={selected.status}>{selected.status}</span>
            </div>
            <p>{selected.summary || "No summary yet."}</p>
            <div className="subagent-chip-row" aria-label="Sub-agent traits">
              <span className="pill">{selected.mode}</span>
              <span className="pill">{selected.brain}</span>
              <span className="pill">{selected.model}</span>
              {selected.skills.slice(0, 3).map((skill, index) => (
                <span className="pill" key={skill + ":" + String(index)}>{skill}</span>
              ))}
            </div>
          </div>
          <div className="subagent-metadata" aria-label="Selected sub-agent metadata">
            <Metric label="Messages" value={String(selected.messageCount ?? messages.length)} />
            <Metric label="Updated" value={formatRelativeTime(selected.updatedAt)} />
            <Metric label="Plane" value={formatSubAgentMode(selected.mode)} />
          </div>
          <div className="button-row">
            <button className="button button-compact" disabled={loading || selected.status === "paused"} onClick={() => controlSubAgent("paused")} type="button">
              {loadingAction === "pause" ? "Pausing" : "Pause"}
            </button>
            <button className="button button-compact" disabled={loading || selected.status === "ready"} onClick={() => controlSubAgent("ready")} type="button">
              {loadingAction === "resume" ? "Resuming" : "Resume"}
            </button>
            <button className="button button-compact" disabled={loading} onClick={onRefreshSummary} type="button">
              {loadingAction === "summarize" ? "Summarizing" : "Summarize"}
            </button>
            <button
              className="button button-compact"
              disabled={loading || selected.status === "paused" || selected.status === "archived"}
              onClick={onExplore}
              type="button"
            >
              {loadingAction === "explore" ? "Exploring" : "Explore"}
            </button>
            <button className="button button-compact" disabled={!connected || mainBusy} onClick={briefSubAgentInMainChat} type="button">
              Brief chat
            </button>
            <button className="button button-compact button-danger" disabled={loading || selected.status === "archived"} onClick={() => controlSubAgent("archived")} type="button">
              {loadingAction === "archive" ? "Archiving" : "Archive"}
            </button>
          </div>
          <div className="subagent-messages" aria-live="polite">
            {messages.length ? (
              messages.slice(-6).map((message, index) => (
                <div className="subagent-message" data-role={message.role} key={message.id + ":" + String(index)}>
                  <small>{message.role}</small>
                  <p>{message.content}</p>
                </div>
              ))
            ) : (
              <div className="empty-state compact">Send a scoped prompt to start this sub-agent thread.</div>
            )}
          </div>
          <form className="subagent-prompt" onSubmit={onSendMessage}>
            <textarea
              aria-label="Message selected sub-agent"
              disabled={loading || selected.status === "paused" || selected.status === "archived"}
              name="subAgentPrompt"
              placeholder="Ask this sub-agent for a focused pass..."
              rows={2}
            />
            <button className="button button-primary" disabled={loading || selected.status === "paused" || selected.status === "archived"} type="submit">
              {loadingAction === "send" ? "Sending" : "Send"}
            </button>
          </form>
        </div>
      ) : null}
    </section>
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
const pendingToolContinuationStorageKey = "open-think:pending-tool-continuation:" + clientConfig.deploymentId;
const pendingToolContinuationMaxAgeMs = 5 * 60 * 1000;

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

function readPendingToolContinuationMarker(): ToolContinuationMarker | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(pendingToolContinuationStorageKey);
    if (!raw) return null;

    const marker = JSON.parse(raw) as Partial<ToolContinuationMarker>;
    if (!Number.isFinite(marker.createdAt)) return null;
    if (Date.now() - Number(marker.createdAt) > pendingToolContinuationMaxAgeMs) {
      clearPendingToolContinuationMarker();
      return null;
    }

    const toolCallId = typeof marker.toolCallId === "string" ? marker.toolCallId : undefined;
    const approvalId = typeof marker.approvalId === "string" ? marker.approvalId : undefined;
    if (!toolCallId && !approvalId) return null;

    return {
      createdAt: Number(marker.createdAt),
      toolCallId,
      approvalId
    };
  } catch {
    return null;
  }
}

function writePendingToolContinuationMarker(marker: Omit<ToolContinuationMarker, "createdAt">) {
  try {
    window.sessionStorage.setItem(
      pendingToolContinuationStorageKey,
      JSON.stringify({
        ...marker,
        createdAt: Date.now()
      })
    );
  } catch {
    // The in-memory continuation path still handles the current approval click.
  }
}

function clearPendingToolContinuationMarker() {
  try {
    window.sessionStorage.removeItem(pendingToolContinuationStorageKey);
  } catch {
    // Ignore storage failures so chat is never blocked by recovery bookkeeping.
  }
}

function pendingToolContinuationMarkerMatches(
  candidate: ToolContinuationCandidate,
  marker: ToolContinuationMarker | null
) {
  if (!marker) return false;
  if (marker.toolCallId && candidate.toolCallIds.has(marker.toolCallId)) return true;
  if (marker.approvalId && candidate.approvalIds.has(marker.approvalId)) return true;
  return false;
}

function readyStateLabel(value: number) {
  if (value === WebSocket.OPEN) return "Connected";
  if (value === WebSocket.CONNECTING) return "Connecting";
  if (value === WebSocket.CLOSING) return "Closing";
  return "Disconnected";
}

function formatSocketClose(event: CloseEvent) {
  const code = event.code ? "code " + String(event.code) : "no close code";
  const reason = event.reason ? ", " + event.reason : "";
  const cleanliness = event.wasClean ? "clean" : "unclean";
  return "Closed " + cleanliness + " (" + code + reason + ")";
}

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function searchPaletteResults(
  query: string,
  messages: UIMessage[],
  activeApprovalIds: ReadonlySet<string>,
  summary: CapabilitySummary | null,
  subAgents: SubAgent[]
): SearchResult[] {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  const baseResults: SearchResult[] = [
    {
      id: "runtime",
      kind: "Runtime",
      title: "Runtime and approvals",
      detail: "Connection, model, Code Mode, executor, sandbox, and tool approvals.",
      target: "#runtime"
    },
    {
      id: "artifact-canvas",
      kind: "Artifact",
      title: "Artifact canvas",
      detail: "Documents, code, tables, generated app previews, and library items.",
      target: "#artifact-canvas"
    }
  ];

  const messageResults = messages
    .flatMap((message, index): SearchResult[] => {
      const text = messageSearchText(message, activeApprovalIds);
      if (!text) return [];
      return [{
        id: \`message-\${message.id || index}\`,
        kind: "Thread" as const,
        title: message.role === "user" ? "User message" : "Assistant message",
        detail: truncateText(text, 120),
        target: "#chat-feed"
      }];
    });

  const artifactResults = (summary?.artifacts?.artifacts ?? []).map((artifact) => ({
    id: \`artifact-\${artifact.key}\`,
    kind: "Artifact" as const,
    title: artifact.title || artifact.key,
    detail: [artifact.type || "artifact", artifact.uploaded ? formatRelativeTime(artifact.uploaded) : ""].filter(Boolean).join(" / "),
    target: "#artifact-canvas"
  }));

  const skillResults = (summary?.skills?.skills ?? []).map((skill) => ({
    id: \`skill-\${skill.id}\`,
    kind: "Skill" as const,
    title: skill.label,
    detail: skill.enabled ? "Enabled skill" : "Available skill",
    target: "#skills"
  }));

  const memoryResults = (summary?.learning?.memories?.items ?? []).map((item, index) => ({
    id: \`memory-\${index}\`,
    kind: "Memory" as const,
    title: "Memory suggestion",
    detail: truncateText(unknownSearchText(item), 120),
    target: "#learning"
  }));

  const subAgentResults = subAgents.map((subAgent) => ({
    id: \`subagent-\${subAgent.id}\`,
    kind: "Sub-agent" as const,
    title: subAgent.name,
    detail: truncateText(\`\${subAgent.status} / \${subAgent.purpose} / \${subAgent.summary}\`, 120),
    target: "#subagents"
  }));

  const allResults = [
    ...baseResults,
    ...messageResults,
    ...artifactResults,
    ...memoryResults,
    ...skillResults,
    ...subAgentResults
  ];

  if (!normalizedQuery) return allResults.slice(0, 10);
  return allResults
    .filter((result) => \`\${result.kind} \${result.title} \${result.detail}\`.toLowerCase().includes(normalizedQuery))
    .slice(0, 14);
}

function messageSearchText(message: UIMessage, activeApprovalIds: ReadonlySet<string>) {
  return compactMessageParts(message.parts)
    .filter(({ part }) => partHasVisibleContent(part, activeApprovalIds))
    .map(({ part }) => {
      if (isTextUIPart(part)) return part.text;
      if (isToolUIPart(part)) {
        const name = toolDisplayTitle(getToolName(part), getToolInput(part));
        const state = toolStateLabel(toolPartDisplayState(part, activeApprovalIds));
        return \`\${name} \${state}\`;
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function unknownSearchText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const preferred = record.text ?? record.summary ?? record.label ?? record.title ?? record.id;
    if (typeof preferred === "string") return preferred;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

type McpServerState = {
  connectionState?: string;
  state?: string;
  tools?: unknown[];
};

type RuntimeHealth = {
  cloudAgentInstance?: {
    execution?: RuntimeExecutionState;
    codeMode?: RuntimeCodeModeState;
    workspace?: RuntimeWorkspaceState;
  };
};

type RuntimeExecutionState = {
  executor?: RuntimeExecutionPlane;
  sandbox?: RuntimeExecutionPlane;
  containers?: RuntimeExecutionPlane;
};

type RuntimeExecutionPlane = {
  enabled?: boolean;
  configured?: boolean;
  status?: string;
  default?: boolean;
};

type RuntimeCodeModeState = {
  enabled?: boolean;
  default?: boolean;
  toolShape?: string;
};

type RuntimeWorkspaceState = {
  firstClass?: boolean;
  orchestrator?: {
    enabled?: boolean;
    autoSpunUp?: boolean;
    className?: string;
  };
  contextStore?: {
    vectorizeConfigured?: boolean;
  };
};

type BrowserDiagnosticsResponse = {
  ok: boolean;
  status: string;
  mode: "read-only" | "live" | string;
  summary: string;
  stages: BrowserDiagnosticsStage[];
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
};

type BrowserDiagnosticsStage = {
  id: string;
  label: string;
  status: "complete" | "warning" | "error" | "skipped" | string;
  summary: string;
  detail?: string;
  at?: string;
};

type CapabilitySummary = {
  skills: SkillListResponse | null;
  learning: LearningResponse | null;
  artifacts: ArtifactListResponse | null;
  contributions: ContributionStatusResponse | null;
  executor: ExecutorResponse | null;
  mcp: McpServerCatalogResponse | null;
  mcpObservability: McpObservabilityResponse | null;
};

type SearchResult = {
  id: string;
  kind: "Thread" | "Artifact" | "Memory" | "Skill" | "Sub-agent" | "Runtime";
  title: string;
  detail: string;
  target: string;
};

type SkillListResponse = {
  available?: boolean;
  skills?: Array<{
    id: string;
    label: string;
    enabled: boolean;
  }>;
  note?: string;
};

type LearningResponse = {
  status?: string;
  trainMode?: {
    available?: boolean;
    teachMode?: boolean;
  };
  memories?: {
    available?: boolean;
    pending?: number;
    items?: unknown[];
  };
  skills?: {
    available?: boolean;
    pending?: number;
    suggestions?: LearningSuggestion[];
  };
  suggestions?: {
    pending?: number;
    accepted?: number;
    rejected?: number;
    items?: LearningSuggestion[];
  };
};

type LearningSuggestionStatus = "pending" | "accepted" | "rejected";

type LearningSuggestion = {
  id: string;
  kind: "memory" | "skill" | "rubric" | "workflow" | string;
  title: string;
  summary: string;
  status: LearningSuggestionStatus;
  source?: string;
  updatedAt?: string;
};

type ArtifactListItem = {
  key: string;
  title?: string;
  type?: string;
  uploaded?: string | null;
  size?: number | null;
  versions?: number;
};

type ArtifactVersion = {
  key: string;
  versionKey: string;
  label: string;
  current?: boolean;
  uploaded?: string | null;
  size?: number | null;
};

type ArtifactDetailResponse = {
  key: string;
  versionKey?: string;
  title?: string;
  type?: string;
  text?: string;
  versions?: ArtifactVersion[];
};

type ArtifactCanvasMode = "single" | "grid" | "stack";

type ArtifactListResponse = {
  available?: boolean;
  note?: string;
  artifacts?: ArtifactListItem[];
};

type ContributionStatusResponse = {
  available?: boolean;
  endpoint?: string;
  repository?: string;
  baseBranch?: string;
  tokenConfigured?: boolean;
  artifactSourceAvailable?: boolean;
  sandboxSourceAvailable?: boolean;
  mode?: string;
  note?: string;
};

type ExecutorResponse = {
  configured?: boolean;
  status?: string;
};

type McpServerCatalogResponse = {
  servers?: Array<{
    id: string;
    label: string;
    configured?: boolean;
  }>;
};

type McpObservabilityResponse = {
  available?: boolean;
  status?: string;
  note?: string;
  totals?: {
    calls?: number;
    failures?: number;
    servers?: number;
  };
  servers?: Array<{
    name: string;
    transport?: string;
    calls?: number;
    failures?: number;
    avgLatencyMs?: number;
  }>;
  recentEvents?: Array<{
    id: string;
    server: string;
    tool: string;
    transport?: string;
    status: string;
    latencyMs: number;
    summary: string;
    createdAt?: string;
  }>;
};

type SubAgentStatus = "ready" | "working" | "paused" | "archived";
type SubAgentMode = "agents-sdk" | "executor" | "hybrid";
type SubAgentAction = "create" | "pause" | "resume" | "archive" | "summarize" | "send" | "explore";

type SubAgentDraft = {
  name: string;
  purpose: string;
  mode: SubAgentMode;
  brain: string;
  model: string;
  skills: string;
  systemPrompt: string;
};

const defaultSubAgentDraft: SubAgentDraft = {
  name: "Research scout",
  purpose: "Investigate one bounded topic and report back with options, risks, and next steps.",
  mode: "hybrid",
  brain: "gbrain + gskills",
  model: "",
  skills: "research, planning, cloudflare",
  systemPrompt: ""
};

const subAgentTemplates = [
  {
    id: "research",
    label: "Research Scout",
    summary: "Read-only discovery, options, risks, next steps.",
    draft: {
      name: "Research scout",
      purpose: "Investigate one bounded topic and report back with options, risks, and next steps.",
      mode: "agents-sdk" as SubAgentMode,
      brain: "gbrain + gskills",
      model: "",
      skills: "research, planning, cloudflare",
      systemPrompt: "Stay read-only. Return concise findings, risks, open questions, and a recommended next action."
    }
  },
  {
    id: "builder",
    label: "Builder",
    summary: "Implementation workstream for scoped code or deploy tasks.",
    draft: {
      name: "Builder",
      purpose: "Implement one scoped change, report touched surfaces, and ask before risky operations.",
      mode: "hybrid" as SubAgentMode,
      brain: "gbrain + executor",
      model: "",
      skills: "coding, tests, cloudflare, executor",
      systemPrompt: "Own a narrow implementation slice. Prefer executor/sandbox for commands when available. Report files, tests, blockers, and next action."
    }
  },
  {
    id: "reviewer",
    label: "Reviewer",
    summary: "Quality gate for bugs, regressions, and missing tests.",
    draft: {
      name: "Reviewer",
      purpose: "Review a completed change for correctness, regression risk, and verification gaps.",
      mode: "agents-sdk" as SubAgentMode,
      brain: "review gbrain",
      model: "",
      skills: "review, testing, security",
      systemPrompt: "Lead with findings ordered by severity. Include exact evidence, residual risk, and recommended fixes."
    }
  },
  {
    id: "operator",
    label: "Cloud Operator",
    summary: "Cloudflare deploy, logs, bindings, and account operations.",
    draft: {
      name: "Cloud operator",
      purpose: "Plan and execute Cloudflare operations with explicit approval for risky account changes.",
      mode: "hybrid" as SubAgentMode,
      brain: "gstack operator",
      model: "",
      skills: "cloudflare, mcp, deploy, observability",
      systemPrompt: "Use Cloudflare MCP for read operations. Ask before writes, deploys, DNS, access, billing, or secret changes."
    }
  }
] as const;

const subAgentExplorePrompt =
  "Give me a current state report: what you know, what you still need, likely risks, and the next concrete action you recommend.";

const hostedFlowSteps = [
  {
    index: "01",
    title: "Design",
    detail: "Choose brain, prompts, skills, model, and approval policy."
  },
  {
    index: "02",
    title: "Deploy",
    detail: "Publish the Worker, Agents SDK runtime, assets, and bindings."
  },
  {
    index: "03",
    title: "Plug in",
    detail: "Use /health, /manifest, /goal, and /subagents from the SDK."
  },
  {
    index: "04",
    title: "Operate",
    detail: "Delegate, summarize, approve tools, and update the agent."
  }
] as const;

function hostedAgentSdkSnippet(baseUrl = "https://your-agent.workers.dev") {
  return [
    'import { createHostedCloudAgentClient } from "@open-think/core";',
    "",
    "const agent = createHostedCloudAgentClient({",
    \`  baseUrl: "\${baseUrl}"\`,
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
    "await agent.addMemory('Prefer short deploy-readiness briefs.');",
    "const artifacts = await agent.listArtifacts();",
    "const learning = await agent.learning();",
    "console.log(profile.kind, artifacts.available, learning.trainMode.available);"
  ].join("\\n");
}

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

type PendingUserMessage = {
  text: string;
  startIndex: number;
};

type PendingAssistantMessage = {
  startIndex: number;
};

type VisibleMessage = {
  key: string;
  message: UIMessage;
};

type MessagePartEntry = {
  part: UIMessage["parts"][number];
  index: number;
};

type MessageRenderBlock =
  | {
      kind: "part";
      key: string;
      part: UIMessage["parts"][number];
    }
  | {
      kind: "tool-group";
      key: string;
      parts: MessagePartEntry[];
    };

type ToolContinuationCandidate = {
  signature: string;
  toolCallIds: Set<string>;
  approvalIds: Set<string>;
};

type ToolContinuationMarker = {
  createdAt: number;
  toolCallId?: string | undefined;
  approvalId?: string | undefined;
};

function messageHasRenderableParts(message: UIMessage) {
  return message.parts.some((part) => isTextUIPart(part) || isToolUIPart(part));
}

function PendingMessage({
  role,
  text
}: {
  role: "user" | "assistant";
  text: string;
}) {
  return (
    <article className="message" data-pending="true" data-role={role}>
      <small>{role}</small>
      <div className="text-part">
        <p>{text}</p>
      </div>
    </article>
  );
}

function messagesContainUserTextAfter(messages: UIMessage[], text: string, startIndex: number) {
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "user") continue;
    if (message.parts.some((part) => isTextUIPart(part) && part.text.trim() === text)) return true;
  }
  return false;
}

function messagesContainRenderableAssistantAfter(
  messages: UIMessage[],
  startIndex: number,
  activeApprovalIds: ReadonlySet<string>
) {
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;
    if (compactMessageParts(message.parts).some(({ part }) => partHasVisibleContent(part, activeApprovalIds))) return true;
  }
  return false;
}

function latestUserTextMessageAfter(messages: UIMessage[], startIndex: number) {
  for (let messageIndex = messages.length - 1; messageIndex >= startIndex; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "user") continue;

    const text = messageTextContent(message);
    if (text) return { id: message.id, index: messageIndex, text };
  }
  return null;
}

function messageTextContent(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\\n\\n");
}

function partHasVisibleContent(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  if (isTextUIPart(part)) return part.text.trim().length > 0;
  if (isToolUIPart(part)) return shouldRenderMessagePart(part, activeApprovalIds);
  return false;
}

function messageRenderBlocks(parts: MessagePartEntry[]): MessageRenderBlock[] {
  const blocks: MessageRenderBlock[] = [];
  let toolGroup: MessagePartEntry[] = [];

  const flushToolGroup = () => {
    if (toolGroup.length === 0) return;
    const groupParts = toolGroup;
    toolGroup = [];
    blocks.push({
      kind: "tool-group",
      key: "tool-group:" + groupParts.map(({ part, index }) => partKey(part, index)).join("|"),
      parts: groupParts
    });
  };

  for (const entry of parts) {
    if (isToolUIPart(entry.part)) {
      toolGroup.push(entry);
      continue;
    }

    flushToolGroup();
    blocks.push({
      kind: "part",
      key: partKey(entry.part, entry.index),
      part: entry.part
    });
  }

  flushToolGroup();
  return blocks;
}

function summarizeToolGroup(parts: MessagePartEntry[], activeApprovalIds: ReadonlySet<string>) {
  const summaries = parts.map(({ part }) => summarizeToolPart(part, activeApprovalIds));
  const names = uniqueDisplayNames(summaries.map((summary) => summary.title));
  const states = parts.map(({ part }) => toolSummaryState(part, activeApprovalIds));
  const activeApprovalCount = parts.filter(({ part }) => toolPartHasActiveApproval(part, activeApprovalIds)).length;
  const state = toolGroupState(states, activeApprovalCount);
  const countLabel = parts.length === 1 ? "1 tool step" : parts.length + " tool steps";
  const title = parts.length === 1 ? summaries[0]?.title ?? "Tool step" : countLabel;
  const detailParts = [parts.length === 1 ? summaries[0]?.description : formatToolNameList(names), formatToolStateList(states)]
    .filter(Boolean);

  return {
    defaultOpen: activeApprovalCount > 0,
    detail: detailParts.join(" - ") || countLabel,
    state,
    title
  };
}

type ToolPresentation = {
  rawName: string;
  title: string;
  description: string | null;
  outcome: string | null;
};

function summarizeToolPart(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>): ToolPresentation {
  const toolName = isToolUIPart(part) ? getToolName(part) : "tool";
  const input = isToolUIPart(part) ? getToolInput(part) : null;
  const output = isToolUIPart(part) ? getToolOutput(part) : null;
  const displayState = isToolUIPart(part) ? toolPartDisplayState(part, activeApprovalIds) : "tool";
  const title = toolDisplayTitle(toolName, input);
  const description = toolInputSummary(toolName, input);
  const outcome = toolOutcomeSummary(displayState, output);

  return {
    rawName: toolName,
    title,
    description: description && description !== title ? description : null,
    outcome
  };
}

function uniqueDisplayNames(names: string[]) {
  return Array.from(new Set(names.filter(Boolean)));
}

function formatToolNameList(names: string[]) {
  if (names.length <= 2) return names.join(", ");
  return names.slice(0, 2).join(", ") + " +" + String(names.length - 2);
}

function formatToolStateList(states: string[]) {
  const counts = new Map<string, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  return Array.from(counts.entries())
    .map(([state, count]) => (count === 1 ? state : String(count) + " " + state))
    .join(", ");
}

function toolStateLabel(state: string) {
  switch (state) {
    case "complete":
    case "output-available":
      return "Complete";
    case "streaming":
    case "input-streaming":
    case "input-available":
      return "Running";
    case "waiting-approval":
      return "Needs approval";
    case "approved":
    case "approval-responded":
      return "Approved";
    case "expired-approval":
      return "Expired";
    case "output-error":
    case "error":
      return "Error";
    case "denied":
      return "Rejected";
    default:
      return titleCaseWords(state.replace(/-/g, " "));
  }
}

function toolDisplayTitle(toolName: string, input: unknown) {
  const normalized = normalizeToolName(toolName);
  const codeTask = codeTaskSummary(input);

  if (normalized === "search_cloudflare_documentation") return "Search Cloudflare docs";
  if (normalized === "confirmCloudflareOperation") return "Request Cloudflare approval";
  if (normalized === "setActiveGoal") return "Set active goal";
  if (normalized === "getUserTimezone") return "Read browser time context";
  if (normalized === "createSubAgent") return "Create sub-agent";
  if (normalized === "sendSubAgentMessage") return "Message sub-agent";
  if (normalized === "summarizeSubAgent") return "Summarize sub-agent";
  if (normalized === "controlSubAgent") return "Control sub-agent";
  if (normalized === "search") return codeTask ? "Inspect API shape" : "Search available tools";
  if (normalized === "execute") return codeTask ? "Run Cloudflare operation" : "Execute tool";

  return titleCaseWords(normalized.replace(/[_-]/g, " "));
}

function toolInputSummary(toolName: string, input: unknown) {
  const normalized = normalizeToolName(toolName);
  const inputRecord = asRecord(input);
  if (!inputRecord) return null;

  const query = textField(inputRecord, "query");
  if (query) return "Query: " + truncateText(query, 140);

  const operation = textField(inputRecord, "operation");
  if (operation) {
    const resources = stringArrayField(inputRecord, "resources");
    return resources.length > 0
      ? operation + ". Resources: " + resources.slice(0, 4).join(", ")
      : operation;
  }

  const goal = textField(inputRecord, "goal") ?? textField(inputRecord, "objective");
  if (goal) return "Goal: " + truncateText(goal, 140);

  const subAgentName = textField(inputRecord, "name") ?? textField(inputRecord, "subAgentId");
  const message = textField(inputRecord, "message") ?? textField(inputRecord, "prompt") ?? textField(inputRecord, "task");
  if (subAgentName && message) return subAgentName + ": " + truncateText(message, 140);
  if (message) return truncateText(message, 160);

  const codeTask = codeTaskSummary(input);
  if (codeTask) return codeTask;

  if (normalized === "getUserTimezone") return "Uses the browser timezone for date and time grounding.";
  return null;
}

function toolOutcomeSummary(state: string, output: unknown) {
  if (state === "waiting-approval") return "Waiting for your decision before continuing.";
  if (state === "expired-approval") return "Older approval. Send a fresh request to run this again.";
  if (state === "denied") return "Rejected by owner.";
  if (state === "input-streaming" || state === "input-available" || state === "streaming") return "Preparing the tool request.";
  if (state === "approved" || state === "approval-responded") return "Approval recorded. Waiting for the result.";

  const outputSummary = summarizeToolOutput(output);
  if (outputSummary) return outputSummary;
  if (state === "output-error" || state === "error") return "Tool returned an error.";
  if (state === "output-available" || state === "complete") return "Completed.";
  return null;
}

function summarizeToolOutput(output: unknown): string | null {
  if (!output) return null;

  const text = toolContentText(output);
  if (text) {
    const parsed = parseJsonText(text);
    if (parsed !== null) return summarizeParsedToolOutput(parsed);
    return truncateText(normalizeWhitespace(text), 220);
  }

  return summarizeParsedToolOutput(output);
}

function summarizeParsedToolOutput(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "No matching results.";
    const endpoints = value.map(endpointSummary).filter((item): item is string => Boolean(item));
    if (endpoints.length > 0) {
      return "Found " + pluralize(value.length, "endpoint") + ": " + formatInlineList(endpoints, 3);
    }
    return "Returned " + pluralize(value.length, "item") + ".";
  }

  const record = asRecord(value);
  if (!record) return truncateText(normalizeWhitespace(String(value)), 220);

  const error = textField(record, "error") ?? textField(record, "message");
  if (error && (record.success === false || "error" in record)) return "Error: " + truncateText(error, 180);

  const directUrl = textField(record, "url") ?? textField(record, "deployment_url") ?? textField(record, "preview_url");
  if (directUrl) return "Created or updated resource: " + directUrl;

  const endpointSummaryText = summarizeEndpointCollections(record);
  if (endpointSummaryText) return endpointSummaryText;

  const operationSummary = textField(record, "summary") ?? textField(record, "operation");
  if (operationSummary) return truncateText(operationSummary, 180);

  const result = record.result;
  const resultRecord = asRecord(result);
  if (resultRecord) {
    const url = textField(resultRecord, "url") ?? textField(resultRecord, "deployment_url");
    if (url) return "Created or updated resource: " + url;

    const name = textField(resultRecord, "name") ?? textField(resultRecord, "id");
    if (name && record.success === true) return "Cloudflare API succeeded for " + name + ".";
  }

  if (record.success === true) return "Cloudflare API request succeeded.";
  if (record.success === false) return "Cloudflare API request failed.";

  const nestedText = toolContentText(record);
  if (nestedText && nestedText !== String(value)) return truncateText(normalizeWhitespace(nestedText), 220);
  return "Returned structured data.";
}

function summarizeEndpointCollections(record: Record<string, unknown>) {
  const sections = [
    ["workerEndpoints", "Worker endpoint"],
    ["workers", "Worker endpoint"],
    ["pagesEndpoints", "Pages endpoint"],
    ["pages", "Pages endpoint"],
    ["routes", "route"]
  ] as const;

  for (const [key, label] of sections) {
    const value = record[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const endpoints = value.map(endpointSummary).filter((item): item is string => Boolean(item));
    if (endpoints.length > 0) {
      return "Found " + pluralize(value.length, label) + ": " + formatInlineList(endpoints, 3);
    }
    return "Found " + pluralize(value.length, label) + ".";
  }

  return null;
}

function endpointSummary(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const method = textField(record, "method")?.toUpperCase();
  const path = textField(record, "path");
  const summary = textField(record, "summary");
  if (!method && !path) return null;
  return [method, path, summary ? "- " + summary : null].filter(Boolean).join(" ");
}

function toolContentText(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return typeof value === "string" ? value : null;

  const content = record.content;
  if (Array.isArray(content)) {
    const textParts = content
      .map((item) => {
        const itemRecord = asRecord(item);
        return itemRecord && itemRecord.type === "text" ? textField(itemRecord, "text") : null;
      })
      .filter(Boolean);
    if (textParts.length > 0) return textParts.join("\\n\\n");
  }

  return textField(record, "text");
}

function codeTaskSummary(input: unknown) {
  const record = asRecord(input);
  const code = record ? textField(record, "code") : null;
  if (!code) return null;

  const comment = firstCodeComment(code);
  if (comment) return truncateText(comment, 180);

  const requestTarget = firstCloudflareRequestTarget(code);
  return requestTarget ? "Cloudflare API request: " + requestTarget : "Inline tool code.";
}

function firstCodeComment(code: string) {
  for (const rawLine of code.split(/\\r?\\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("//")) continue;
    const comment = line.replace(/^\\/\\/+/, "").trim();
    if (comment) return sentenceCase(comment);
  }
  return null;
}

function firstCloudflareRequestTarget(code: string) {
  const methodMatch = code.match(/method:\\s*["']([A-Z]+)["']/);
  const pathMatch = code.match(/path:\\s*\`([^\`]+)\`|path:\\s*["']([^"']+)["']/);
  const method = methodMatch?.[1];
  const path = pathMatch?.[1] ?? pathMatch?.[2];
  if (!method && !path) return null;
  return [method, path].filter(Boolean).join(" ");
}

function normalizeToolName(toolName: string) {
  return toolName
    .replace(/^functions\\./, "")
    .replace(/^tool_[A-Za-z0-9]+_/, "");
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[\\[\\]{"']/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArrayField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function formatInlineList(items: string[], limit: number) {
  const visible = items.slice(0, limit);
  const suffix = items.length > limit ? " +" + String(items.length - limit) + " more" : "";
  return visible.join("; ") + suffix;
}

function pluralize(count: number, noun: string) {
  return String(count) + " " + noun + (count === 1 ? "" : "s");
}

function sentenceCase(text: string) {
  const trimmed = normalizeWhitespace(text);
  return trimmed ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

function titleCaseWords(text: string) {
  return text
    .split(/\\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizeWhitespace(text: string) {
  return text.replace(/\\s+/g, " ").trim();
}

function truncateText(text: string, maxLength: number) {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength - 1).trimEnd() + "...";
}

function toolSummaryState(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const displayState = toolPartDisplayState(part, activeApprovalIds);
  if (displayState === "input-streaming" || displayState === "input-available") return "streaming";
  if (displayState === "output-error") return "error";
  if (displayState === "output-available" || displayState === "approval-responded" || displayState === "approved") return "complete";
  return displayState;
}

function toolGroupState(states: string[], activeApprovalCount: number) {
  if (activeApprovalCount > 0 || states.includes("waiting-approval")) return "waiting-approval";
  if (states.includes("streaming")) return "streaming";
  if (states.includes("error") || states.includes("denied")) return "error";
  if (states.includes("expired-approval")) return "expired-approval";
  if (states.length > 0 && states.every((state) => state === "complete")) return "complete";
  return states[0] ?? "tool";
}

function toolPartDisplayState(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const state = String((getToolPartState(part) ?? rawToolPartState(part)) || "tool");
  const isApprovalState = state === "waiting-approval" || state === "approved" || state === "approval-responded";
  return isApprovalState && !toolPartHasActiveApproval(part, activeApprovalIds) ? "expired-approval" : state;
}

function toolPartHasActiveApproval(part: UIMessage["parts"][number], activeApprovalIds: ReadonlySet<string>) {
  const approval = getToolApproval(part);
  return Boolean(approval?.id && activeApprovalIds.has(approval.id));
}

function compactMessageParts(parts: UIMessage["parts"]) {
  const seenToolIds = new Set<string>();
  const visibleParts: MessagePartEntry[] = [];

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part) continue;

    if (isToolUIPart(part)) {
      const toolPartId = getToolCallId(part) ?? getToolApproval(part)?.id;
      if (toolPartId) {
        if (seenToolIds.has(toolPartId)) continue;
        seenToolIds.add(toolPartId);
      }
    }

    visibleParts.push({ part, index });
  }

  return visibleParts.reverse();
}

function latestRenderableAssistantTurn(messages: UIMessage[]) {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (!message) continue;
    if (message.role === "user") return null;
    if (message.role === "assistant" && messageHasRenderableParts(message)) {
      return { message, messageIndex };
    }
  }
  return null;
}

function compactVisibleMessages(messages: UIMessage[], activeApprovalIds: ReadonlySet<string>) {
  const seenSnapshots = new Set<string>();
  const visible: VisibleMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !message.parts.some((part) => partHasVisibleContent(part, activeApprovalIds))) continue;

    const messageId = message.id || \`\${message.role}:\${index}\`;
    const snapshotKey = \`\${messageId}:\${message.role}:\${messageVisibleSignature(message, activeApprovalIds)}\`;
    if (seenSnapshots.has(snapshotKey)) continue;

    seenSnapshots.add(snapshotKey);
    visible.push({
      key: \`\${messageId}:\${index}\`,
      message
    });
  }

  return visible.reverse();
}

function messageVisibleSignature(message: UIMessage, activeApprovalIds: ReadonlySet<string>) {
  return compactMessageParts(message.parts)
    .filter(({ part }) => partHasVisibleContent(part, activeApprovalIds))
    .map(({ part, index }) => {
      if (isTextUIPart(part)) return \`text:\${part.text}\`;
      if (isToolUIPart(part)) {
        const id = getToolCallId(part) ?? getToolApproval(part)?.id ?? String(index);
        return \`tool:\${getToolName(part)}:\${id}:\${toolPartStateKey(part)}\`;
      }
      return String(index);
    })
    .join("|");
}

function isNearScrollBottom(element: HTMLElement) {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 140;
}

function formatChatErrorMessage(error: Error | undefined) {
  if (!error?.message) return null;
  if (error.message.startsWith("Tool result is missing for tool call")) {
    return "A previous tool call is incomplete in the saved history. It has been isolated; send the request again if needed.";
  }
  if (
    error.message.includes("not found for approval request") ||
    error.message.includes("Tool approval response references unknown approvalId")
  ) {
    return "A stale tool approval was left in saved history. It has been isolated; send a new request to run the operation again.";
  }
  if (error.message.includes("for missing text part") || error.message.includes("for missing reasoning part")) {
    return "The stream sent an out-of-order protocol chunk. Dismiss this notice and send the next message when ready.";
  }
  if (error.message.includes("Maximum update depth exceeded")) {
    return "The stream hit a React rendering guard. Stop the current run or send the request again when the stream is idle.";
  }
  return error.message;
}

function isProtocolRecoveryError(error: Error | undefined) {
  const message = error?.message ?? "";
  return (
    message.startsWith("Tool result is missing for tool call") ||
    message.includes("not found for approval request") ||
    message.includes("Tool approval response references unknown approvalId") ||
    message.includes("for missing text part") ||
    message.includes("for missing reasoning part") ||
    message.includes("Maximum update depth exceeded") ||
    message.includes("Cannot read properties of undefined (reading 'state')")
  );
}

function hasUnsettledToolInput(messages: UIMessage[]) {
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return false;
  return turn.message.parts.some((part) => {
    if (!isToolUIPart(part)) return false;
    const state = toolPartStateKey(part);
    return state === "input-streaming" || state === "input-available";
  });
}

function toolContinuationCandidate(messages: UIMessage[]): ToolContinuationCandidate | null {
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return null;

  const settledToolKeys: string[] = [];
  const toolCallIds = new Set<string>();
  const approvalIds = new Set<string>();
  let lastToolPartIndex = -1;

  for (let partIndex = 0; partIndex < turn.message.parts.length; partIndex += 1) {
    const part = turn.message.parts[partIndex];
    if (!part || !isToolUIPart(part)) continue;

    const state = toolPartStateKey(part);
    if (state === "input-streaming" || state === "input-available" || state === "waiting-approval") return null;
    if (!isSettledToolState(state)) continue;

    lastToolPartIndex = partIndex;
    const toolName = getToolName(part);
    const toolCallId = getToolCallId(part);
    const approval = getToolApproval(part);
    const partId = toolCallId ?? approval?.id ?? String(partIndex);
    if (toolCallId) toolCallIds.add(toolCallId);
    if (approval?.id) approvalIds.add(approval.id);
    settledToolKeys.push(toolName + ":" + partId + ":" + state);
  }

  if (settledToolKeys.length === 0 || lastToolPartIndex < 0) return null;

  const hasAssistantTextAfterLastTool = turn.message.parts.slice(lastToolPartIndex + 1).some((part) => {
    return isTextUIPart(part) && part.text.trim().length > 0;
  });
  if (hasAssistantTextAfterLastTool) return null;

  const messageId = turn.message.id || "assistant:" + turn.messageIndex;
  return {
    signature: messageId + ":" + settledToolKeys.join("|"),
    toolCallIds,
    approvalIds
  };
}

function isSettledToolState(state: string) {
  return state === "approval-responded" || state === "approved" || state === "output-available" || state === "output-error";
}

function toolPartStateKey(part: UIMessage["parts"][number]) {
  return rawToolPartState(part) || String(getToolPartState(part) ?? "");
}

function rawToolPartState(part: UIMessage["parts"][number]) {
  return typeof (part as { state?: unknown }).state === "string"
    ? String((part as { state: string }).state)
    : "";
}

function indexActivePendingApprovals(messages: UIMessage[], activeApprovalIds: ReadonlySet<string>) {
  const index = new Map<string, string>();
  const turn = latestRenderableAssistantTurn(messages);
  if (!turn) return index;

  for (const part of turn.message.parts) {
    if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

    const approval = getToolApproval(part);
    const toolCallId = getToolCallId(part);
    if (!approval?.id || !activeApprovalIds.has(approval.id)) continue;
    if (approval?.id && toolCallId) index.set(approval.id, toolCallId);
  }

  return index;
}

function indexPendingApprovalIdsAfter(messages: UIMessage[], startIndex: number) {
  const index = new Set<string>();
  for (let messageIndex = startIndex; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex];
    if (!message || message.role !== "assistant") continue;

    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolPartState(part) !== "waiting-approval") continue;

      const approval = getToolApproval(part);
      if (approval?.id) index.add(approval.id);
    }
  }

  return index;
}

function stringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function isMcpReady(server: McpServerState) {
  const state = String(server.connectionState ?? server.state ?? "").toLowerCase();
  return state === "ready" || state === "connected";
}

function formatMcpStatus(readyCount: number, totalCount: number) {
  if (totalCount === 0) return "Starting";
  return \`\${readyCount}/\${totalCount} ready\`;
}

function formatToolApprovalPolicy(policy: string) {
  if (policy === "ask-every-time") return "Ask every time";
  if (policy === "allow-all") return "Allow all";
  if (policy === "full-auto") return "Full auto";
  return "Auto";
}

function formatCodeMode(state: RuntimeCodeModeState | undefined) {
  if (!state) return "Default on";
  if (state.enabled === false) return "Off";
  return state.toolShape ? \`On (\${state.toolShape})\` : "On";
}

function formatWorkspaceState(state: RuntimeWorkspaceState | undefined) {
  if (!state?.orchestrator?.enabled) return "Default pending";
  return state.orchestrator.autoSpunUp ? "Orchestrator ready" : "Manual";
}

function formatToolAllowlist(count: number) {
  if (count === 0) return "None";
  return \`\${count} local \${count === 1 ? "rule" : "rules"}\`;
}

function formatSubAgentMode(mode: SubAgentMode) {
  if (mode === "agents-sdk") return "Chat/state";
  if (mode === "executor") return "Executor";
  return "Hybrid";
}

let trainStepIdSequence = 0;

function defaultTrainPlanState(): TrainPlanState {
  return {
    objective: "",
    steps: [],
    draftVisible: false,
    granular: false
  };
}

function createTrainStep(text: string, approved = false): TrainStep {
  trainStepIdSequence += 1;
  return {
    id: "train-step-" + Date.now().toString(36) + "-" + String(trainStepIdSequence),
    text,
    approved
  };
}

function draftTrainPlan(objectiveText: string, previous?: TrainPlanState): TrainPlanState {
  const objective = normalizeTrainObjective(objectiveText);
  const steps = [
    "Confirm the objective, assumptions, constraints, and success criteria.",
    "Inspect the current runtime, tools, data, and affected product surfaces.",
    "Propose the smallest useful implementation path, including risks and expected artifacts.",
    "Execute only the approved plan, stopping if a material risk or missing permission appears.",
    "Verify the result, summarize what changed, and suggest whether this should become a reusable skill."
  ];

  return {
    objective,
    steps: steps.map((step) => createTrainStep(step)),
    draftVisible: true,
    granular: previous?.granular ?? false
  };
}

function normalizeTrainObjective(text: string) {
  return text.replace(/^\\/train\\b/i, "").trim();
}

function addTrainStep(plan: TrainPlanState): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: [
      ...plan.steps,
      createTrainStep("Add the next approved step here.")
    ]
  };
}

function updateTrainStep(
  plan: TrainPlanState,
  id: string,
  updates: Partial<Pick<TrainStep, "approved" | "text">>
): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.map((step) => (step.id === id ? { ...step, ...updates } : step))
  };
}

function removeTrainStep(plan: TrainPlanState, id: string): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.filter((step) => step.id !== id)
  };
}

function moveTrainStep(plan: TrainPlanState, id: string, direction: -1 | 1): TrainPlanState {
  const index = plan.steps.findIndex((step) => step.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= plan.steps.length) return plan;
  const steps = [...plan.steps];
  const [step] = steps.splice(index, 1);
  if (!step) return plan;
  steps.splice(nextIndex, 0, step);
  return {
    ...plan,
    draftVisible: true,
    steps
  };
}

function approveAllTrainSteps(plan: TrainPlanState): TrainPlanState {
  return {
    ...plan,
    draftVisible: true,
    steps: plan.steps.map((step) => ({ ...step, approved: Boolean(step.text.trim()) }))
  };
}

function trainPlanReadyToRun(plan: TrainPlanState) {
  const usableSteps = cleanTrainSteps(plan.steps);
  if (!plan.draftVisible || !plan.objective.trim() || usableSteps.length === 0) return false;
  if (plan.granular) return usableSteps.some((step) => step.approved);
  return usableSteps.every((step) => step.approved);
}

function trainPlanReadinessCopy(plan: TrainPlanState) {
  if (!plan.objective.trim()) return "Add an objective before running.";
  if (cleanTrainSteps(plan.steps).length === 0) return "Add at least one step before running.";
  if (plan.granular) return "Approve at least one step, then Send will execute only the approved steps.";
  return "Approve every step or switch to step-by-step approval before running.";
}

function buildTrainModeSubmission(
  composerText: string,
  plan: TrainPlanState
): { ready: false; objective: string } | { ready: true; text: string } {
  const objective = normalizeTrainObjective(plan.draftVisible ? plan.objective : composerText);
  if (!trainPlanReadyToRun({ ...plan, objective })) {
    return { ready: false, objective };
  }
  const usableSteps = cleanTrainSteps(plan.steps);
  const selectedSteps = plan.granular ? usableSteps.filter((step) => step.approved) : usableSteps;
  return {
    ready: true,
    text: formatTrainPlanMessage(objective, plan, selectedSteps)
  };
}

function cleanTrainSteps(steps: TrainStep[]) {
  return steps.filter((step) => step.text.trim().length > 0);
}

function formatTrainPlanMessage(objective: string, plan: TrainPlanState, selectedSteps: TrainStep[]) {
  const stepsText = selectedSteps
    .map((step, index) => String(index + 1) + ". " + step.text.trim())
    .join("\\n");
  const executionMode = plan.granular
    ? "Step-by-step: execute only the approved steps now, report progress, and stop for the next approval."
    : "Full plan: all steps are approved; execute the full plan unless a material risk appears.";

  return [
    "/train " + objective.trim(),
    "",
    "Approved train plan:",
    stepsText,
    "",
    "Execution mode: " + executionMode,
    "After completion, offer to save the useful pattern as a reusable skill."
  ].join("\\n");
}

function applyRunModeToMessage(text: string, mode: RunMode) {
  if (mode === "plan-first") {
    return [
      "Plan first before acting. Do not run mutating tools until I approve the proposed plan.",
      "",
      text
    ].join("\\n");
  }
  if (mode === "train") {
    return text.startsWith("/train") ? text : "/train " + text;
  }
  return text;
}

function formatCapabilityCount(count: number, available: boolean | undefined) {
  if (available === false) return "Not bound";
  return count === 0 ? "None yet" : String(count);
}

function formatLearningState(learning: LearningResponse) {
  if (learning.trainMode?.available === false) return "Pending";
  const pending =
    Number(learning.memories?.pending ?? 0) +
    Number(learning.skills?.pending ?? 0);
  return pending > 0 ? String(pending) + " pending" : "Train ready";
}

function formatMcpObservabilityState(observability: McpObservabilityResponse) {
  if (observability.available === false) return "Preview";
  const calls = Number(observability.totals?.calls ?? 0);
  const failures = Number(observability.totals?.failures ?? 0);
  if (calls === 0) return "No calls yet";
  return failures > 0 ? String(calls) + " calls / " + String(failures) + " failures" : String(calls) + " calls";
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return \`\${minutes}m ago\`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return \`\${hours}h ago\`;
  return new Date(timestamp).toLocaleDateString();
}

function formatExecutionPlane(plane?: RuntimeExecutionPlane) {
  if (!plane) return "Checking";
  if (plane.enabled || plane.configured) return plane.status ? titleCase(plane.status) : "Enabled";
  if (plane.default) return "Default pending";
  return "Not configured";
}

function browserDiagnosticsPillState(diagnostics: BrowserDiagnosticsResponse | null) {
  if (!diagnostics) return undefined;
  if (diagnostics.ok) return "ready";
  if (diagnostics.status === "configured") return "ready";
  if (diagnostics.status === "missing-configuration") return "error";
  if (diagnostics.status === "api-unavailable" || diagnostics.status === "live-check-failed") return "error";
  return undefined;
}

async function getInitialAgentMessages({ url }: { url?: string | null }) {
  return getAgentMessages(url ?? undefined);
}

async function getAgentMessages(baseUrl?: string): Promise<UIMessage[]> {
  const response = await fetch(agentMessagesUrl(baseUrl), { credentials: "include" });
  if (!response.ok) return [];

  const payload = await response.json().catch(() => null);
  if (Array.isArray(payload)) return uniqueMessages(payload);
  if (payload && typeof payload === "object" && Array.isArray((payload as { messages?: unknown }).messages)) {
    return uniqueMessages((payload as { messages: UIMessage[] }).messages);
  }
  return [];
}

function agentMessagesUrl(baseUrl?: string) {
  const url = new URL(baseUrl ?? window.location.href);
  const path = url.pathname.replace(/\\/+$/, "");
  url.pathname = path.endsWith("/chat-history")
    ? path
    : path.includes("/agents/")
      ? path + "/chat-history"
      : "/agents/personal-chat-agent/default/chat-history";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function uniqueMessages(messages: UIMessage[]) {
  const seen = new Map<string, number>();
  return messages.map((message, index) => {
    const id = message.id || \`\${message.role}:\${index}\`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    return count === 0 ? { ...message, id } : { ...message, id: \`\${id}:\${count}\` };
  });
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\\b\\w/g, (character) => character.toUpperCase());
}

function partKey(part: UIMessage["parts"][number], index: number) {
  if (isToolUIPart(part)) return (getToolCallId(part) ?? getToolApproval(part)?.id ?? "tool") + ":" + index;
  return String(index);
}

function mcpServerSnapshotsEqual(
  left: Record<string, McpServerState>,
  right: Record<string, McpServerState>
) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index];
    const rightKey = rightKeys[index];
    if (!key || key !== rightKey) return false;
    const leftServer = left[key];
    const rightServer = right[key];
    if (!leftServer || !rightServer) return false;
    if (leftServer.connectionState !== rightServer.connectionState) return false;
    if (leftServer.state !== rightServer.state) return false;
    if ((leftServer.tools?.length ?? 0) !== (rightServer.tools?.length ?? 0)) return false;
  }

  return true;
}

function normalizeMcpServers(value: unknown): Record<string, McpServerState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, McpServerState>;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Request failed.");
  }
  return data as T;
}

async function fetchBrowserDiagnostics(init?: RequestInit): Promise<BrowserDiagnosticsResponse> {
  const response = await fetch("/browser/diagnostics", {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (data && typeof data === "object" && Array.isArray((data as BrowserDiagnosticsResponse).stages)) {
    return data as BrowserDiagnosticsResponse;
  }
  if (!response.ok) {
    throw new Error(typeof data.error === "string" ? data.error : "Browser Run diagnostics failed.");
  }
  return data as BrowserDiagnosticsResponse;
}

async function optionalJsonFetch<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    return await jsonFetch<T>(url, init);
  } catch {
    return null;
  }
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
  const cloudAgentInstance = buildCloudAgentInstanceProfile({
    request: input.request,
    deploymentId: input.deploymentId
  });
  const cloudAgentInstanceLiteral = JSON.stringify(cloudAgentInstance);
  const cloudAgentGoalInstructionLiteral = JSON.stringify(
    cloudAgentGoalInstruction(cloudAgentInstance)
  );

  return `import { AIChatAgent } from "@cloudflare/ai-chat";
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
  OPEN_THINK_PERSONAL_AGENT_CONFIG?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
  OPEN_THINK_LAUNCH_BRIEF?: string;
  OPEN_THINK_SOUL_PROMPT?: string;
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

const generatedAgentName = ${agentName};
const generatedDeploymentId = ${deploymentId};
const generatedDefaultModel = ${defaultModel};
const workersAiFallbackModel = "@cf/moonshotai/kimi-k2.6";
const memoryEmbeddingModel = "@cf/baai/bge-base-en-v1.5";
const memoryEmbeddingDimensions = 768;
const generatedCloudflareAccountId = ${cloudflareAccountId};
const generatedPersonalAgentConfig = ${personalAgentLiteral};
const generatedPublicPersonalAgentConfig = ${publicPersonalAgentLiteral};
const generatedToolApprovalPolicy = ${toolApprovalPolicy};
const generatedCloudAgentInstance = ${cloudAgentInstanceLiteral};
const generatedCloudAgentGoalInstruction = ${cloudAgentGoalInstructionLiteral};
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
  const text = [textPartContent(left.parts), textPartContent(right.parts)].filter(Boolean).join("\\n\\n");
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
    .join("\\n\\n");
}

function safeChatHistory(messages: readonly UIMessage[]) {
  const seen = new Map<string, number>();
  return Array.from(messages)
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .map((message, index) => {
      const id = message.id || \`\${message.role}:\${index}\`;
      const count = seen.get(id) ?? 0;
      seen.set(id, count + 1);
      return {
        ...message,
        id: count === 0 ? id : \`\${id}:\${count}\`,
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
              ].join("\\n")
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
        defaultModel: this.runtimeEnv.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel,
        personalAgent: this.publicPersonalAgentConfig(),
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
    const model = workersai(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel);
    const system = [
      "You are " + (env.OPEN_THINK_AGENT_NAME ?? generatedAgentName) + ", an open-think personal agent running on Cloudflare Agents SDK.",
      this.personalAgentSystemInstruction(),
      "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
      "If several user messages are queued without an assistant answer, treat them as one latest turn and answer the newest actionable request first.",
      "Do not continue stale deployment or tool work unless the newest user message explicitly asks you to continue it.",
      cloudAgentInstanceInstruction(env),
      goalCommandInstruction(),
      trainCommandInstruction(),
      "You can create, brief, pause, resume, archive, summarize, and message Cloud Agent Instance sub-agents through built-in sub-agent tools when the owner asks for delegated work.",
      "Use connected MCP tools when they are relevant. Current MCP tool approval policy: " + this.toolApprovalPolicy() + ".",
      "Deployment id: " + (env.OPEN_THINK_DEPLOYMENT_ID ?? generatedDeploymentId),
      "Cloudflare account id: " + ((env.OPEN_THINK_CF_ACCOUNT_ID ?? generatedCloudflareAccountId) || "not configured")
    ].join("\\n");
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
            Authorization: \`Bearer \${this.runtimeEnv.OPEN_THINK_CF_API_TOKEN}\`
          }
        }
      }).catch(() => undefined);
    }

    const executorUrl = sanitizeHttpsUrl(this.runtimeEnv.OPEN_THINK_EXECUTOR_MCP_URL);
    if (executorUrl) {
      const executorHeaders = this.runtimeEnv.OPEN_THINK_EXECUTOR_AUTH_TOKEN
        ? { Authorization: \`Bearer \${this.runtimeEnv.OPEN_THINK_EXECUTOR_AUTH_TOKEN}\` }
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
        description: "Request owner approval before a destructive, expensive, or security-sensitive Cloudflare operation. This checkpoint does not execute the operation by itself.",
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
    defaultModel: env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel,
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

    return Response.json({ ok: true, repository, baseBranch, branchName, pullRequest }, { status: 201 });
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
  const match = pathname.match(/^\\/learning\\/([^/]+)$/);
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
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "subagents" || !parts[1] || parts.length > 3) return null;
  return {
    id: decodeURIComponent(parts[1]),
    action: parts[2] ?? "detail"
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
  const parsedSkills = parseJsonArray(row.skills_json);
  return {
    id: String(row.id ?? defaultWorkspaceId),
    name: String(row.name ?? "Default workspace"),
    purpose: String(row.purpose ?? "Coordinate personal-agent workstreams."),
    approvalPolicy: normalizeToolApprovalPolicy(row.approval_policy ?? env?.OPEN_THINK_TOOL_APPROVAL_POLICY),
    orchestratorStatus: normalizeOrchestratorStatus(row.orchestrator_status),
    contextSummary: String(row.context_summary ?? ""),
    skills: parsedSkills.length ? parsedSkills : workspaceDefaultSkills,
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
  const raw = String(value ?? fallback).trim().replace(/\\0/g, "");
  const candidate = raw || fallback;
  const absolute = candidate.startsWith("/") ? candidate : sandboxWorkspaceRoot + "/" + candidate;
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
  if (normalized === sandboxWorkspaceRoot || normalized.startsWith(sandboxWorkspaceRoot + "/")) {
    return normalized;
  }
  return sandboxWorkspaceRoot + "/" + normalized.replace(/^\\/+/, "");
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
  const duration = typeof result.duration === "number" ? " in " + result.duration + "ms" : "";
  const stdout = String(result.stdout ?? "").trim();
  const stderr = String(result.stderr ?? "").trim();
  const output = stdout || stderr;
  const preview = output ? " Output: " + output.slice(0, 600) : "";
  return "Sandbox command finished with exit code " + exitCode + duration + "." + preview;
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
    return sandboxMcpError(toolName, "Unknown executor tool: " + toolName, "unknown-tool");
  }

  const sandbox = getExecutorSandbox(env, args);
  if (toolName === "sandbox_ping") {
    const ping = sandbox.ping ? await sandbox.ping() : "ok";
    return sandboxMcpResponse("sandbox_ping", "Sandbox " + normalizeSandboxId(args.sandboxId) + " is reachable.", { ping });
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
    return sandboxMcpResponse("sandbox_write_file", "Wrote " + content.length + " characters to " + path + ".", {
      ...result,
      path,
      characters: content.length
    });
  }

  if (toolName === "sandbox_read_file") {
    const path = normalizeSandboxPath(args.path);
    const result = await sandbox.readFile(path, { encoding: "utf-8" });
    const content = boundedText(result.content, 100000);
    return sandboxMcpResponse("sandbox_read_file", "Read " + content.length + " characters from " + path + ".", {
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
    return sandboxMcpResponse("sandbox_list_files", "Listed files under " + path + ".", {
      ...result,
      path
    });
  }

  return sandboxMcpError(toolName, "Unhandled executor tool: " + toolName, "unknown-tool");
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
      .replace(/\\0/g, "")
      .replace(/^\\/+/, "")
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
  return "'" + value.replace(/'/g, "'\\\\''") + "'";
}

function summarizePatchText(patch: string): { files: number; additions: number; deletions: number; paths: string[] } {
  const paths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\\r?\\n/)) {
    const fileMatch = /^diff --git a\\/(.+) b\\/(.+)$/.exec(line);
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
    .replace(/^\\/workspace\\/?/, "")
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
      error: "Direct calls for MCP server '" + server + "' are managed by the Agents SDK chat runtime. Use /mcp/call with server='executor' for first-party Sandbox tools."
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
  for (const line of patch.split(/\\r?\\n/)) {
    if (line.startsWith("GIT binary patch") || line.startsWith("Binary files ")) {
      throw new Error("Binary patches are not supported by the GitHub contribution lane yet.");
    }
    const diffMatch = /^diff --git a\\/(.+) b\\/(.+)$/.exec(line);
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
    const hunkMatch = /^@@ -(\\d+)(?:,(\\d+))? \\+(\\d+)(?:,(\\d+))? @@/.exec(line);
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
    if (currentHunk && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-") || line.startsWith("\\\\"))) {
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
  return encoded ? base64DecodeUtf8(encoded.replace(/\\s+/g, "")) : "";
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
      if (line.startsWith("\\\\")) continue;
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
  const text = output.join("\\n");
  return baseContent.endsWith("\\n") || patchFile.isNew ? text + "\\n" : text;
}

function splitPatchTextLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n").split("\\n");
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
    const encodedPath = change.path.split("/").map(encodeURIComponent).join("/");
    const currentFile = await githubRequest(
      env,
      input.repository,
      "/contents/" + encodedPath + "?ref=" + encodeURIComponent(input.baseBranch),
      { allowNotFound: true }
    );
    const currentSha = currentFile && typeof currentFile === "object"
      ? String((currentFile as { sha?: unknown }).sha ?? "")
      : "";
    if (change.delete) {
      if (!currentSha) continue;
      await githubRequest(env, input.repository, "/contents/" + encodedPath, {
        method: "DELETE",
        body: JSON.stringify({
          message: "OpenThink agent contribution: " + input.title,
          sha: currentSha,
          branch: input.branchName
        })
      });
      continue;
    }
    const body: Record<string, unknown> = {
      message: "OpenThink agent contribution: " + input.title,
      content: base64EncodeUtf8(change.content),
      branch: input.branchName
    };
    if (currentSha) body.sha = currentSha;
    await githubRequest(env, input.repository, "/contents/" + encodedPath, {
      method: "PUT",
      body: JSON.stringify(body)
    });
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
  return /^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(value) ? value : defaultUpdateRepository;
}

function githubBranch(env: RuntimeEnv): string {
  return normalizeGithubBranch(env.OPEN_THINK_UPDATE_BRANCH, "main");
}

function normalizeGithubBranch(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  const branch = raw.startsWith("refs/heads/") ? raw.slice("refs/heads/".length) : raw;
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
  const normalized = value.replace(/\\s/g, "");
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
        controller.enqueue(encoder.encode("event: " + event + "\\ndata: " + JSON.stringify(data) + "\\n\\n"));
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
  const model = normalizeShortText(input.model, String(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel));
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
    .join("\\n\\n");
  const result = await generateText({
    model: workersai(resolveSubAgentWorkersAiModel(env, subAgent.model)),
    system: subAgentSystemInstruction(subAgent, env),
    prompt: [
      "Conversation so far:",
      transcript || "No prior messages.",
      "",
      "Respond as the sub-agent. Be concise, concrete, and include next action if useful."
    ].join("\\n")
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
    .join("\\n\\n");
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

  const configured = String(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel).trim();
  if (configured.startsWith("@cf/")) return configured;

  return generatedDefaultModel.startsWith("@cf/") ? generatedDefaultModel : workersAiFallbackModel;
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
  ].join("\\n");
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
  ].join("\\n");
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
    model: String(row.model ?? generatedDefaultModel),
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
    cloudAgentInstance: env ? cloudAgentInstanceState(env) : generatedCloudAgentInstance,
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
    ].join("\\n");
  }

  return [
    "Goal command received.",
    "",
    "Active goal: " + goal,
    "",
    "Create a concise goal brief with objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal. If those tools are unavailable, keep the goal in conversation state and say what would be persisted when available."
  ].join("\\n");
}

function trainCommandPrompt(task: string): string {
  return [
    "Train mode is active.",
    task ? "Task: " + task : "No task text was provided.",
    "Draft a numbered plan with objective, assumptions, steps, risk level, required tools, and expected artifacts.",
    "Do not execute mutating tools until the owner approves the plan or a specific step.",
    "After a successful run, suggest one concise reusable skill name and the trigger conditions for saving it."
  ].join("\\n");
}

function goalCommandInstruction(): string {
  return [
    "Slash command /goal is enabled.",
    "When the owner's message begins with /goal, treat the remaining text as an active goal setup or update.",
    "If the command includes a goal, respond with a compact goal brief: objective, success criteria, constraints, milestones, next actions, risks, and a resume prompt.",
    "If the command has no goal text, review active goals from conversation and memory when available, then ask for the missing objective only if needed.",
    "Call setActiveGoal after drafting or updating a goal so the brief is persisted when D1 is bound.",
    "Use available memory, task, file, or MCP tools when helpful to persist or advance the goal; otherwise keep the goal anchored in the chat state."
  ].join("\\n");
}

function trainCommandInstruction(): string {
  return [
    "Slash command /train is enabled.",
    "When the owner's message begins with /train, treat the remaining text as a train-mode request.",
    "In train mode, first draft an editable numbered plan with objective, assumptions, steps, tool needs, risks, and expected artifacts.",
    "Wait for explicit approval before using mutating tools. Read-only inspection is allowed when it is needed to make the plan accurate.",
    "After a successful trained run, offer to save the repeatable pattern as a skill with a short name and trigger conditions."
  ].join("\\n");
}

function cloudAgentInstanceState(env: RuntimeEnv): Record<string, unknown> {
  const executorUrl = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  const executorReady = executorConfigured(env);
  const sandboxConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_SANDBOX_STATUS);
  const containersConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_CONTAINER_STATUS);
  const base = generatedCloudAgentInstance as Record<string, unknown>;
  const skills = Array.isArray(base.skills) ? (base.skills as Array<Record<string, unknown>>) : [];
  const execution = base.execution as Record<string, Record<string, unknown>>;
  return {
    ...base,
    codeMode: {
      ...(base.codeMode as Record<string, unknown> | undefined),
      enabled: codeModeEnabled(env),
      cloudflareApiMcpUrl: cloudflareApiMcpUrl(env)
    },
    skills: skills.map((skill) =>
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
      ...execution,
      executor: {
        ...execution.executor,
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
        ...execution.sandbox,
        enabled: true,
        configured: sandboxConfigured,
        status: sandboxConfigured ? "configured" : "default-pending"
      },
      containers: {
        ...execution.containers,
        enabled: true,
        configured: containersConfigured,
        status: containersConfigured ? "configured" : "default-pending"
      }
    },
    workspace: {
      ...(base.workspace as Record<string, unknown> | undefined),
      contextStore: {
        ...((base.workspace as { contextStore?: Record<string, unknown> } | undefined)?.contextStore ?? {}),
        vectorizeConfigured: Boolean(env.VECTORIZE)
      }
    }
  };
}

function cloudAgentInstanceInstruction(env: RuntimeEnv): string {
  return [
    generatedCloudAgentGoalInstruction,
    "Runtime cloud agent instance state:",
    JSON.stringify(cloudAgentInstanceState(env), null, 2)
  ].join("\\n\\n");
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
  return lines.join("\\n");
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
  const text = value.replace(/\\s+/g, " ").trim();
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
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\\s]+/g, "-");
  if (normalized === "ask-every-time" || normalized === "ask-everytime") return "ask-every-time";
  if (normalized === "allow-all" || normalized === "allowall") return "allow-all";
  if (normalized === "full-auto" || normalized === "fullauto" || normalized === "always-approve" || normalized === "alwaysapprove") return "full-auto";
  return "auto";
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
    /\\b(get|list|read|search|find|lookup|describe|inspect|query|fetch|check|status|audit|analyze|summarize)\\b/;
  const riskyActionPattern =
    /\\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy)\\b/;
  const riskyPattern =
    /\\b(create|update|delete|remove|purge|deploy|upload|write|apply|patch|edit|set|enable|disable|restart|rotate|revoke|invalidate|execute|run|mutate|provision|install|uninstall|bind|unbind|billing|payment|secret|token|permission|policy|access|dns|route|worker|r2|d1|queue|vectorize)\\b/;
  const alwaysApprovalPattern =
    /\\b(delete|remove|purge|billing|payment|invoice|secret|token|key|credential|permission|policy|access|dns|route|custom hostname|firewall|waf|zero trust|domain|user|member|account)\\b/;
  const goalScopedCodeModePattern =
    /\\b(execute|run|apply|create|update|deploy|upload|write|provision|enable|bind)\\b/;

  if (safeReadPattern.test(normalizedName) && !riskyActionPattern.test(normalizedName)) return false;
  if (alwaysApprovalPattern.test(normalizedName + " " + descriptionText)) return true;
  if (goalScopedCodeModePattern.test(normalizedName) && normalizedName.includes("execute")) return false;
  if (riskyPattern.test(normalizedName + " " + descriptionText)) return true;
  return !safeReadPattern.test(descriptionText);
}
`;
}
