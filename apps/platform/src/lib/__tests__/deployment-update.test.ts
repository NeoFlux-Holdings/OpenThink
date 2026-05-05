import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentRecord } from "../d1";
import {
  runDeploymentUpdate,
  summarizeDeploymentUpdate
} from "../deployment-update";

describe("deployment updates", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("can attach the optional Artifacts workspace after launch", async () => {
    let uploadedMetadata: Record<string, unknown> | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.includes("api.github.com/repos/NeoFlux-Holdings/OpenThink/commits/main")) {
          return new Response(JSON.stringify({ sha: "abc123456789" }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (target.endsWith("/accounts/acct/artifacts/namespaces/default/repos")) {
          return json({
            result: {
              id: "repo-id",
              name: "open-think-agent",
              description: "Self-edit workspace",
              default_branch: "main",
              remote: "https://acct.artifacts.cloudflare.net/git/default/open-think-agent.git",
              token: "art-token"
            }
          });
        }
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          uploadedMetadata = JSON.parse(String((init?.body as FormData).get("metadata")));
          return json({ result: {} });
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    const result = await runDeploymentUpdate({
      deployment: deploymentRecord(),
      action: "enable-workspace",
      env: {},
      cfApiToken: "cf-token"
    });

    expect(result.summary.workspace.artifacts.status).toBe("configured");
    expect(result.resourcePlan.openThinkWorkspace).toMatchObject({
      mode: "artifacts-sandbox-workspace",
      artifact: {
        namespace: "default",
        repo: "open-think-agent",
        tokenSecretConfigured: true
      },
      sandbox: {
        status: "ready-to-add"
      }
    });
    expect(uploadedMetadata?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "secret_text",
          name: "OPEN_THINK_ARTIFACTS_TOKEN",
          text: "art-token"
        })
      ])
    );
  });

});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, ...(body as object) }), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

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
