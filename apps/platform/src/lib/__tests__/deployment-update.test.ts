import { describe, expect, it } from "vitest";
import type { DeploymentRecord } from "../d1";
import {
  runDeploymentUpdate,
  summarizeDeploymentUpdate
} from "../deployment-update";

describe("deployment updates", () => {
  it("summarizes whether an update can run without pasting a token", () => {
    const summary = summarizeDeploymentUpdate(deploymentRecord(), {
      ARTIFACTS_REMOTE: "https://artifacts.example/open-think.git",
      ARTIFACTS_TOKEN: "artifact-token",
      OPEN_THINK_DEPLOYMENT_UPDATE_API_TOKEN: "update-token"
    });

    expect(summary.target?.scriptName).toBe("open-think-agent");
    expect(summary.canUpdateWithoutToken).toBe(true);
    expect(summary.credentialSource).toBe("deployment-update-token");
  });

  it("writes update metadata back into the deployment resource plan", async () => {
    const result = await runDeploymentUpdate({
      deployment: deploymentRecord(),
      action: "status",
      env: {
        ARTIFACTS_BRANCH: "main",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      autoUpdate: {
        enabled: true,
        direction: "pull-from-remote",
        intervalSeconds: 600
      }
    });

    expect(result.summary.canUpdateWithoutToken).toBe(true);
    expect(result.resourcePlan.openThinkUpdate).toMatchObject({
      target: {
        deploymentId: "agent-test",
        accountId: "acct",
        scriptName: "open-think-agent"
      },
      autoUpdate: {
        enabled: true,
        direction: "pull-from-remote",
        intervalSeconds: 600
      },
      credentialSource: "platform-token"
    });
  });

});

function deploymentRecord(): DeploymentRecord {
  return {
    id: "agent-test",
    userId: "test-user",
    flow: "self",
    starterTemplate: "personal-agent",
    status: "ready",
    agentUrl: "https://open-think-agent.example.workers.dev",
    resourcePlan: {
      accountId: "acct",
      scriptName: "open-think-agent",
      workerDeployment: {
        scriptName: "open-think-agent",
        url: "https://open-think-agent.example.workers.dev"
      }
    },
    authorization: {
      accountId: "acct",
      tokenFingerprint: "cfp_123",
      spendLimitUsd: 100,
      termsAcceptedAt: "2026-05-02T00:00:00.000Z",
      tenantKind: "self",
      agentName: "Test Agent"
    },
    createdAt: "2026-05-02T00:00:00.000Z",
    updatedAt: "2026-05-02T00:00:00.000Z"
  };
}
