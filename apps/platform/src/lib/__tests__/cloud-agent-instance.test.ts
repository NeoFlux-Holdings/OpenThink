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
      enabled: true,
      mcpServerEnv: "OPEN_THINK_EXECUTOR_MCP_URL",
      authTokenEnv: "OPEN_THINK_EXECUTOR_AUTH_TOKEN"
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
    expect(profile.subAgents).toMatchObject({
      firstClass: true,
      modes: ["agents-sdk", "executor", "hybrid"]
    });
    expect(profile.sdk).toMatchObject({
      packageName: "@open-think/core",
      clientFactory: "createHostedCloudAgentClient",
      profileEndpoint: "/cloud-agent/profile"
    });
    expect(profile.customization.personalAgent).toContain("soul prompt");
    expect(cloudAgentGoalInstruction(profile)).toContain("Use Cloudflare Agents SDK");
    expect(cloudAgentGoalInstruction(profile)).toContain("executor MCP points");
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
