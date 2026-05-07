import { describe, expect, it } from "vitest";
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
    expect(client).toContain("autoContinueAfterToolResult: false");
    expect(client).toContain("resume: false");
    expect(client).toContain("sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses");
    expect(client).toContain("addToolApprovalResponse({ id: approvalId, approved })");
    expect(client).toContain("indexPendingApprovals");
    expect(client).toContain("function onRetry()");
    expect(client).toContain('if (toolCall.toolName !== "getUserTimezone") return;');
    expect(client).not.toContain("Unhandled browser tool");
    expect(client).toContain("Approve once");
    expect(client).toContain("Always allow tool");
    expect(client).toContain("readAlwaysAllowedTools");
    expect(client).toContain("Tool allowlist");
    expect(client).toContain("Clear tool allowlist");
    expect(client).toContain('clearHistory');
    expect(client).toContain('onMcpUpdate');
    expect(client).toContain('agent.reconnect()');
    expect(client).toContain('stop,');
    expect(client).toContain('toolApprovalPolicy');
    expect(client).toContain('agent: "PersonalChatAgent"');

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
    expect(source).toContain("waitForMcpConnections = { timeout: 10_000 }");
    expect(source).toContain("pruneMessages({");
    expect(source).toContain("stopWhen: stepCountIs(5)");
    expect(source).toContain("toUIMessageStreamResponse({ sendReasoning: false })");
    expect(source).toContain('transport: "websocket"');
    expect(source).toContain("Personal agent subsystem:");
    expect(source).toContain("/personal-agent/setup");
  });
});
