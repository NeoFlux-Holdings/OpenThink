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
  grid-template-columns: minmax(0, 1fr) minmax(270px, 340px);
  gap: 16px;
  min-height: 0;
  height: 100%;
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
  .topbar,
  .workspace {
    width: min(100% - 18px, 1440px);
  }

  .composer {
    grid-template-columns: 1fr;
  }

  .message {
    max-width: 100%;
  }

  .customization-grid {
    grid-template-columns: 1fr;
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
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealth | null>(null);
  const [alwaysAllowedTools, setAlwaysAllowedTools] = useState<Set<string>>(() => readAlwaysAllowedTools());
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [selectedSubAgentId, setSelectedSubAgentId] = useState("");
  const [subAgentMessages, setSubAgentMessages] = useState<SubAgentMessage[]>([]);
  const [subAgentAction, setSubAgentAction] = useState<SubAgentAction | null>(null);
  const [subAgentError, setSubAgentError] = useState<string | null>(null);
  const [subAgentDraft, setSubAgentDraft] = useState<SubAgentDraft>(defaultSubAgentDraft);
  const [sdkCopied, setSdkCopied] = useState(false);
  const [sessionApprovalIds, setSessionApprovalIds] = useState<Set<string>>(() => new Set());
  const autoApprovedApprovalIdsRef = useRef<Set<string>>(new Set());
  const pendingManualContinuationRef = useRef(false);
  const toolContinuationAttemptSignaturesRef = useRef<Set<string>>(new Set());
  const sessionTurnStartIndexRef = useRef<number | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const handleMcpUpdate = useCallback((servers: unknown) => {
    setMcpServers((previous) => {
      const next = normalizeMcpServers(servers);
      return mcpServerSnapshotsEqual(previous, next) ? previous : next;
    });
  }, []);

  const agent = useAgent({
    agent: "PersonalChatAgent",
    name: "default",
    onMcpUpdate: handleMcpUpdate
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
    onToolCall: async ({ toolCall, addToolOutput }) => {
      if (toolCall.toolName !== "getUserTimezone") return;

      addToolOutput({
        toolCallId: toolCall.toolCallId,
        output: browserTimeContext()
      });
      writePendingToolContinuationMarker({ toolCallId: toolCall.toolCallId });
      pendingManualContinuationRef.current = true;
    }
  });

  const connectionState = readyStateLabel(agent.readyState);
  const connected = agent.readyState === WebSocket.OPEN;
  const busy = status === "submitted" || status === "streaming" || isStreaming || isServerStreaming;
  const mcpServerValues = Object.values(mcpServers);
  const mcpReadyCount = mcpServerValues.filter((server) => isMcpReady(server)).length;
  const alwaysAllowedToolCount = alwaysAllowedTools.size;
  const activityLabel = busy ? (isToolContinuation ? "Continuing tool" : "Streaming") : "Idle";
  const approvalToolCallIds = useMemo(
    () => indexActivePendingApprovals(messages, sessionApprovalIds),
    [messages, sessionApprovalIds]
  );
  const activeApprovalIds = sessionApprovalIds;
  const visibleMessages = useMemo(() => compactVisibleMessages(messages), [messages]);
  const pendingApprovalCount = approvalToolCallIds.size;
  const approvalErrorMessage = formatChatErrorMessage(error);
  const retryIsSafe = !isProtocolRecoveryError(error);
  const canRetry =
    connected &&
    !busy &&
    retryIsSafe &&
    pendingApprovalCount === 0 &&
    messages.some((message) => message.role === "user");
  const selectedSubAgent = subAgents.find((subAgent) => subAgent.id === selectedSubAgentId) ?? subAgents[0] ?? null;
  const activeSubAgentCount = subAgents.filter((subAgent) => subAgent.status !== "archived").length;
  const subAgentBusy = subAgentAction !== null;
  const executionState = runtimeHealth?.cloudAgentInstance?.execution;

  useEffect(() => {
    const messageList = messageListRef.current;
    if (!messageList || !stickToBottomRef.current) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [messages, status, isStreaming, isServerStreaming]);

  useEffect(() => {
    void loadSubAgents();
    void loadRuntimeHealth();
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
    if (!connected || pendingApprovalCount > 0 || hasUnsettledToolInput(messages)) return;

    const recoveredContinuation = pendingManualContinuationRef.current
      ? null
      : toolContinuationCandidate(messages);
    if (!pendingManualContinuationRef.current && !recoveredContinuation) return;
    if (
      recoveredContinuation &&
      (!pendingToolContinuationMarkerMatches(recoveredContinuation, readPendingToolContinuationMarker()) ||
        toolContinuationAttemptSignaturesRef.current.has(recoveredContinuation.signature))
    ) {
      return;
    }

    pendingManualContinuationRef.current = false;
    if (recoveredContinuation) {
      toolContinuationAttemptSignaturesRef.current.add(recoveredContinuation.signature);
      clearPendingToolContinuationMarker();
    }
    stickToBottomRef.current = true;
    void Promise.resolve(sendMessage()).catch((continuationError: unknown) => {
      console.error("[useAgentChat] Manual tool continuation failed", continuationError);
    });
  }, [connected, messages, pendingApprovalCount, sendMessage]);

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
        writePendingToolContinuationMarker({ approvalId, toolCallId });
        pendingManualContinuationRef.current = true;
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
    clearError();
    clearPendingToolContinuationMarker();
    sessionTurnStartIndexRef.current = messages.length;
    setSessionApprovalIds(new Set());
    stickToBottomRef.current = true;
    sendMessage({ text });
    if (input) input.value = "";
  }

  function onClearHistory() {
    if (messages.length === 0) return;
    if (window.confirm("Clear this agent's persisted conversation history?")) {
      clearPendingToolContinuationMarker();
      sessionTurnStartIndexRef.current = null;
      setSessionApprovalIds(new Set());
      clearHistory();
    }
  }

  function onRetry() {
    if (!canRetry) return;
    clearError();
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
        <section className="chat-panel" aria-busy={busy} aria-label="Chat">
          <div className="panel-header">
            <h1>Conversation</h1>
            <p>Streaming, message persistence, client tools, and approvals are handled by Cloudflare Agents SDK.</p>
          </div>

          <div className="message-list" aria-live="polite" onScroll={onMessageListScroll} ref={messageListRef} role="log">
            {visibleMessages.length === 0 ? (
              <div className="empty-state">
                Use /goal to set an active objective, or ask for a plan, a Cloudflare operation, a memory lookup, or your browser timezone.
              </div>
            ) : (
              visibleMessages.map((message) => (
                <Message
                  activeApprovalIds={activeApprovalIds}
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
          </div>

          <form className="composer" onSubmit={onSubmit}>
            <textarea
              aria-label="Message"
              autoComplete="off"
              disabled={!connected}
              name="message"
              onKeyDown={onComposerKeyDown}
              placeholder={connected ? "Ask, or start with /goal to set an active objective..." : "Reconnect to continue..."}
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
            <Metric label="Approvals" value={pendingApprovalCount ? \`\${pendingApprovalCount} pending\` : "None pending"} />
            <Metric label="Tool allowlist" value={formatToolAllowlist(alwaysAllowedToolCount)} />
            <Metric label="Executor MCP" value={formatExecutionPlane(executionState?.executor)} />
            <Metric label="Sandbox" value={formatExecutionPlane(executionState?.sandbox)} />
            <Metric label="Containers" value={formatExecutionPlane(executionState?.containers)} />
            <Metric label="Slash commands" value="/goal enabled" />
            <Metric label="Sub-agents" value={subAgents.length ? \`\${activeSubAgentCount}/\${subAgents.length} active\` : "None"} />
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
            <HostedAgentPanel copied={sdkCopied} onCopy={copySdkSnippet} />
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
    </>
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
  const parts = compactMessageParts(message.parts).filter(({ part }) => {
    return shouldRenderMessagePart(part, activeApprovalIds);
  });
  if (parts.length === 0) return null;

  return (
    <article className="message" data-role={message.role}>
      <small>{message.role}</small>
      {parts.map(({ part, index }) => (
        <MessagePart
          activeApprovalIds={activeApprovalIds}
          approveToolAlways={approveToolAlways}
          key={partKey(part, index)}
          part={part}
          respondToToolApproval={respondToToolApproval}
        />
      ))}
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
    const approvalIsActive = Boolean(approval?.id && activeApprovalIds.has(approval.id));
    const displayState = isApprovalState && !approvalIsActive ? "expired-approval" : state;
    const canRespondToApproval = Boolean(approval?.id && toolCallId && approvalIsActive);
    const showToolPayload = displayState !== "expired-approval";

    return (
      <div className="tool-part" data-state={displayState}>
        <div className="tool-heading">
          <strong>{toolName}</strong>
          <span className="pill" data-state={displayState}>{displayState}</span>
        </div>
        {input && showToolPayload ? <pre>{formatJson(input)}</pre> : null}
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
        {output && showToolPayload ? (
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
    <section className="subagent-console" aria-label="Sub-agent console">
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
          subAgents.map((subAgent) => (
            <button
              className="subagent-row"
              data-active={String(selected?.id === subAgent.id)}
              key={subAgent.id}
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
              {selected.skills.slice(0, 3).map((skill) => (
                <span className="pill" key={skill}>{skill}</span>
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
              messages.slice(-6).map((message) => (
                <div className="subagent-message" data-role={message.role} key={message.id}>
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

function formatJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

type McpServerState = {
  connectionState?: string;
  state?: string;
  tools?: unknown[];
};

type RuntimeHealth = {
  cloudAgentInstance?: {
    execution?: RuntimeExecutionState;
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
    'await agent.sendSubAgentMessage(child.subAgent.id, "Inspect the current deploy path.");'
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

function compactMessageParts(parts: UIMessage["parts"]) {
  const seenToolIds = new Set<string>();
  const visibleParts: Array<{ part: UIMessage["parts"][number]; index: number }> = [];

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

function compactVisibleMessages(messages: UIMessage[]) {
  const seenIds = new Set<string>();
  const visible: UIMessage[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || !messageHasRenderableParts(message)) continue;

    const messageId = message.id || \`\${message.role}:\${index}\`;
    if (seenIds.has(messageId)) continue;

    seenIds.add(messageId);
    visible.push(message);
  }

  return visible.reverse();
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
  return "Auto";
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
import { routeAgentRequest, type AgentContext } from "agents";
import {
  convertToModelMessages,
  generateText,
  isTextUIPart,
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
  OPEN_THINK_PERSONAL_AGENT_CONFIG?: string;
  OPEN_THINK_TOOL_APPROVAL_POLICY?: string;
  OPEN_THINK_LAUNCH_BRIEF?: string;
  OPEN_THINK_SOUL_PROMPT?: string;
  OPEN_THINK_EXECUTOR_MCP_URL?: string;
  OPEN_THINK_EXECUTOR_AUTH_TOKEN?: string;
  OPEN_THINK_EXECUTOR_MCP_AUTO?: string;
  OPEN_THINK_SANDBOX_STATUS?: string;
  OPEN_THINK_CONTAINER_STATUS?: string;
  Sandbox?: unknown;
};

type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all";
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

const generatedAgentName = ${agentName};
const generatedDeploymentId = ${deploymentId};
const generatedDefaultModel = ${defaultModel};
const workersAiFallbackModel = "@cf/moonshotai/kimi-k2.6";
const generatedCloudflareAccountId = ${cloudflareAccountId};
const generatedPersonalAgentConfig = ${personalAgentLiteral};
const generatedPublicPersonalAgentConfig = ${publicPersonalAgentLiteral};
const generatedToolApprovalPolicy = ${toolApprovalPolicy};
const generatedCloudAgentInstance = ${cloudAgentInstanceLiteral};
const generatedCloudAgentGoalInstruction = ${cloudAgentGoalInstructionLiteral};
const docsMcpServerUrl = "https://docs.mcp.cloudflare.com/mcp";
const cloudflareMcpServerUrl = "https://mcp.cloudflare.com/mcp";

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
      model: workersai(env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel),
      system: [
        "You are " + (env.OPEN_THINK_AGENT_NAME ?? generatedAgentName) + ", an open-think personal agent running on Cloudflare Agents SDK.",
        this.personalAgentSystemInstruction(),
        "Use the native AIChatAgent chat protocol for resumable WebSocket streaming and SQLite message persistence.",
        cloudAgentInstanceInstruction(env),
        goalCommandInstruction(),
        "You can create, brief, pause, resume, archive, summarize, and message Cloud Agent Instance sub-agents through built-in sub-agent tools when the owner asks for delegated work.",
        "Use connected MCP tools when they are relevant. Current MCP tool approval policy: " + this.toolApprovalPolicy() + ".",
        "Deployment id: " + (env.OPEN_THINK_DEPLOYMENT_ID ?? generatedDeploymentId),
        "Cloudflare account id: " + ((env.OPEN_THINK_CF_ACCOUNT_ID ?? generatedCloudflareAccountId) || "not configured")
      ].join("\\n"),
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
    defaultModel: env.OPEN_THINK_DEFAULT_MODEL ?? generatedDefaultModel,
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
    "Use Agents SDK semantics for chat/state. Use executor-oriented reasoning only when the main runtime exposes OPEN_THINK_EXECUTOR_MCP_URL.",
    sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL)
      ? "Executor MCP is configured for execution-heavy work."
      : "Executor MCP is not configured; plan execution but do not claim external executor access."
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

function cloudAgentInstanceState(env: RuntimeEnv): Record<string, unknown> {
  const executorUrl = sanitizeHttpsUrl(env.OPEN_THINK_EXECUTOR_MCP_URL);
  const sandboxConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_SANDBOX_STATUS);
  const containersConfigured =
    Boolean(env.Sandbox) || runtimeFlagEnabled(env.OPEN_THINK_CONTAINER_STATUS);
  const base = generatedCloudAgentInstance as Record<string, unknown>;
  const skills = Array.isArray(base.skills) ? (base.skills as Array<Record<string, unknown>>) : [];
  const execution = base.execution as Record<string, Record<string, unknown>>;
  return {
    ...base,
    skills: skills.map((skill) =>
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
      ...execution,
      executor: {
        ...execution.executor,
        enabled: true,
        configured: Boolean(executorUrl),
        status: executorUrl ? "configured" : "default-pending",
        mcpServerUrl: executorUrl ? "configured" : null,
        authTokenConfigured: Boolean(env.OPEN_THINK_EXECUTOR_AUTH_TOKEN),
        pointsTo:
          "OPEN_THINK_EXECUTOR_MCP_URL. In the OpenThink default architecture this should be a same-account Sandbox/Containers MCP bridge; it may also point to a self-hosted Executor deployment."
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
  return "auto";
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

  if (safeReadPattern.test(normalizedName) && !riskyActionPattern.test(normalizedName)) return false;
  if (riskyPattern.test(normalizedName + " " + descriptionText)) return true;
  return !safeReadPattern.test(descriptionText);
}
`;
}
