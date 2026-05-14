import { describe, expect, it } from "vitest";
import ts from "typescript";
import { renderAgentWorkerModule } from "../agent-worker-template";
import { buildDeploymentRequest } from "../deployment-engine";

describe("renderAgentWorkerModule", () => {
  it("renders streamed chat support for the raw deployed worker app", () => {
    const source = renderAgentWorkerModule({
      deploymentId: "agent-test123",
      scriptName: "open-think-ada",
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        agentName: "Ada",
        cloudflareAccountId: "acct",
        cfApiToken: "token",
        acceptedTerms: true
      })
    });

    expect(source).toContain('"/chat?stream=1"');
    expect(source).toContain("text/event-stream");
    expect(source).toContain("streamChatResponse");
    expect(source).toContain("readEventStream");
    expect(source).toContain("chatAbortController");
    expect(source).toContain("server-sent-events");
    expect(source).toContain("Agents SDK package deployments use AIChatAgent WebSocket streaming");
    expect(source).toContain('"/goal"');
    expect(source).toContain("handleGoalRequest");
    expect(source).toContain("goalCommandInstruction");
    expect(source).toContain("Slash command /goal is enabled.");
    expect(source).toContain("trainCommandInstruction");
    expect(source).toContain("Slash command /train is enabled.");
    expect(source).toContain("Use /goal to set an active objective");
    expect(source).toContain("generatedCloudAgentInstance");
    expect(source).toContain("cloudAgentInstanceState");
    expect(source).toContain('"/workspace"');
    expect(source).toContain("handleWorkspaceRequest");
    expect(source).toContain("workspaceRuntimeState");
    expect(source).toContain("workspace_context");
    expect(source).toContain("cloudflareCodeModeMcpServerUrl");
    expect(source).toContain("cloudflareApiMcpServerUrl");
    expect(source).toContain('"/mcp/state"');
    expect(source).toContain('"/mcp/add"');
    expect(source).toContain('"/mcp/observability"');
    expect(source).toContain("mcp_observability");
    expect(source).toContain("handleMcpObservability");
    expect(source).toContain("mcpObservabilitySeries");
    expect(source).toContain("OPEN_THINK_CLOUDFLARE_MCP_CODE_MODE");
    expect(source).toContain("OPEN_THINK_EXECUTOR_MCP_URL");
    expect(source).toContain("callExecutorMcpTool");
    expect(source).toContain("set_active_goal");
    expect(source).toContain("formatActiveGoalMemory");
    expect(source).toContain('"/subagents"');
    expect(source).toContain("create_sub_agent");
    expect(source).toContain("handleSubAgentRoute");
    expect(source).toContain("subAgentCapabilityState");
    expect(source).toContain("Create sub-agent");
    expect(source).toContain('"/artifacts"');
    expect(source).toContain("handleArtifactsRequest");
    expect(source).toContain("browser-session");
    expect(source).toContain('"/browser/snapshot"');
    expect(source).toContain('"/browser/diagnostics"');
    expect(source).toContain('"/browser/sessions"');
    expect(source).toContain("handleBrowserSnapshotRequest");
    expect(source).toContain("handleBrowserDiagnosticsRequest");
    expect(source).toContain("/browser-rendering/snapshot");
    expect(source).toContain("handleBrowserSessionsRequest");
    expect(source).toContain("/browser-rendering/devtools/browser");
    expect(source).toContain('"/contributions"');
    expect(source).toContain("handleContributionRequest");
    expect(source).toContain("contributionCapabilityState");
    expect(source).toContain("contributionChangesFromPatch");
    expect(source).toContain("parseUnifiedPatch");
    expect(source).toContain("base64DecodeUtf8");
    expect(source).toContain('"/cloud-agent/profile"');
    expect(source).toContain("Hosted Agent SDK");
    expect(source).toContain("createHostedCloudAgentClient");

    const parsed = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
      },
      reportDiagnostics: true
    });
    expect(parsed.diagnostics ?? []).toEqual([]);
  });
});
