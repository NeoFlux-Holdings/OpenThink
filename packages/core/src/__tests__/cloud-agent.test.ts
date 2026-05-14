import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createHostedCloudAgentClient,
  hostedCloudAgentFlow,
  hostedCloudAgentSdkSnippet
} from "../index";

describe("HostedCloudAgentClient", () => {
  it("calls hosted cloud agent endpoints with typed helpers", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createHostedCloudAgentClient({
      baseUrl: "https://agent.example.com/",
      headers: { Authorization: "Bearer test" },
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).endsWith("/cloud-agent/profile")) {
          return Response.json({
            schemaVersion: "2026-05-10",
            id: "agent-1",
            label: "Agent",
            kind: "cloud-agent-instance",
            chat: {
              primaryRuntime: "cloudflare-agents-sdk",
              transport: "websocket",
              persistence: "sqlite"
            },
            brain: { id: "native", label: "Native", stack: "gbrain", enabledFeatures: [] },
            prompts: {
              systemPromptConfigurable: true,
              soulPromptConfigured: false,
              launchBriefConfigured: false
            },
            codeMode: {
              enabled: true,
              default: true,
              cloudflareApiMcpUrl: "https://mcp.cloudflare.com/mcp?codemode=search_and_execute",
              portalQuery: "codemode=search_and_execute",
              toolShape: "search-and-execute"
            },
            skills: [],
            execution: {
              agentsSdk: { role: "chat-streaming-state-and-tool-orchestration", enabled: true },
              executor: {
                role: "first-party-or-external-execution-plane",
                enabled: true,
                default: true,
                configured: false,
                status: "default-pending",
                mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
                authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
                defaultTarget: "same-Worker Cloudflare Sandbox/Containers RPC bridge, with optional self-hosted Executor MCP endpoint",
                recommendedFor: []
              },
              sandbox: {
                role: "cloudflare-sandbox-execution",
                enabled: true,
                default: true,
                configured: false,
                status: "default-pending"
              },
              containers: {
                role: "custom-runtime-and-long-running-services",
                enabled: true,
                default: true,
                configured: false,
                status: "default-pending"
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
              persistence: "D1 sub_agents and sub_agent_messages plus native OpenThinkSubAgent facets when Agents SDK runtime is active",
              modes: ["agents-sdk", "executor", "hybrid"],
              controls: ["create"],
              nativeRuntime: "Cloudflare Agents subAgent() typed RPC through OpenThinkSubAgent when package runtime is active",
              mcpRpc: "OpenThinkWorkspaceMcp same-Worker MCP server is registered through addMcpServer(WORKSPACE_MCP)."
            },
            workspace: {
              firstClass: true,
              defaultWorkspace: "default",
              orchestrator: {
                enabled: true,
                autoSpunUp: true,
                className: "WorkspaceOrchestrator",
                coordination: "native-sub-agent-rpc"
              },
              contextStore: {
                primary: "D1 workspace_context",
                semantic: "Vectorize semantic recall when AI and VECTORIZE bindings are connected",
                vectorizeBinding: "VECTORIZE"
              },
              defaultSkills: ["cloudflare-agents"],
              cloudflareSkillSources: ["https://developers.cloudflare.com/llms-full.txt"],
              skillSources: [
                {
                  id: "cloudflare-llms-full",
                  label: "Cloudflare llms-full",
                  url: "https://developers.cloudflare.com/llms-full.txt",
                  category: "cloudflare",
                  defaultEnabled: true
                }
              ],
              approvalModes: ["auto", "ask-every-time", "allow-all", "full-auto"]
            },
            sdk: {
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
            },
            customization: {
              deployTime: [],
              runtimeEnv: [],
              personalAgent: [],
              subAgent: [],
              workspace: []
            }
          });
        }
        return Response.json({ ok: true, subAgent: { id: "sub-1" }, messages: [] });
      }
    });

    const profile = await client.profile();
    await client.goal("Ship it");
    await client.sendSubAgentMessage("sub-1", "continue");
    await client.workspace();
    await client.listSkills();
    await client.addMemory("Prefer focused deployment checks.");
    await client.searchMemory("focused deployment", 5);
    await client.listArtifacts();
    await client.getArtifact("docs/brief.md");
    await client.putArtifact("docs/brief.md", "# Brief");
    await client.listFiles();
    await client.putFile("notes/deploy.md", "# Deploy notes");
    await client.getFileJson("notes/deploy.md");
    await client.listTasks();
    await client.createTask({ title: "Follow release checklist", payload: { lane: "release" } });
    await client.browserSnapshot({ url: "https://example.com" });
    await client.browserDiagnostics();
    await client.browser.diagnostics({ live: true });
    await client.listBrowserSessions({ limit: 10 });
    await client.createBrowserSession({ url: "https://example.com" });
    await client.listBrowserSessionTargets("session-1");
    await client.createBrowserSessionTarget("session-1", { url: "https://example.com/docs" });
    await client.browserFrameStreamStatus("session-1", "target-1", { fps: 4 });
    client.browserFrameStreamUrl("session-1", "target-1", { fps: 4 });
    await client.closeBrowserSessionTarget("session-1", "target-1");
    await client.closeBrowserSession("session-1");
    await client.contributions();
    await client.createContributionPullRequest({
      title: "Update docs",
      changes: [{ path: "docs/brief.md", content: "# Brief" }]
    });
    await client.learning();
    await client.createLearningSuggestion({
      kind: "skill",
      title: "Review release checklist",
      summary: "Promote the release checklist into a reusable skill."
    });
    await client.acceptLearningSuggestion("learn-1");
    await client.rejectLearningSuggestion("learn-2");
    await client.executorStatus();
    await client.executor.listTools();
    await client.executor.captureDiff({ pathspec: ["src", "docs"] });
    await client.listMcpServers();
    await client.mcpState();
    await client.mcpObservability({ includeSeries: true });
    await client.addMcpServer({ name: "team-tools", url: "https://tools.example.com/mcp" });
    await client.callMcpTool("cloudflare", "search", { query: "Workers" });

    expect(profile.kind).toBe("cloud-agent-instance");
    expect(calls.map((call) => call.url)).toEqual([
      "https://agent.example.com/cloud-agent/profile",
      "https://agent.example.com/goal",
      "https://agent.example.com/subagents/sub-1/messages",
      "https://agent.example.com/workspace",
      "https://agent.example.com/skills",
      "https://agent.example.com/memory",
      "https://agent.example.com/memory?q=focused+deployment&limit=5",
      "https://agent.example.com/artifacts",
      "https://agent.example.com/artifacts?key=docs%2Fbrief.md&versions=1",
      "https://agent.example.com/artifacts",
      "https://agent.example.com/files",
      "https://agent.example.com/files",
      "https://agent.example.com/files?key=notes%2Fdeploy.md&json=1",
      "https://agent.example.com/tasks",
      "https://agent.example.com/tasks",
      "https://agent.example.com/browser/snapshot",
      "https://agent.example.com/browser/diagnostics",
      "https://agent.example.com/browser/diagnostics",
      "https://agent.example.com/browser/sessions?limit=10",
      "https://agent.example.com/browser/sessions",
      "https://agent.example.com/browser/sessions/session-1/targets",
      "https://agent.example.com/browser/sessions/session-1/targets",
      "https://agent.example.com/browser/sessions/session-1/targets/target-1/frames/status?fps=4",
      "https://agent.example.com/browser/sessions/session-1/targets/target-1",
      "https://agent.example.com/browser/sessions/session-1",
      "https://agent.example.com/contributions",
      "https://agent.example.com/contributions",
      "https://agent.example.com/learning",
      "https://agent.example.com/learning",
      "https://agent.example.com/learning/learn-1",
      "https://agent.example.com/learning/learn-2",
      "https://agent.example.com/executor",
      "https://agent.example.com/mcp/tools?server=executor",
      "https://agent.example.com/mcp/call",
      "https://agent.example.com/mcp/servers",
      "https://agent.example.com/mcp/state",
      "https://agent.example.com/mcp/observability?series=1",
      "https://agent.example.com/mcp/add",
      "https://agent.example.com/mcp/call"
    ]);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[2]?.init?.method).toBe("POST");
    expect(calls[5]?.init?.method).toBe("POST");
    expect(calls[9]?.init?.method).toBe("POST");
    expect(calls[11]?.init?.method).toBe("POST");
    expect(calls[14]?.init?.method).toBe("POST");
    expect(calls[15]?.init?.method).toBe("POST");
    expect(calls[17]?.init?.method).toBe("POST");
    expect(calls[19]?.init?.method).toBe("POST");
    expect(calls[21]?.init?.method).toBe("POST");
    expect(calls[23]?.init?.method).toBe("DELETE");
    expect(calls[24]?.init?.method).toBe("DELETE");
    expect(calls[26]?.init?.method).toBe("POST");
    expect(calls[28]?.init?.method).toBe("POST");
    expect(calls[29]?.init?.method).toBe("PATCH");
    expect(calls[30]?.init?.method).toBe("PATCH");
    expect(calls[33]?.init?.method).toBe("POST");
    expect(calls[37]?.init?.method).toBe("POST");
    expect(calls[38]?.init?.method).toBe("POST");
    expect(new Headers(calls[1]?.init?.headers).get("Authorization")).toBe("Bearer test");
  });

  it("documents the end-to-end hosted flow and SDK snippet", () => {
    expect(hostedCloudAgentFlow.map((step) => step.id)).toEqual([
      "design",
      "deploy",
      "connect",
      "customize",
      "delegate",
      "operate"
    ]);
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("createHostedCloudAgentClient");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.createSubAgent");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.workspace");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.learning");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.acceptLearningSuggestion");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.listArtifacts");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.putFile");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.createTask");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.browserSnapshot");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.createBrowserSession");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.browser.frameStreamStatus");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.browser.frameStreamUrl");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.contributions");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.searchMemory");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.addMcpServer");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.mcpObservability");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.executor.listTools");
    expect(hostedCloudAgentSdkSnippet("https://agent.example.com")).toContain("agent.executor.captureDiff");
  });

  it("publishes package metadata for external SDK consumers", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));

    expect(packageJson.exports["."]).toEqual({
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    });
    expect(packageJson.files).toEqual(expect.arrayContaining(["dist", "README.md"]));
    expect(packageJson.publishConfig.access).toBe("public");
    expect(packageJson.repository).toMatchObject({
      type: "git",
      url: "git+https://github.com/NeoFlux-Holdings/OpenThink.git",
      directory: "packages/core"
    });
  });
});
