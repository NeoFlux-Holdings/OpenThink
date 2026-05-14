import { describe, expect, it } from "vitest";
import { buildCloudAgentInstanceProfile, cloudAgentGoalInstruction } from "../cloud-agent-instance";
import { buildDeploymentRequest } from "../deployment-engine";

describe("buildCloudAgentInstanceProfile", () => {
  it("models Agents SDK chat with default executor execution", () => {
    const profile = buildCloudAgentInstanceProfile({
      deploymentId: "agent-cloud",
      executorEnabled: true,
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        agentName: "Ada",
        acceptedTerms: true,
        personalAgent: {
          enabled: true,
          presetId: "custom",
          customName: "Ada Brain",
          soulPrompt: "Prefer short answers.",
          launchBrief: "Start with deployment reviews."
        }
      })
    });

    expect(profile.kind).toBe("cloud-agent-instance");
    expect(profile.chat).toMatchObject({
      primaryRuntime: "cloudflare-agents-sdk",
      transport: "websocket",
      persistence: "sqlite"
    });
    expect(profile.brain.label).toBe("Ada Brain");
    expect(profile.prompts).toMatchObject({
      systemPromptConfigurable: true,
      soulPromptConfigured: true,
      launchBriefConfigured: true
    });
    expect(profile.execution.executor).toMatchObject({
      role: "first-party-or-external-execution-plane",
      enabled: true,
      mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
      authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN",
      defaultTarget: "same-Worker Cloudflare Sandbox/Containers RPC bridge, with optional self-hosted Executor MCP endpoint"
    });
    expect(profile.skills.find((skill) => skill.id === "executor-mcp")).toMatchObject({
      source: "executor",
      enabled: true
    });
    expect(profile.goal).toMatchObject({
      command: "/goal",
      firstClass: true,
      executorAware: true
    });
    expect(profile.train).toMatchObject({
      command: "/train",
      firstClass: true,
      behavior: "plan-first teach mode"
    });
    expect(profile.subAgents).toMatchObject({
      firstClass: true,
      modes: ["agents-sdk", "executor", "hybrid"],
      nativeRuntime: "Cloudflare Agents subAgent() typed RPC through OpenThinkSubAgent when package runtime is active",
      mcpRpc: "OpenThinkWorkspaceMcp same-Worker MCP server is registered through addMcpServer(WORKSPACE_MCP)."
    });
    expect(profile.codeMode).toMatchObject({
      enabled: true,
      cloudflareApiMcpUrl: "https://mcp.cloudflare.com/mcp?codemode=search_and_execute"
    });
    expect(profile.workspace.orchestrator).toMatchObject({
      enabled: true,
      autoSpunUp: true,
      className: "WorkspaceOrchestrator"
    });
    expect(profile.workspace.defaultSkills).toContain("cloudflare-agents");
    expect(profile.workspace.cloudflareSkillSources).toContain("https://developers.cloudflare.com/llms-full.txt");
    expect(profile.workspace.skillSources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cloudflare-skills", defaultEnabled: true }),
        expect.objectContaining({ id: "aihero-skills", url: "https://www.aihero.dev/skills.md" }),
        expect.objectContaining({ id: "anthropic-skills", url: "https://github.com/anthropics/skills" }),
        expect.objectContaining({ id: "openai-skills", url: "https://github.com/openai/skills" })
      ])
    );
    expect(profile.sdk).toMatchObject({
      packageName: "@open-think/core",
      clientFactory: "createHostedCloudAgentClient",
      profileEndpoint: "/cloud-agent/profile",
      endpoints: {
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
        mcp: {
          servers: "/mcp/servers",
          state: "/mcp/state",
          add: "/mcp/add",
          tools: "/mcp/tools",
          call: "/mcp/call",
          observability: "/mcp/observability"
        }
      }
    });
    expect(profile.customization.personalAgent).toContain("soul prompt");
    expect(cloudAgentGoalInstruction(profile)).toContain("Use Cloudflare Agents SDK");
    expect(cloudAgentGoalInstruction(profile)).toContain("same-Worker Cloudflare Sandbox Durable Object");
    expect(cloudAgentGoalInstruction(profile)).toContain("scoped child Cloud Agent Instances");
  });

  it("keeps executor available by default while marking missing connectivity pending", () => {
    const profile = buildCloudAgentInstanceProfile({
      deploymentId: "agent-cloud",
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        acceptedTerms: true
      })
    });

    expect(profile.skills.find((skill) => skill.id === "executor-mcp")).toMatchObject({
      enabled: true
    });
    expect(profile.execution.executor).toMatchObject({
      enabled: true,
      default: true,
      configured: false,
      status: "default-pending"
    });
    expect(profile.execution.sandbox).toMatchObject({
      enabled: true,
      default: true,
      configured: false,
      status: "default-pending"
    });
    expect(profile.execution.containers).toMatchObject({
      enabled: true,
      default: true,
      configured: false,
      status: "default-pending"
    });
  });
});
