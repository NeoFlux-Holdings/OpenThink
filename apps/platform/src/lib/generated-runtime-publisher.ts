import type { DeploymentRequest } from "./deployment-engine";
import {
  renderAgentsSdkPersonalAgentRuntime,
  type AgentsSdkRuntimeBindingPlan,
  type AgentsSdkRuntimeFile
} from "./agents-sdk-runtime-template";
import { readEnvString } from "./platform-env";

type RuntimeMode = "raw-worker-module" | "agents-sdk-container-build";

export interface GeneratedRuntimePublishResult {
  mode: RuntimeMode;
  scriptName: string;
  uploadedBy: "workers-scripts-api" | "container-build-endpoint";
  artifact?: {
    namespace: string;
    repo: string;
    remote: string;
    defaultBranch: string;
    tokenExpiresAt?: string;
  };
  build?: {
    endpoint: string;
    status: "uploaded" | "accepted";
    details?: Record<string, unknown>;
  };
}

export interface GeneratedRuntimePublishInput {
  request: DeploymentRequest;
  deploymentId: string;
  accountId: string;
  apiToken?: string;
  scriptName: string;
  bindings: AgentsSdkRuntimeBindingPlan;
  rawWorker: {
    moduleName: string;
    moduleCode: string;
    metadata: WorkerUploadMetadata;
  };
  wrangler: Record<string, unknown>;
}

export interface WorkerUploadMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  bindings: Array<Record<string, unknown>>;
}

export interface GeneratedRuntimeCloudflareClient {
  uploadWorkerModule(input: {
    scriptName: string;
    moduleName: string;
    moduleCode: string;
    metadata: WorkerUploadMetadata;
  }): Promise<void>;
  ensureArtifactRepoWithWriteToken(input: {
    namespace: string;
    repoName: string;
    description?: string;
    defaultBranch?: string;
    tokenTtlSeconds?: number;
  }): Promise<{
    id: string;
    name: string;
    remote: string;
    token: string;
    defaultBranch: string;
    expiresAt?: string;
  }>;
}

export interface GeneratedRuntimePublisher {
  publish(input: GeneratedRuntimePublishInput): Promise<GeneratedRuntimePublishResult>;
}

export function createGeneratedRuntimePublisher(
  client: GeneratedRuntimeCloudflareClient,
  env: Record<string, unknown> = process.env
): GeneratedRuntimePublisher {
  const requestedMode = readEnvString(env, "OPEN_THINK_GENERATED_RUNTIME") ?? "auto";
  const buildEndpoint = readEnvString(env, "OPEN_THINK_RUNTIME_BUILD_ENDPOINT");

  if (
    buildEndpoint &&
    (requestedMode === "auto" ||
      requestedMode === "agents-sdk" ||
      requestedMode === "agents-sdk-container-build")
  ) {
    const publisherOptions: ConstructorParameters<typeof AgentsSdkContainerBuildPublisher>[1] = {
      endpoint: buildEndpoint,
      artifactNamespace:
        readEnvString(env, "OPEN_THINK_ARTIFACTS_NAMESPACE") ??
        readEnvString(env, "ARTIFACTS_NAMESPACE") ??
        "default",
      artifactTokenTtlSeconds: readPositiveInteger(env, "OPEN_THINK_ARTIFACTS_TOKEN_TTL_SECONDS") ?? 86400
    };
    const authToken = readEnvString(env, "OPEN_THINK_RUNTIME_BUILD_TOKEN");
    if (authToken) {
      publisherOptions.authToken = authToken;
    }
    return new AgentsSdkContainerBuildPublisher(client, publisherOptions);
  }

  if (requestedMode === "agents-sdk" || requestedMode === "agents-sdk-container-build") {
    throw new Error(
      "OPEN_THINK_RUNTIME_BUILD_ENDPOINT is required when OPEN_THINK_GENERATED_RUNTIME selects the Agents SDK runtime."
    );
  }

  return new RawWorkerModulePublisher(client);
}

export class RawWorkerModulePublisher implements GeneratedRuntimePublisher {
  constructor(private readonly client: GeneratedRuntimeCloudflareClient) {}

  async publish(input: GeneratedRuntimePublishInput): Promise<GeneratedRuntimePublishResult> {
    await this.client.uploadWorkerModule({
      scriptName: input.scriptName,
      moduleName: input.rawWorker.moduleName,
      moduleCode: input.rawWorker.moduleCode,
      metadata: input.rawWorker.metadata
    });

    return {
      mode: "raw-worker-module",
      scriptName: input.scriptName,
      uploadedBy: "workers-scripts-api"
    };
  }
}

export class AgentsSdkContainerBuildPublisher implements GeneratedRuntimePublisher {
  constructor(
    private readonly client: GeneratedRuntimeCloudflareClient,
    private readonly options: {
      endpoint: string;
      authToken?: string;
      artifactNamespace: string;
      artifactTokenTtlSeconds: number;
      fetcher?: typeof fetch;
    }
  ) {}

  async publish(input: GeneratedRuntimePublishInput): Promise<GeneratedRuntimePublishResult> {
    const files = renderAgentsSdkPersonalAgentRuntime({
      request: input.request,
      deploymentId: input.deploymentId,
      bindings: input.bindings
    });
    const repoName = artifactRepoName(input.scriptName);
    const artifact = await this.client.ensureArtifactRepoWithWriteToken({
      namespace: this.options.artifactNamespace,
      repoName,
      description: `Generated open-think Agents SDK runtime for ${input.deploymentId}`,
      defaultBranch: "main",
      tokenTtlSeconds: this.options.artifactTokenTtlSeconds
    });

    const buildRequest: RuntimeBuildRequest = {
      kind: "open-think.agents-sdk-runtime-build.v1",
      deploymentId: input.deploymentId,
      accountId: input.accountId,
      scriptName: input.scriptName,
      files,
      wrangler: input.wrangler,
      artifact: {
        namespace: this.options.artifactNamespace,
        repo: artifact.name,
        remote: artifact.remote,
        token: artifact.token,
        defaultBranch: artifact.defaultBranch
      }
    };
    if (input.apiToken) {
      buildRequest.apiToken = input.apiToken;
    }

    const response = await (this.options.fetcher ?? fetch)(this.options.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.authToken ? { Authorization: `Bearer ${this.options.authToken}` } : {})
      },
      body: JSON.stringify(buildRequest)
    });

    const body = (await response.json().catch(() => ({}))) as {
      status?: "uploaded" | "accepted";
      details?: Record<string, unknown>;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(
        `Agents SDK runtime build failed with ${response.status}${body.error ? `: ${body.error}` : ""}`
      );
    }

    return {
      mode: "agents-sdk-container-build",
      scriptName: input.scriptName,
      uploadedBy: "container-build-endpoint",
      artifact: {
        namespace: this.options.artifactNamespace,
        repo: artifact.name,
        remote: artifact.remote,
        defaultBranch: artifact.defaultBranch,
        ...(artifact.expiresAt ? { tokenExpiresAt: artifact.expiresAt } : {})
      },
      build: {
        endpoint: this.options.endpoint,
        status: body.status ?? "uploaded",
        ...(body.details ? { details: body.details } : {})
      }
    };
  }
}

interface RuntimeBuildRequest {
  kind: "open-think.agents-sdk-runtime-build.v1";
  deploymentId: string;
  accountId: string;
  apiToken?: string;
  scriptName: string;
  files: AgentsSdkRuntimeFile[];
  wrangler: Record<string, unknown>;
  artifact: {
    namespace: string;
    repo: string;
    remote: string;
    token: string;
    defaultBranch: string;
  };
}

function artifactRepoName(scriptName: string): string {
  return scriptName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function readPositiveInteger(
  env: Record<string, unknown>,
  key: string
): number | undefined {
  const value = readEnvString(env, key);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
