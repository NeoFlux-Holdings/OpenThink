import { describe, expect, it } from "vitest";
import {
  DeploymentEngine,
  DeploymentProvisioningError,
  DeploymentValidationError,
  buildDeploymentRequest,
  type DeploymentProgressSink
} from "../deployment-engine";
import { InMemoryDeploymentRepository } from "../d1";

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
              dimensions: 768,
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

  it("persists a provisioning record and live progress events before the final ready state", async () => {
    const repository = new InMemoryDeploymentRepository();
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      eventDelayMs: 0,
      repository,
      repositoryKind: "memory",
      workersAIAvailable: true,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "platform-acct",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      provisioner: {
        async provision(_request, deploymentId, progress?: DeploymentProgressSink) {
          await expect(repository.get(deploymentId)).resolves.toMatchObject({
            id: deploymentId,
            status: "provisioning"
          });
          await progress?.({
            id: "test-live-progress",
            stage: "Bindings",
            status: "active",
            progress: 42,
            label: "Live test progress",
            detail: "Provisioner emitted progress before returning."
          });
          return testResourcePlan();
        }
      }
    });

    const result = await engine.deploy(testDeploymentRequest());
    const record = await repository.get(result.deploymentId);
    const events = await repository.listEvents(result.deploymentId);

    expect(record).toMatchObject({
      id: result.deploymentId,
      status: "ready",
      agentUrl: "https://open-think-agent.example.workers.dev"
    });
    expect(events.map((event) => event.id)).toEqual(
      expect.arrayContaining(["validate", "test-live-progress", "ready"])
    );
    expect(events.find((event) => event.id === "test-live-progress")).toMatchObject({
      status: "active",
      progress: 42
    });
  });

  it("returns a deployment stream before the provisioner finishes", async () => {
    const repository = new InMemoryDeploymentRepository();
    let releaseProvisioner!: () => void;
    const provisionerGate = new Promise<void>((resolve) => {
      releaseProvisioner = resolve;
    });
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      eventDelayMs: 0,
      repository,
      repositoryKind: "memory",
      workersAIAvailable: true,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "platform-acct",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      provisioner: {
        async provision(_request, _deploymentId, progress?: DeploymentProgressSink) {
          await progress?.({
            id: "provision-live",
            stage: "Bindings",
            status: "active",
            progress: 35,
            label: "Provisioning has started",
            detail: "This event is emitted before the final Worker upload completes."
          });
          await provisionerGate;
          return testResourcePlan();
        }
      }
    });

    const result = await engine.stream(testDeploymentRequest());
    const record = await repository.get(result.deploymentId);
    const reader = result.sseStream.getReader();
    const first = await readDeploymentEvent(reader);
    const second = await readDeploymentEvent(reader);

    expect(record).toMatchObject({
      id: result.deploymentId,
      status: "provisioning"
    });
    expect(first).toMatchObject({ id: "validate" });
    expect(second).toMatchObject({ id: "provision-live", status: "active" });

    releaseProvisioner();
    await result.completion;
    await reader.cancel();
    await expect(repository.get(result.deploymentId)).resolves.toMatchObject({
      status: "ready",
      agentUrl: "https://open-think-agent.example.workers.dev"
    });
  });

  it("prepares a queue-backed deployment and runs it from the queued message", async () => {
    const repository = new InMemoryDeploymentRepository();
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      eventDelayMs: 0,
      repository,
      repositoryKind: "d1",
      workersAIAvailable: true,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "platform-acct",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      provisioner: {
        async provision(_request, _deploymentId, progress?: DeploymentProgressSink) {
          await progress?.({
            id: "queue-provision-live",
            stage: "Bindings",
            status: "active",
            progress: 44,
            label: "Queued provisioner is running",
            detail: "The queue consumer emitted progress after the browser response returned."
          });
          return testResourcePlan();
        }
      }
    });

    const queued = await engine.prepareQueued(testDeploymentRequest());
    await expect(repository.get(queued.deploymentId)).resolves.toMatchObject({
      status: "provisioning"
    });
    await expect(repository.listEvents(queued.deploymentId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "validate" }),
        expect.objectContaining({ id: "queued", stage: "Queue" })
      ])
    );

    await engine.runQueuedDeployment(queued.queueMessage);

    await expect(repository.get(queued.deploymentId)).resolves.toMatchObject({
      status: "ready",
      agentUrl: "https://open-think-agent.example.workers.dev"
    });
    await expect(repository.listEvents(queued.deploymentId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "queue-start", stage: "Queue" }),
        expect.objectContaining({ id: "queue-provision-live", progress: 44 }),
        expect.objectContaining({ id: "ready", progress: 100 })
      ])
    );
  });

  it("persists failed provisioning status and error event", async () => {
    const repository = new InMemoryDeploymentRepository();
    const engine = new DeploymentEngine({
      platformHost: "beta2.open-think.app",
      eventDelayMs: 0,
      repository,
      repositoryKind: "memory",
      workersAIAvailable: true,
      env: {
        CLOUDFLARE_ACCOUNT_ID: "platform-acct",
        CLOUDFLARE_API_TOKEN: "platform-token"
      },
      provisioner: {
        async provision(_request, _deploymentId, progress?: DeploymentProgressSink) {
          await progress?.({
            id: "before-failure",
            stage: "Deploy",
            status: "active",
            progress: 66,
            label: "Started deploy",
            detail: "The deployment started before the provisioner failed."
          });
          throw new Error("Worker upload failed");
        }
      }
    });

    let deploymentId = "";
    await engine.deploy(testDeploymentRequest()).catch((error: unknown) => {
      expect(error).toBeInstanceOf(DeploymentProvisioningError);
      deploymentId = error instanceof DeploymentProvisioningError ? error.deploymentId : "";
    });

    const record = await repository.get(deploymentId);
    const events = await repository.listEvents(deploymentId);

    expect(record).toMatchObject({
      id: deploymentId,
      status: "failed"
    });
    expect(events.map((event) => event.id)).toEqual(
      expect.arrayContaining(["validate", "before-failure", "failed"])
    );
    expect(events.at(-1)).toMatchObject({
      status: "error",
      detail: "Worker upload failed"
    });
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

function testDeploymentRequest() {
  return buildDeploymentRequest("self", {
    starterTemplate: "personal-agent",
    userId: "test-user",
    agentName: "Test Personal Agent",
    cloudflareAccountId: "acct",
    accessAllowedEmail: "owner@example.com",
    cfApiToken: "token",
    spendLimitUsd: 100,
    acceptedTerms: true
  });
}

function testResourcePlan() {
  return {
    accountId: "acct",
    scriptName: "open-think-agent",
    d1Database: { name: "open-think-agent-db", id: "d1-id" },
    r2Bucket: { name: "open-think-agent-artifacts" },
    vectorizeIndex: {
      name: "open-think-agent-memory",
      dimensions: 768,
      metric: "cosine" as const
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

async function readDeploymentEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("Deployment stream ended before an event was received.");
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data: "));
      if (line) return JSON.parse(line.slice(6));
    }
  }
}
