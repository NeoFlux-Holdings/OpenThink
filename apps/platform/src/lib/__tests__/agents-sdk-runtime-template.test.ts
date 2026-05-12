import { describe, expect, it } from "vitest";
import ts from "typescript";
import { renderAgentsSdkPersonalAgentRuntime } from "../agents-sdk-runtime-template";
import { buildDeploymentRequest } from "../deployment-engine";

describe("renderAgentsSdkPersonalAgentRuntime", () => {
  it("renders a package-style Cloudflare Agents SDK runtime", () => {
    const files = renderAgentsSdkPersonalAgentRuntime({
      deploymentId: "agent-test123",
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        agentName: "Ada",
        cloudflareAccountId: "acct",
        cfApiToken: "token",
        acceptedTerms: true,
        personalAgent: {
          enabled: true,
          presetId: "custom",
          toolApprovalPolicy: "ask-every-time",
          customName: "Ada Brain",
          soulPrompt: "Prefer short answers.",
          launchBrief: "Start with the inbox triage."
        }
      }),
      bindings: {
        scriptName: "open-think-ada",
        databaseName: "open-think-ada-db",
        databaseId: "d1-id",
        bucketName: "open-think-ada-artifacts",
        queueName: "open-think-ada-tasks",
        vectorizeName: "open-think-ada-memory"
      }
    });

    expect(files.map((file) => file.path)).toEqual([
      "package.json",
      "tsconfig.json",
      "wrangler.jsonc",
      "index.html",
      "src/client-env.d.ts",
      "src/client.css",
      "src/client.tsx",
      "src/server.ts"
    ]);

    const packageJson = JSON.parse(files.find((file) => file.path === "package.json")?.contents ?? "{}");
    expect(packageJson.dependencies).toMatchObject({
      "@ai-sdk/react": "^3.0.0",
      "@cloudflare/ai-chat": "^0.6.2",
      agents: "^0.12.3",
      ai: "^6.0.174",
      react: "^19.2.5",
      "react-dom": "^19.2.5",
      streamdown: "^2.5.0",
      zod: "^4.4.2",
      "workers-ai-provider": "^3.1.13"
    });

    const wrangler = JSON.parse(files.find((file) => file.path === "wrangler.jsonc")?.contents ?? "{}");
    expect(wrangler.main).toBe("src/server.ts");
    expect(wrangler.assets).toMatchObject({
      directory: "dist/client",
      binding: "ASSETS"
    });
    expect(JSON.parse(wrangler.vars.OPEN_THINK_PERSONAL_AGENT_CONFIG)).toMatchObject({
      label: "Ada Brain",
      soulPromptConfigured: true,
      launchBriefConfigured: true,
      toolApprovalPolicy: "ask-every-time"
    });
    expect(wrangler.vars.OPEN_THINK_TOOL_APPROVAL_POLICY).toBe("ask-every-time");
    expect(wrangler.vars.OPEN_THINK_PERSONAL_AGENT_CONFIG).not.toContain("Prefer short answers.");
    expect(wrangler.vars.OPEN_THINK_PERSONAL_AGENT_CONFIG).not.toContain("inbox triage");
    expect(wrangler.durable_objects.bindings).toEqual([
      { name: "PersonalChatAgent", class_name: "PersonalChatAgent" }
    ]);
    expect(wrangler.migrations[0].new_sqlite_classes).toEqual(["PersonalChatAgent"]);

    const client = files.find((file) => file.path === "src/client.tsx")?.contents ?? "";
    expect(client).toContain('import { useAgent } from "agents/react"');
    expect(client).toContain("getToolApproval");
    expect(client).toContain('await import("streamdown")');
    expect(client).toContain("<Streamdown controls={false}>");
    expect(client).toContain("<MarkdownRenderer>{part.text}</MarkdownRenderer>");
    expect(client).toContain('useAgentChat({');
    expect(client).toContain("autoContinueAfterToolResult: true");
    expect(client).toContain("resume: false");
    expect(client).not.toContain("sendAutomaticallyWhen");
    expect(client).not.toContain("approvalContinuationSignature");
    expect(client).toContain("mcpServerSnapshotsEqual");
    expect(client).toContain("addToolApprovalResponse({ id: approvalId, approved })");
    expect(client).toContain("indexActivePendingApprovals");
    expect(client).toContain("activeApprovalIds");
    expect(client).toContain("expired-approval");
    expect(client).toContain("isNearScrollBottom");
    expect(client).toContain("stickToBottomRef");
    expect(client).toContain("onScroll={onMessageListScroll}");
    expect(client).toContain("isProtocolRecoveryError");
    expect(client).toContain("indexActiveApprovalIds");
    expect(client).toContain("visibleMessages");
    expect(client).toContain("messageHasRenderableParts");
    expect(client).toContain('displayState !== "expired-approval"');
    expect(client).toContain("function onRetry()");
    expect(client).toContain('if (toolCall.toolName !== "getUserTimezone") return;');
    expect(client).not.toContain("Unhandled browser tool");
    expect(client).toContain("Approve once");
    expect(client).toContain("Always allow tool");
    expect(client).toContain("readAlwaysAllowedTools");
    expect(client).toContain("Tool allowlist");
    expect(client).toContain("Clear tool allowlist");
    expect(client).toContain("Use /goal to set an active objective");
    expect(client).toContain('Metric label="Slash commands" value="/goal enabled"');
    expect(client).toContain("SubAgentConsole");
    expect(client).toContain("Agent Workstreams");
    expect(client).toContain("subAgentTemplates");
    expect(client).toContain("Create sub-agent");
    expect(client).toContain("HostedAgentPanel");
    expect(client).toContain("Copy SDK snippet");
    expect(client).toContain("createHostedCloudAgentClient");
    expect(client).toContain('"/subagents"');
    expect(client).toContain('clearHistory');
    expect(client).toContain('onMcpUpdate');
    expect(client).toContain("Executor MCP");
    expect(client).toContain("formatExecutionPlane");
    expect(client).toContain('agent.reconnect()');
    expect(client).toContain('stop,');
    expect(client).toContain('toolApprovalPolicy');
    expect(client).toContain('agent: "PersonalChatAgent"');
    expect(
      ts.transpileModule(client, {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022
        },
        reportDiagnostics: true
      }).diagnostics ?? []
    ).toEqual([]);

    const source = files.find((file) => file.path === "src/server.ts")?.contents ?? "";
    expect(source).toContain('import { AIChatAgent } from "@cloudflare/ai-chat"');
    expect(source).toContain('from "agents"');
    expect(source).toContain('from "zod"');
    expect(source).toContain("this.addMcpServer(");
    expect(source).toContain("this.mcp.getAITools()");
    expect(source).toContain("mcpToolsWithApprovalPolicy()");
    expect(source).toContain("shouldAutoRequireToolApproval");
    expect(source).toContain("safeReadPattern.test(normalizedName)");
    expect(source).toContain('type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all"');
    expect(source).toContain("getUserTimezone: tool(");
    expect(source).toContain("confirmCloudflareOperation: tool(");
    expect(source).toContain("needsApproval: async () => true");
    expect(source).toContain("handleGoalRequest");
    expect(source).toContain('url.pathname === "/health"');
    expect(source).toContain('url.pathname === "/manifest"');
    expect(source).toContain('url.pathname === "/cloud-agent/profile"');
    expect(source).toContain("hostedAgentManifest");
    expect(source).toContain("goalCommandInstruction");
    expect(source).toContain("Slash command /goal is enabled.");
    expect(source).toContain('command: "/goal"');
    expect(source).toContain('slashCommands');
    expect(source).toContain("generatedCloudAgentInstance");
    expect(source).toContain('"profileEndpoint":"/cloud-agent/profile"');
    expect(source).toContain("cloudAgentInstanceState");
    expect(source).toContain("OPEN_THINK_EXECUTOR_MCP_URL");
    expect(source).toContain("executorUrl");
    expect(source).toContain("default-pending");
    expect(source).toContain("pointsTo");
    expect(source).toContain('"executor"');
    expect(source).toContain("setActiveGoal: tool(");
    expect(source).toContain("formatActiveGoalMemory");
    expect(source).toContain("createSubAgent: tool(");
    expect(source).toContain("sendSubAgentMessage: tool(");
    expect(source).toContain("handleSubAgentRoute");
    expect(source).toContain("subAgentCapabilityState");
    expect(source).toContain("research-scout");
    expect(source).toContain("sub_agents");
    expect(source).toContain("waitForMcpConnections = { timeout: 10_000 }");
    expect(source).toContain("prepareModelMessages(this.messages)");
    expect(source).toContain("sanitizeMessagesForModel");
    expect(source).toContain("activeApprovalContinuationIndex");
    expect(source).toContain("ignoreIncompleteToolCalls: true");
    expect(source).not.toContain("pruneMessages");
    expect(source).toContain("stopWhen: stepCountIs(5)");
    expect(source).toContain("toUIMessageStreamResponse({ sendReasoning: false })");
    expect(source).toContain('transport: "websocket"');
    expect(source).toContain("Personal agent subsystem:");
    expect(source).toContain("/personal-agent/setup");
    expect(
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022
        },
        reportDiagnostics: true
      }).diagnostics ?? []
    ).toEqual([]);
  });
});
