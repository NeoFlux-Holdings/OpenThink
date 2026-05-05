import { describe, expect, it } from "vitest";
import {
  DeploymentEngine,
  DeploymentValidationError,
  buildDeploymentRequest
} from "../deployment-engine";

describe("DeploymentEngine", () => {
  it("adapts self-service requests into a deployment result", async () => {
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      eventDelayMs: 0,
      repositoryKind: "d1",
      workersAIAvailable: true,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "platform-acct",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      provisioner: {
        async provision() {
          return {
            accountId: "acct",
            scriptName: "open-think-agent",
            d1Database: { name: "open-think-agent-db", id: "d1-id" },
            r2Bucket: { name: "open-think-agent-artifacts" },
            vectorizeIndex: {
              name: "open-think-agent-memory",
              dimensions: 1536,
              metric: "cosine"
            },
            queue: { name: "open-think-agent-tasks", id: "queue-id" },
            workerDeployment: {
              scriptName: "open-think-agent",
              uploadedAt: new Date().toISOString(),
              url: "https://open-think-agent.example.workers.dev"
            },
            wrangler: {}
          };
        }
      }
    });

    const result = await engine.deploy(
      buildDeploymentRequest("self", {
        starterTemplate: "personal-agent",
        userId: "test-user",
        agentName: "Test Personal Agent",
        cloudflareAccountId: "acct",
        accessAllowedEmail: "owner@example.com",
        cfApiToken: "token",
        spendLimitUsd: 100,
        acceptedTerms: true
      })
    );

    expect(result.deploymentId).toMatch(/^agent-/);
    expect(result.agentUrl).toBe("https://open-think-agent.example.workers.dev");
    expect(result.events.at(-1)?.progress).toBe(100);
  });

  it("rejects a flow missing its required credential", async () => {
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app"
    });

    await expect(
      engine.deploy(
        buildDeploymentRequest("agent", {
          starterTemplate: "personal-agent",
          userId: "test-user"
        })
      )
    ).rejects.toBeInstanceOf(DeploymentValidationError);
  });

  it("rejects malformed additional Access emails", async () => {
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      provisioner: {
        async provision() {
          throw new Error("should not provision");
        }
      }
    });

    await expect(
      engine.deploy(
        buildDeploymentRequest("self", {
          starterTemplate: "personal-agent",
          userId: "test-user",
          cloudflareAccountId: "acct",
          accessAllowedEmail: "owner@example.com",
          accessAdditionalEmails: ["not-an-email"],
          cfApiToken: "token",
          spendLimitUsd: 100,
          acceptedTerms: true
        })
      )
    ).rejects.toBeInstanceOf(DeploymentValidationError);
  });

  it("rejects custom personal agent setup without a name or soul prompt", async () => {
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      provisioner: {
        async provision() {
          throw new Error("should not provision");
        }
      }
    });

    await expect(
      engine.deploy(
        buildDeploymentRequest("self", {
          starterTemplate: "personal-agent",
          userId: "test-user",
          cloudflareAccountId: "acct",
          accessAllowedEmail: "owner@example.com",
          cfApiToken: "token",
          spendLimitUsd: 100,
          acceptedTerms: true,
          personalAgent: {
            enabled: true,
            presetId: "custom"
          }
        })
      )
    ).rejects.toBeInstanceOf(DeploymentValidationError);
  });

  it("rejects unsupported MCP tool approval policies", async () => {
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      provisioner: {
        async provision() {
          throw new Error("should not provision");
        }
      }
    });

    await expect(
      engine.deploy(
        buildDeploymentRequest("self", {
          starterTemplate: "personal-agent",
          userId: "test-user",
          cloudflareAccountId: "acct",
          accessAllowedEmail: "owner@example.com",
          cfApiToken: "token",
          spendLimitUsd: 100,
          acceptedTerms: true,
          personalAgent: {
            enabled: true,
            presetId: "openthink-gbrain-gstack",
            toolApprovalPolicy: "unsafe" as never
          }
        })
      )
    ).rejects.toBeInstanceOf(DeploymentValidationError);
  });
});
