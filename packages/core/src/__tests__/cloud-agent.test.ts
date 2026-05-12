import { describe, expect, it } from "vitest";
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
            skills: [],
            execution: {
              agentsSdk: { role: "chat-streaming-state-and-tool-orchestration", enabled: true },
              executor: {
                role: "external-execution-plane",
                enabled: true,
                default: true,
                configured: false,
                status: "default-pending",
                mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
                authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
                defaultTarget: "first-party Cloudflare Sandbox bridge or self-hosted Executor MCP endpoint",
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
              persistence: "D1 sub_agents and sub_agent_messages when DB is bound",
              modes: ["agents-sdk", "executor", "hybrid"],
              controls: ["create"]
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
                runtimeContext: "/runtime/context",
                personalAgentSetup: "/personal-agent/setup"
              }
            },
            customization: {
              deployTime: [],
              runtimeEnv: [],
              personalAgent: [],
              subAgent: []
            }
          });
        }
        return Response.json({ ok: true, subAgent: { id: "sub-1" }, messages: [] });
      }
    });

    const profile = await client.profile();
    await client.goal("Ship it");
    await client.sendSubAgentMessage("sub-1", "continue");

    expect(profile.kind).toBe("cloud-agent-instance");
    expect(calls.map((call) => call.url)).toEqual([
      "https://agent.example.com/cloud-agent/profile",
      "https://agent.example.com/goal",
      "https://agent.example.com/subagents/sub-1/messages"
    ]);
    expect(calls[1]?.init?.method).toBe("POST");
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
  });
});
