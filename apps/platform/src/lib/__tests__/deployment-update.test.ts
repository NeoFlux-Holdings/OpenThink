import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeploymentRecord } from "../d1";
import {
  runDeploymentUpdate,
  summarizeDeploymentUpdate
} from "../deployment-update";

const rawRuntimeEnv = {
  OPEN_THINK_GENERATED_RUNTIME: "raw-worker-module"
};

const containerRuntimeEnv = {
  OPEN_THINK_GENERATED_RUNTIME: "agents-sdk-container-build",
  OPEN_THINK_RUNTIME_BUILD_ENDPOINT: "https://builder.example.test/runtime"
};

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
      env: rawRuntimeEnv,
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

  it("reconcile uploads even when stored metadata claims the same upstream SHA", async () => {
    let buildCount = 0;
    let buildRequest: Record<string, unknown> | undefined;

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
              default_branch: "main",
              remote: "https://acct.artifacts.cloudflare.net/git/default/open-think-agent.git",
              token: "runtime-build-token"
            }
          });
        }
        if (target === containerRuntimeEnv.OPEN_THINK_RUNTIME_BUILD_ENDPOINT) {
          buildCount += 1;
          buildRequest = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          return json({ status: "uploaded" });
        }
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          throw new Error("reconcile should publish through the generated runtime builder");
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    const result = await runDeploymentUpdate({
      deployment: deploymentRecord({
        resourcePlan: {
          openThinkUpdate: {
            target: {
              deploymentId: "agent-test",
              accountId: "acct",
              scriptName: "open-think-agent",
              agentUrl: "https://open-think-agent.example.workers.dev"
            },
            autoUpdate: {
              enabled: false,
              direction: "bidirectional",
              intervalSeconds: 300
            },
            lastAction: "reconcile",
            lastCommitSha: "abc123456789",
            lastDeployedSha: "abc123456789",
            updatedAt: "2026-05-02T00:00:00.000Z"
          }
        }
      }),
      action: "reconcile",
      env: containerRuntimeEnv,
      cfApiToken: "cf-token"
    });

    const runtimeFiles = (buildRequest?.files ?? []) as Array<{ path: string; contents: string }>;
    const serverFile = runtimeFiles.find((file) => file.path === "src/server.ts");
    const wrangler = (buildRequest?.wrangler ?? {}) as Record<string, unknown>;
    const durableObjects = (wrangler.durable_objects ?? {}) as Record<string, unknown>;

    expect(buildCount).toBe(1);
    expect(buildRequest?.sourceSha).toBe("abc123456789");
    expect(serverFile?.contents).toContain("export class PersonalChatAgent");
    expect(durableObjects.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "PersonalChatAgent",
          class_name: "PersonalChatAgent"
        })
      ])
    );
    expect(result.result?.message).toContain("Uploaded open-think-agent");
    expect(result.resourcePlan.openThinkUpdate).toMatchObject({
      lastAction: "reconcile",
      lastDeployedSha: "abc123456789"
    });
  });

  it("rejects raw fallback updates for existing Agents SDK deployments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const target = String(url);
        if (target.includes("api.github.com/repos/NeoFlux-Holdings/OpenThink/commits/main")) {
          return new Response(JSON.stringify({ sha: "abc123456789" }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          throw new Error("raw fallback upload should be blocked before Cloudflare upload");
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    await expect(
      runDeploymentUpdate({
        deployment: deploymentRecord({
          resourcePlan: {
            generatedRuntime: {
              mode: "agents-sdk-container-build"
            }
          }
        }),
        action: "deploy",
        env: rawRuntimeEnv,
        cfApiToken: "cf-token"
      })
    ).rejects.toThrow(/must also publish an Agents SDK bundle/);
  });

  it("requires a typed confirmation before reset", async () => {
    await expect(
      runDeploymentUpdate({
        deployment: deploymentRecord(),
        action: "reset",
        env: {},
        cfApiToken: "cf-token",
        reset: {
          mode: "source",
          confirmation: "RESET wrong"
        }
      })
    ).rejects.toThrow('Reset requires typing "RESET agent-test"');
  });

  it("source reset preserves the current personal agent prompt flags", async () => {
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
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          uploadedMetadata = JSON.parse(String((init?.body as FormData).get("metadata")));
          return json({ result: {} });
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    await runDeploymentUpdate({
      deployment: deploymentRecord({
        resourcePlan: {
          openThinkPersonalAgent: {
            enabled: true,
            presetId: "custom",
            customName: "Current Brain",
            toolApprovalPolicy: "ask-every-time",
            soulPromptConfigured: true,
            launchBriefConfigured: true
          }
        }
      }),
      action: "reset",
      env: rawRuntimeEnv,
      cfApiToken: "cf-token",
      reset: {
        mode: "source",
        confirmation: "RESET agent-test"
      }
    });

    const bindings = uploadedMetadata?.bindings as Array<Record<string, unknown>>;
    const publicConfig = bindings.find(
      (binding) => binding.name === "OPEN_THINK_PERSONAL_AGENT_CONFIG"
    );
    expect(JSON.parse(String(publicConfig?.text))).toMatchObject({
      label: "Current Brain",
      toolApprovalPolicy: "ask-every-time",
      soulPromptConfigured: true,
      launchBriefConfigured: true
    });
    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "OPEN_THINK_TOOL_APPROVAL_POLICY",
          text: "ask-every-time"
        })
      ])
    );
  });

  it("factory resets custom workspace metadata while preserving secrets", async () => {
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
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          uploadedMetadata = JSON.parse(String((init?.body as FormData).get("metadata")));
          return json({ result: {} });
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    const result = await runDeploymentUpdate({
      deployment: deploymentRecord({
        resourcePlan: {
          openThinkRuntime: {
            defaultModel: "openai/gpt-5.5",
            modelProvider: "openai",
            thinkingLevel: "high"
          },
          openThinkWorkspace: {
            mode: "artifacts-sandbox-workspace",
            artifact: {
              namespace: "default",
              repo: "open-think-agent",
              remote: "https://acct.artifacts.cloudflare.net/git/default/open-think-agent.git",
              defaultBranch: "main",
              tokenSecretConfigured: true,
              enabledAt: "2026-05-02T00:00:00.000Z"
            },
            sandbox: {
              status: "ready-to-add",
              requiresPaidPlan: true
            },
            containers: {
              status: "ready-to-add",
              requiresPaidPlan: true
            },
            updatedAt: "2026-05-02T00:00:00.000Z"
          }
        }
      }),
      action: "reset",
      env: rawRuntimeEnv,
      cfApiToken: "cf-token",
      reset: {
        mode: "factory-settings",
        confirmation: "RESET agent-test"
      }
    });

    expect(result.resourcePlan.openThinkWorkspace).toBeUndefined();
    expect(result.summary.workspace.artifacts.status).toBe("upgradeable");
    expect(result.resourcePlan.openThinkRuntime).toMatchObject({
      defaultModel: "@cf/moonshotai/kimi-k2.6",
      modelProvider: "workers-ai",
      thinkingLevel: "medium"
    });
    expect(uploadedMetadata).toMatchObject({
      keep_bindings: ["secret_text", "secret_key"]
    });
    expect(uploadedMetadata?.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "OPEN_THINK_DEFAULT_MODEL",
          text: "@cf/moonshotai/kimi-k2.6"
        })
      ])
    );
  });

  it("can factory reset and re-setup a new personal agent brain", async () => {
    let uploadedMetadata: Record<string, unknown> | undefined;
    let d1Batch: Array<{ sql: string }> | undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = String(url);
        if (target.includes("api.github.com/repos/NeoFlux-Holdings/OpenThink/commits/main")) {
          return new Response(JSON.stringify({ sha: "abc123456789" }), {
            headers: { "Content-Type": "application/json" }
          });
        }
        if (target.includes("/accounts/acct/d1/database/d1-id/query")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            batch?: Array<{ sql: string }>;
          };
          d1Batch = body.batch;
          return json({ result: [] });
        }
        if (target.includes("/accounts/acct/workers/scripts/open-think-agent")) {
          uploadedMetadata = JSON.parse(String((init?.body as FormData).get("metadata")));
          return json({ result: {} });
        }
        return json({ result: {} });
      }) as unknown as typeof fetch
    );

    const result = await runDeploymentUpdate({
      deployment: deploymentRecord({
        resourcePlan: {
          d1Database: { id: "d1-id" },
          openThinkPersonalAgent: {
            enabled: true,
            presetId: "openthink-gbrain-gstack",
            label: "Old Brain",
            soulPromptConfigured: true
          }
        }
      }),
      action: "reset",
      env: rawRuntimeEnv,
      cfApiToken: "cf-token",
      reset: {
        mode: "factory-settings",
        confirmation: "RESET agent-test",
        personalAgent: {
          enabled: true,
          presetId: "custom",
          customName: "Reset Brain",
          toolApprovalPolicy: "allow-all",
          soulPrompt: "Keep the long-term identity stable.",
          launchBrief: "Start by rebuilding the personal knowledge base.",
          features: {
            knowledgeGraph: true,
            browserAutomation: false
          }
        }
      }
    });

    expect(result.resourcePlan.openThinkPersonalAgent).toMatchObject({
      enabled: true,
      label: "Reset Brain",
      toolApprovalPolicy: "allow-all",
      soulPromptConfigured: true,
      launchBriefConfigured: true
    });

    const bindings = uploadedMetadata?.bindings as Array<Record<string, unknown>>;
    const publicConfig = bindings.find(
      (binding) => binding.name === "OPEN_THINK_PERSONAL_AGENT_CONFIG"
    );
    expect(JSON.parse(String(publicConfig?.text))).toMatchObject({
      label: "Reset Brain",
      toolApprovalPolicy: "allow-all",
      soulPromptConfigured: true,
      launchBriefConfigured: true
    });
    expect(String(publicConfig?.text)).not.toContain("Keep the long-term identity stable.");
    expect(String(publicConfig?.text)).not.toContain("rebuilding the personal knowledge base");
    expect(bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "plain_text",
          name: "OPEN_THINK_TOOL_APPROVAL_POLICY",
          text: "allow-all"
        }),
        expect.objectContaining({
          type: "secret_text",
          name: "OPEN_THINK_SOUL_PROMPT",
          text: "Keep the long-term identity stable."
        }),
        expect.objectContaining({
          type: "secret_text",
          name: "OPEN_THINK_LAUNCH_BRIEF",
          text: "Start by rebuilding the personal knowledge base."
        })
      ])
    );
    expect(d1Batch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sql: expect.stringContaining("setup:agent-test:launch-brief")
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

function deploymentRecord(
  overrides: { resourcePlan?: Record<string, unknown> } = {}
): DeploymentRecord {
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
      },
      ...overrides.resourcePlan
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
