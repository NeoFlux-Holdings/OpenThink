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
      "Dockerfile",
      "index.html",
      "src/client-env.d.ts",
      "src/client.css",
      "src/client.tsx",
      "src/server.ts"
    ]);

    const packageJson = JSON.parse(files.find((file) => file.path === "package.json")?.contents ?? "{}");
    expect(packageJson.dependencies).toMatchObject({
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
    expect(wrangler.vars.SANDBOX_TRANSPORT).toBe("rpc");
    expect(wrangler.vars.OPEN_THINK_SANDBOX_STATUS).toBe("enabled");
    expect(wrangler.vars.OPEN_THINK_CONTAINER_STATUS).toBe("enabled");
    expect(wrangler.vars.OPEN_THINK_PERSONAL_AGENT_CONFIG).not.toContain("Prefer short answers.");
    expect(wrangler.vars.OPEN_THINK_PERSONAL_AGENT_CONFIG).not.toContain("inbox triage");
    expect(wrangler.containers).toEqual([{ class_name: "Sandbox", image: "./Dockerfile" }]);
    expect(wrangler.durable_objects.bindings).toEqual([
      { name: "PersonalChatAgent", class_name: "PersonalChatAgent" },
      { name: "WORKSPACE_MCP", class_name: "OpenThinkWorkspaceMcp" },
      { name: "Sandbox", class_name: "Sandbox" }
    ]);
    expect(wrangler.migrations[0].new_sqlite_classes).toEqual(["PersonalChatAgent"]);
    expect(wrangler.migrations[1].new_sqlite_classes).toEqual(["Sandbox"]);
    expect(wrangler.migrations[2].new_sqlite_classes).toEqual(["OpenThinkWorkspaceMcp"]);

    const dockerfile = files.find((file) => file.path === "Dockerfile")?.contents ?? "";
    expect(dockerfile).toContain("FROM docker.io/cloudflare/sandbox:0.10.1-python");
    expect(dockerfile).toContain("ripgrep");

    const client = files.find((file) => file.path === "src/client.tsx")?.contents ?? "";
    expect(client).toContain('import { useAgent } from "agents/react"');
    expect(client).toContain("getToolApproval");
    expect(client).toContain("getAgentMessages");
    expect(client).toContain('await import("streamdown")');
    expect(client).toContain("<Streamdown controls={false}>");
    expect(client).toContain("<MarkdownRenderer>{part.text}</MarkdownRenderer>");
    expect(client).toContain('useAgentChat({');
    expect(client).toContain("autoContinueAfterToolResult: true");
    expect(client).toContain("resume: true");
    expect(client).toContain("cancelOnClientAbort: false");
    expect(client).not.toContain("sendAutomaticallyWhen");
    expect(client).not.toContain("approvalContinuationSignature");
    expect(client).not.toContain("pendingManualContinuationRef");
    expect(client).toContain("toolContinuationCandidate");
    expect(client).toContain("pendingToolContinuationMarkerMatches");
    expect(client).toContain("latestRenderableAssistantTurn");
    expect(client).toContain("hasUnsettledToolInput");
    expect(client).toContain('if (!connected) return;');
    expect(client).toContain("mcpServerSnapshotsEqual");
    expect(client).toContain("addToolApprovalResponse({ id: approvalId, approved })");
    expect(client).toContain("indexActivePendingApprovals");
    expect(client).toContain("activeApprovalIds");
    expect(client).toContain("expired-approval");
    expect(client).toContain("isNearScrollBottom");
    expect(client).toContain("stickToBottomRef");
    expect(client).toContain("onScroll={onMessageListScroll}");
    expect(client).toContain("isProtocolRecoveryError");
    expect(client).toContain("sessionApprovalIds");
    expect(client).toContain("compactMessageParts");
    expect(client).toContain("ToolPartGroup");
    expect(client).toContain("messageRenderBlocks");
    expect(client).toContain("summarizeToolGroup");
    expect(client).toContain("summarizeToolPart");
    expect(client).toContain("toolDisplayTitle");
    expect(client).toContain("Search Cloudflare docs");
    expect(client).toContain("Raw details");
    expect(client).toContain('className="tool-group"');
    expect(client).toContain("open={summary.defaultOpen ? true : undefined}");
    expect(client).toContain('summary.state !== "streaming"');
    expect(client).toContain("Details are available when this tool call settles.");
    expect(client).toContain("agentMessagesUrl");
    expect(client).toContain("setMessages(refreshedMessages)");
    expect(client).toContain("latestUserTextMessageAfter");
    expect(client).toContain("No assistant output was received. Retry the last message when ready.");
    expect(client).toContain("sendMessage({ text: retryTarget.text, messageId: retryTarget.id })");
    expect(client).toContain("shouldRenderMessagePart");
    expect(client).toContain("indexPendingApprovalIdsAfter");
    expect(client).toContain("PendingMessage");
    expect(client).toContain("messagesContainUserTextAfter");
    expect(client).toContain("pendingAssistantMessage");
    expect(client).toContain("messagesContainRenderableAssistantAfter");
    expect(client).toContain("partHasVisibleContent");
    expect(client).toContain("messageVisibleSignature");
    expect(client).toContain("No assistant output was received.");
    expect(client).toContain("visibleMessages");
    expect(client).toContain("compactVisibleMessages");
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
    expect(client).toContain("PersonaSidebar");
    expect(client).toContain("ArtifactStage");
    expect(client).toContain("ArtifactInlinePreview");
    expect(client).toContain("BrowserSessionPreview");
    expect(client).toContain("BrowserRunDiagnosticsPanel");
    expect(client).toContain("fetchBrowserDiagnostics");
    expect(client).toContain("Run live check");
    expect(client).toContain("frameStreamStatusUrl");
    expect(client).toContain("hasWebSocketDebuggerUrl");
    expect(client).toContain("new EventSource(frameStreamUrl)");
    expect(client).toContain("Frames 4 fps");
    expect(client).toContain("browser-stream-status");
    expect(client).toContain("ImageArtifactPreview");
    expect(client).toContain("SlidesArtifactPreview");
    expect(client).toContain("DiffArtifactPreview");
    expect(client).toContain('await import("@pierre/diffs/react")');
    expect(client).toContain("artifact-browser-session");
    expect(client).toContain("artifact-image-preview");
    expect(client).toContain("artifact-slides-preview");
    expect(client).toContain("artifact-diff-preview");
    expect(client).toContain("browser-session-meta");
    expect(client).toContain("Live View");
    expect(client).toContain("artifact-grid-card");
    expect(client).toContain("artifact-popout");
    expect(client).toContain("artifact-table-preview");
    expect(client).toContain("new URLSearchParams({ key: featured.key, versions: \"1\" })");
    expect(client).toContain("CommandPalette");
    expect(client).toContain("searchPaletteResults");
    expect(client).toContain('event.key.toLowerCase() === "k"');
    expect(client).toContain('aria-label="Workspace navigation"');
    expect(client).toContain('aria-label="Artifact canvas"');
    expect(client).toContain('aria-label="Search workspace"');
    expect(client).toContain("Agent Workstreams");
    expect(client).toContain("subAgentTemplates");
    expect(client).toContain("Create sub-agent");
    expect(client).toContain("HostedAgentPanel");
    expect(client).toContain("CapabilityCanvas");
    expect(client).toContain("const runModes");
    expect(client).toContain("applyRunModeToMessage");
    expect(client).toContain("TrainPlanPanel");
    expect(client).toContain("formatTrainPlanMessage");
    expect(client).toContain("Approve all");
    expect(client).toContain("Step-by-step approval");
    expect(client).toContain("execute only the approved steps now");
    expect(client).toContain('"/train " + text');
    expect(client).toContain('optionalJsonFetch<ArtifactListResponse>("/artifacts")');
    expect(client).toContain('optionalJsonFetch<ContributionStatusResponse>("/contributions")');
    expect(client).toContain("Contribution lane");
    expect(client).toContain('Metric label="PR lane"');
    expect(client).toContain("Workspace Canvas");
    expect(client).toContain("Copy SDK snippet");
    expect(client).toContain("createHostedCloudAgentClient");
    expect(client).toContain('"/subagents"');
    expect(client).toContain('clearHistory');
    expect(client).toContain('onMcpUpdate');
    expect(client).toContain("Executor MCP");
    expect(client).toContain("Code Mode");
    expect(client).toContain("Workspace");
    expect(client).toContain("Learning review");
    expect(client).toContain("curateLearningSuggestion");
    expect(client).toContain('"/learning/" + encodeURIComponent(id)');
    expect(client).toContain("learningActionId");
    expect(client).toContain("MCP activity");
    expect(client).toContain("formatMcpObservabilityState");
    expect(client).toContain('optionalJsonFetch<McpObservabilityResponse>("/mcp/observability")');
    expect(client).toContain("formatExecutionPlane");
    expect(client).toContain('agent.reconnect()');
    expect(client).toContain('stop,');
    expect(client).toContain('toolApprovalPolicy');
    expect(client).toContain('agent: "PersonalChatAgent"');
    const clientDiagnostics = ts.transpileModule(client, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
      },
      reportDiagnostics: true
    }).diagnostics ?? [];
    expect(formatDiagnostics(clientDiagnostics)).toEqual([]);

    const source = files.find((file) => file.path === "src/server.ts")?.contents ?? "";
    expect(source).toContain('import { AIChatAgent } from "@cloudflare/ai-chat"');
    expect(source).toContain('import { getSandbox, proxyToSandbox, Sandbox } from "@cloudflare/sandbox"');
    expect(source).toContain('import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"');
    expect(source).toContain('import { McpAgent } from "agents/mcp"');
    expect(source).toContain("export { Sandbox }");
    expect(source).toContain('from "agents"');
    expect(source).toContain("WorkspaceOrchestrator");
    expect(source).toContain("OpenThinkSubAgent");
    expect(source).toContain("OpenThinkWorkspaceMcp");
    expect(source).toContain("workspace_status");
    expect(source).toContain("coordinate_workspace");
    expect(source).toContain('this.addMcpServer("workspace-orchestrator"');
    expect(source).toContain("getAgentByName");
    expect(source).toContain("routingRetry: { maxAttempts: 3 }");
    expect(source).toContain("recordSubAgentReport");
    expect(source).toContain("sendManagedSubAgentMessage");
    expect(source).toContain("coordinateWorkspace");
    expect(source).toContain('from "zod"');
    expect(source).toContain("this.addMcpServer(");
    expect(source).toContain("this.mcp.getAITools()");
    expect(source).toContain("mcpToolsWithApprovalPolicy()");
    expect(source).toContain("shouldAutoRequireToolApproval");
    expect(source).toContain('replace(/[_-]+/g, " ")');
    expect(source).toContain("safeReadPattern.test(normalizedName)");
    expect(source).toContain('type ToolApprovalPolicy = "auto" | "ask-every-time" | "allow-all" | "full-auto"');
    expect(source).toContain("getUserTimezone: tool(");
    expect(source).toContain("confirmCloudflareOperation: tool(");
    expect(source).toContain("sandbox_exec: tool(");
    expect(source).toContain("sandbox_diff: tool(");
    expect(source).toContain("browser_snapshot: tool(");
    expect(source).toContain("browser_session: tool(");
    expect(source).toContain("captureBrowserSnapshotArtifact");
    expect(source).toContain("/browser-rendering/snapshot");
    expect(source).toContain("/browser-rendering/devtools/browser");
    expect(source).toContain("handleBrowserDiagnosticsRequest");
    expect(source).toContain('url.pathname === "/browser/diagnostics"');
    expect(source).toContain("Browser Run live check passed");
    expect(source).toContain("browserBase64ByteLength");
    expect(source).toContain("handleBrowserSessionsRequest");
    expect(source).toContain('url.pathname.endsWith("/browser/snapshot")');
    expect(source).toContain("parseBrowserSessionRoute(url.pathname)");
    expect(source).toContain("frameStatus");
    expect(source).toContain("browserFrameStreamStatus");
    expect(source).toContain("browserFrameStream");
    expect(source).toContain("connectBrowserCdp");
    expect(source).toContain("Page.captureScreenshot");
    expect(source).toContain("sandbox_read_file: tool(");
    expect(source).toContain("sandbox_write_file: tool(");
    expect(source).toContain("captureSandboxDiffArtifact");
    expect(source).toContain("defaultSandboxDiffArtifactKey");
    expect(source).toContain("callSandboxExecutorTool");
    expect(source).toContain("same-worker-sandbox-rpc");
    expect(source).toContain("handleMcpToolsRequest");
    expect(source).toContain("handleMcpCallRequest");
    expect(source).toContain("maybeProxySandboxRequest");
    expect(source).toContain("needsApproval: async () => !isFullAutoApprovalPolicy(this.toolApprovalPolicy())");
    expect(source).toContain("handleGoalRequest");
    expect(source).toContain('url.pathname === "/health"');
    expect(source).toContain('url.pathname === "/manifest"');
    expect(source).toContain('url.pathname === "/cloud-agent/profile"');
    expect(source).toContain('url.pathname === "/skills"');
    expect(source).toContain('url.pathname === "/memory"');
    expect(source).toContain('url.pathname === "/artifacts"');
    expect(source).toContain('url.pathname === "/files"');
    expect(source).toContain('url.pathname === "/tasks"');
    expect(source).toContain("handleFilesRequest");
    expect(source).toContain("handleTasksRequest");
    expect(source).toContain("agent_tasks");
    expect(source).toContain('url.pathname.endsWith("/browser/snapshot")');
    expect(source).toContain('url.pathname === "/contributions"');
    expect(source).toContain("handleContributionRequest");
    expect(source).toContain("contributionCapabilityState");
    expect(source).toContain("contributionChangesFromPatch");
    expect(source).toContain("parseUnifiedPatch");
    expect(source).toContain("base64DecodeUtf8");
    expect(source).toContain("recordContributionPullRequest");
    expect(source).toContain("OPEN_THINK_GITHUB_TOKEN");
    expect(source).toContain("artifactVersionPrefix");
    expect(source).toContain("artifactVersions");
    expect(source).toContain("previousVersionKey");
    expect(source).toContain('url.searchParams.get("series") === "1"');
    expect(source).toContain("mcpObservabilitySeries");
    expect(source).toContain('url.pathname === "/learning"');
    expect(source).toContain("parseLearningSuggestionRoute");
    expect(source).toContain("handleLearningSuggestionRequest");
    expect(source).toContain("learning_suggestions");
    expect(source).toContain("createLearningSuggestion");
    expect(source).toContain("updateLearningSuggestion");
    expect(source).toContain('url.pathname === "/executor"');
    expect(source).toContain('url.pathname === "/mcp/servers"');
    expect(source).toContain('url.pathname === "/mcp/state"');
    expect(source).toContain('url.pathname === "/mcp/add"');
    expect(source).toContain('url.pathname === "/mcp/tools"');
    expect(source).toContain('url.pathname === "/mcp/call"');
    expect(source).toContain('url.pathname === "/mcp/observability"');
    expect(source).toContain("mcp_observability");
    expect(source).toContain("observedMcpTool");
    expect(source).toContain("mcpObservabilityState");
    expect(source).toContain("hostedAgentManifest");
    expect(source).toContain("goalCommandInstruction");
    expect(source).toContain("trainCommandInstruction");
    expect(source).toContain("Slash command /goal is enabled.");
    expect(source).toContain("Slash command /train is enabled.");
    expect(source).toContain('command: "/goal"');
    expect(source).toContain('command: "/train"');
    expect(source).toContain('slashCommands');
    expect(source).toContain("generatedCloudAgentInstance");
    expect(source).toContain('"profileEndpoint":"/cloud-agent/profile"');
    expect(source).toContain("cloudAgentInstanceState");
    expect(source).toContain("OPEN_THINK_EXECUTOR_MCP_URL");
    expect(source).toContain("OPEN_THINK_SANDBOX_STATUS");
    expect(source).toContain("SANDBOX_TRANSPORT");
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
    expect(source).toContain("workspaceCapabilityState");
    expect(source).toContain('"/workspace"');
    expect(source).toContain("cloudflareCodeModeMcpUrl");
    expect(source).toContain("workspaceSkillSources");
    expect(source).toContain("sourceCatalog: workspaceSkillSources");
    expect(source).toContain("https://www.aihero.dev/skills.md");
    expect(source).toContain("https://github.com/anthropics/skills");
    expect(source).toContain("https://github.com/openai/skills");
    expect(source).toContain("research-scout");
    expect(source).toContain("sub_agents");
    expect(source).toContain("waitForMcpConnections = { timeout: 1_500 }");
    expect(source).toContain("void this.startRuntimeWarmup()");
    expect(source).toContain("waitForRuntimeWarmup(1_500)");
    expect(source).toContain("prepareModelMessages(this.messages)");
    expect(source).toContain("getChatHistory(): UIMessage[]");
    expect(source).toContain("isAgentMessagesReadPath");
    expect(source).toContain('pathname.endsWith("/get-messages") || pathname.endsWith("/chat-history")');
    expect(source).toContain('request.method === "GET" && isAgentMessagesReadPath(url.pathname)');
    expect(source.indexOf('request.method === "GET" && isAgentMessagesReadPath(url.pathname)')).toBeLessThan(
      source.indexOf("const routed = await routeAgentRequest")
    );
    expect(source).toContain("sanitizeMessagesForModel");
    expect(source).toContain("mergeAdjacentUserMessages");
    expect(source).toContain("mergeUserMessages");
    expect(source).toContain("newest actionable request first");
    expect(source).toContain("isRenderableUiChunk");
    expect(source).toContain("writeTextFallback");
    expect(source).toContain("Tool work completed. I did not receive a final assistant summary");
    expect(source).toContain("createUIMessageStream<UIMessage>");
    expect(source).toContain("createUIMessageStreamResponse({ stream })");
    expect(source).toContain("stripEmptyTextParts");
    expect(source).toContain("isEmptyTextPart");
    expect(source).toContain("activeApprovalContinuationIndex");
    expect(source).toContain("ignoreIncompleteToolCalls: true");
    expect(source).toContain("suppressToolInputStreamingTransform");
    expect(source).toContain('part.type === "tool-input-start" || part.type === "tool-input-delta"');
    expect(source).not.toContain("pruneMessages");
    expect(source).toContain("experimental_transform: suppressToolInputStreamingTransform()");
    expect(source).toContain("stopWhen: stepCountIs(5)");
    expect(source).toContain("toUIMessageStream<UIMessage>({ sendReasoning: false })");
    expect(source).toContain('transport: "websocket"');
    expect(source).toContain("Personal agent subsystem:");
    expect(source).toContain("/personal-agent/setup");
    expect(source).toContain("memoryEmbeddingModel");
    expect(source).toContain("vectorizeUpsertText");
    expect(source).toContain("memorySearch");
    expect(source).toContain("semantic-memory-ready");
    expect(source).toContain("returnMetadata: true");
    const sourceDiagnostics = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
      },
      reportDiagnostics: true
    }).diagnostics ?? [];
    expect(formatDiagnostics(sourceDiagnostics)).toEqual([]);
  });
});

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): Array<Record<string, unknown>> {
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
    return {
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      line: location ? location.line + 1 : undefined,
      column: location ? location.character + 1 : undefined
    };
  });
}
