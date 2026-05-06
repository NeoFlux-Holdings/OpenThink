import { describe, expect, it } from "vitest";
import {
  AgentsSdkContainerBuildPublisher,
  LocalAgentsSdkBuildPublisher,
  RawWorkerModulePublisher,
  createGeneratedRuntimePublisher,
  type GeneratedRuntimePublishInput,
  type GeneratedRuntimeCloudflareClient
} from "../generated-runtime-publisher";

const client: GeneratedRuntimeCloudflareClient = {
  async uploadWorkerModule() {
    return undefined;
  },
  async uploadWorkerAssets() {
    return { jwt: "asset-jwt" };
  },
  async ensureArtifactRepoWithWriteToken() {
    return {
      id: "repo-id",
      name: "repo",
      remote: "https://example.com/repo.git",
      token: "token",
      defaultBranch: "main"
    };
  }
};

describe("createGeneratedRuntimePublisher", () => {
  it("defaults to the local Agents SDK build publisher in Node when no build endpoint is configured", () => {
    const publisher = createGeneratedRuntimePublisher(client, {});

    expect(publisher).toBeInstanceOf(LocalAgentsSdkBuildPublisher);
  });

  it("uses the Agents SDK container build publisher when the build endpoint is configured", () => {
    const publisher = createGeneratedRuntimePublisher(client, {
      OPEN_THINK_RUNTIME_BUILD_ENDPOINT: "https://builder.example.test/runtime"
    });

    expect(publisher).toBeInstanceOf(AgentsSdkContainerBuildPublisher);
  });

  it("keeps the raw Worker runtime as an explicit fallback only", () => {
    const publisher = createGeneratedRuntimePublisher(client, {
      OPEN_THINK_GENERATED_RUNTIME: "raw-worker-module"
    });

    expect(publisher).toBeInstanceOf(RawWorkerModulePublisher);
  });

  it("requires an endpoint when container build mode is explicit", () => {
    expect(() =>
      createGeneratedRuntimePublisher(client, {
        OPEN_THINK_GENERATED_RUNTIME: "agents-sdk-container-build"
      })
    ).toThrow(/OPEN_THINK_RUNTIME_BUILD_ENDPOINT is required/);
  });

  it("builds the Agents SDK runtime locally and prepares asset-backed upload metadata", async () => {
    let uploadedAssets = 0;
    let uploadedModule:
      | Parameters<GeneratedRuntimeCloudflareClient["uploadWorkerModule"]>[0]
      | undefined;
    const localClient: GeneratedRuntimeCloudflareClient = {
      async uploadWorkerAssets(input) {
        uploadedAssets = input.assets.length;
        expect(input.assets.some((asset) => asset.path === "/index.html")).toBe(true);
        return { jwt: "asset-jwt" };
      },
      async uploadWorkerModule(input) {
        uploadedModule = input;
      },
      async ensureArtifactRepoWithWriteToken() {
        return {
          id: "repo-id",
          name: "repo",
          remote: "https://example.com/repo.git",
          token: "token",
          defaultBranch: "main"
        };
      }
    };
    const publisher = new LocalAgentsSdkBuildPublisher(localClient, {});
    const input: GeneratedRuntimePublishInput = {
      request: {
        flow: "self",
        starterTemplate: "personal-agent",
        userId: "owner",
        agentName: "Local SDK Agent",
        cloudflareAccountId: "account-id",
        personalAgent: {
          toolApprovalPolicy: "ask-every-time"
        }
      },
      deploymentId: "agent-local-build-test",
      accountId: "account-id",
      sourceSha: "source-sha",
      scriptName: "open-think-local-build-test",
      bindings: {
        scriptName: "open-think-local-build-test",
        databaseName: "db",
        databaseId: "db-id",
        bucketName: "bucket",
        queueName: "queue",
        vectorizeName: "vector"
      },
      rawWorker: {
        moduleName: "worker.js",
        moduleCode: "export default {};",
        metadata: {
          main_module: "worker.js",
          compatibility_date: "2026-05-01",
          compatibility_flags: [],
          bindings: [
            {
              type: "plain_text",
              name: "OPEN_THINK_MODEL_PROVIDER",
              text: "workers-ai"
            }
          ]
        }
      },
      wrangler: {}
    };

    const result = await publisher.publish(input);

    expect(result.mode).toBe("agents-sdk-local-build");
    expect(uploadedAssets).toBeGreaterThan(0);
    expect(uploadedModule?.moduleName.endsWith(".js")).toBe(true);
    expect(uploadedModule?.moduleCode).toContain("PersonalChatAgent");
    expect(uploadedModule?.metadata.assets?.jwt).toBe("asset-jwt");
    expect(uploadedModule?.metadata.migrations).toEqual({
      new_tag: "agent-local-build-test-agents-sdk-v1",
      new_sqlite_classes: ["PersonalChatAgent"]
    });
    expect(uploadedModule?.metadata.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "assets", name: "ASSETS" }),
        expect.objectContaining({
          type: "durable_object_namespace",
          name: "PersonalChatAgent"
        }),
        expect.objectContaining({
          name: "OPEN_THINK_TOOL_APPROVAL_POLICY",
          text: "ask-every-time"
        }),
        expect.objectContaining({
          name: "OPEN_THINK_SOURCE_SHA",
          text: "source-sha"
        }),
        expect.objectContaining({
          name: "OPEN_THINK_MODEL_PROVIDER",
          text: "workers-ai"
        })
      ])
    );
  }, 120_000);
});
