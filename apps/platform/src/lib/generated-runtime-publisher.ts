import type { DeploymentRequest } from "./deployment-engine";
import {
  renderAgentsSdkPersonalAgentRuntime,
  type AgentsSdkRuntimeBindingPlan,
  type AgentsSdkRuntimeFile
} from "./agents-sdk-runtime-template";
import {
  normalizePersonalAgentConfig,
  personalAgentPublicConfigBindingText
} from "./personal-agent-options";
import { readEnvString } from "./platform-env";

type RuntimeMode =
  | "raw-worker-module"
  | "agents-sdk-container-build"
  | "agents-sdk-local-build";
type RequestedRuntimeMode =
  | "agents-sdk"
  | "agents-sdk-container-build"
  | "agents-sdk-local-build"
  | "raw-worker"
  | "raw-worker-module";

export interface GeneratedRuntimePublishResult {
  mode: RuntimeMode;
  scriptName: string;
  uploadedBy:
    | "workers-scripts-api"
    | "container-build-endpoint"
    | "local-wrangler-build";
  artifact?: {
    namespace: string;
    repo: string;
    remote: string;
    defaultBranch: string;
    tokenExpiresAt?: string;
  };
  build?: {
    endpoint?: string;
    status: "uploaded" | "accepted";
    details?: Record<string, unknown>;
  };
}

export interface GeneratedRuntimePublishInput {
  request: DeploymentRequest;
  deploymentId: string;
  accountId: string;
  sourceSha?: string;
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
  migrations?: Record<string, unknown>;
  assets?: {
    jwt: string;
    config?: Record<string, unknown>;
  };
  keep_bindings?: string[];
}

export interface WorkerAssetUpload {
  path: string;
  hash: string;
  size: number;
  base64: string;
  contentType: string;
}

export interface GeneratedRuntimeCloudflareClient {
  uploadWorkerModule(input: {
    scriptName: string;
    moduleName: string;
    moduleCode: string;
    metadata: WorkerUploadMetadata;
  }): Promise<void>;
  uploadWorkerAssets?(input: {
    scriptName: string;
    assets: WorkerAssetUpload[];
  }): Promise<{ jwt: string }>;
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
  const requestedMode = normalizeRequestedRuntimeMode(
    readEnvString(env, "OPEN_THINK_GENERATED_RUNTIME")
  );
  const buildEndpoint = readEnvString(env, "OPEN_THINK_RUNTIME_BUILD_ENDPOINT");

  if (
    buildEndpoint &&
    (requestedMode === "agents-sdk" || requestedMode === "agents-sdk-container-build")
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

  if (requestedMode === "agents-sdk-local-build") {
    return new LocalAgentsSdkBuildPublisher(client, { env });
  }

  if (requestedMode === "agents-sdk" && isNodeRuntime()) {
    return new LocalAgentsSdkBuildPublisher(client, { env });
  }

  if (requestedMode === "raw-worker" || requestedMode === "raw-worker-module") {
    return new RawWorkerModulePublisher(client);
  }

  if (requestedMode === "agents-sdk-container-build") {
    throw new Error(
      "OPEN_THINK_RUNTIME_BUILD_ENDPOINT is required when OPEN_THINK_GENERATED_RUNTIME=agents-sdk-container-build."
    );
  }

  if (requestedMode === "agents-sdk") {
    throw new Error(
      "The Agents SDK runtime needs either a local Node build toolchain or OPEN_THINK_RUNTIME_BUILD_ENDPOINT. Set OPEN_THINK_GENERATED_RUNTIME=raw-worker-module only when you intentionally want the raw Worker SSE fallback."
    );
  }

  return unreachableRuntimeMode(requestedMode);
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

export class LocalAgentsSdkBuildPublisher implements GeneratedRuntimePublisher {
  constructor(
    private readonly client: GeneratedRuntimeCloudflareClient,
    private readonly options: {
      env?: Record<string, unknown>;
    } = {}
  ) {}

  async publish(input: GeneratedRuntimePublishInput): Promise<GeneratedRuntimePublishResult> {
    if (!this.client.uploadWorkerAssets) {
      throw new Error("The Cloudflare client does not support Worker asset uploads.");
    }

    const node = await loadNodeBuildApis();
    const starterDir = await findStarterRuntimeDirectory(node, process.cwd());
    const buildDir = node.path.join(
      starterDir,
      ".open-think-runtime-builds",
      `${safePathSegment(input.deploymentId)}-${Date.now()}`
    );
    const clientOutDir = node.path.join(buildDir, "dist", "client");
    const workerOutDir = node.path.join(buildDir, "dist", "worker-bundle");

    try {
      const files = renderAgentsSdkPersonalAgentRuntime({
        request: input.request,
        deploymentId: input.deploymentId,
        bindings: input.bindings,
        ...(input.sourceSha ? { sourceSha: input.sourceSha } : {})
      });
      await writeRuntimeFiles(node, buildDir, files);

      await execFile(node, packageRunnerCommand(), [
        "--dir",
        starterDir,
        "exec",
        "vite",
        "build",
        buildDir,
        "--outDir",
        clientOutDir,
        "--emptyOutDir"
      ]);

      await execFile(node, packageRunnerCommand(), [
        "--dir",
        starterDir,
        "exec",
        "wrangler",
        "deploy",
        "--dry-run",
        "--outdir",
        workerOutDir,
        "--config",
        node.path.join(buildDir, "wrangler.jsonc")
      ]);

      const bundle = await readWorkerBundle(node, workerOutDir);
      const assets = await collectWorkerAssets(node, clientOutDir);
      const assetUpload = await this.client.uploadWorkerAssets({
        scriptName: input.scriptName,
        assets
      });
      const metadata = buildAgentsSdkWorkerUploadMetadata(
        input,
        bundle.moduleName,
        assetUpload.jwt
      );

      await this.client.uploadWorkerModule({
        scriptName: input.scriptName,
        moduleName: bundle.moduleName,
        moduleCode: bundle.moduleCode,
        metadata
      });

      return {
        mode: "agents-sdk-local-build",
        scriptName: input.scriptName,
        uploadedBy: "local-wrangler-build",
        build: {
          status: "uploaded",
          details: {
            assets: assets.length,
            moduleName: bundle.moduleName
          }
        }
      };
    } finally {
      if (
        readEnvString(this.options.env ?? process.env, "OPEN_THINK_KEEP_RUNTIME_BUILD_DIR") !==
        "true"
      ) {
        await node.fs.rm(buildDir, { force: true, recursive: true }).catch(() => undefined);
      }
    }
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
      bindings: input.bindings,
      ...(input.sourceSha ? { sourceSha: input.sourceSha } : {})
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
    if (input.sourceSha) {
      buildRequest.sourceSha = input.sourceSha;
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
  sourceSha?: string;
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

function normalizeRequestedRuntimeMode(value: string | undefined): RequestedRuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "agents-sdk") {
    return "agents-sdk";
  }
  if (normalized === "agents-sdk-container-build") return normalized;
  if (normalized === "agents-sdk-local-build") return normalized;
  if (normalized === "raw-worker" || normalized === "raw-worker-module") return normalized;
  throw new Error(
    `Unsupported OPEN_THINK_GENERATED_RUNTIME value "${value}". Use agents-sdk, agents-sdk-local-build, agents-sdk-container-build, or raw-worker-module.`
  );
}

function unreachableRuntimeMode(value: never): never {
  throw new Error(`Unsupported generated runtime mode: ${String(value)}`);
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

interface NodeBuildApis {
  childProcess: typeof import("node:child_process");
  crypto: typeof import("node:crypto");
  fs: typeof import("node:fs/promises");
  path: typeof import("node:path");
}

async function loadNodeBuildApis(): Promise<NodeBuildApis> {
  if (!isNodeRuntime()) {
    throw new Error("The local Agents SDK build publisher requires a Node.js runtime.");
  }
  const [childProcess, crypto, fs, path] = await Promise.all([
    import("node:child_process"),
    import("node:crypto"),
    import("node:fs/promises"),
    import("node:path")
  ]);
  return { childProcess, crypto, fs, path };
}

function isNodeRuntime(): boolean {
  return Boolean(
    typeof process !== "undefined" &&
      process.versions?.node &&
      typeof process.cwd === "function"
  );
}

async function findStarterRuntimeDirectory(
  node: NodeBuildApis,
  cwd: string
): Promise<string> {
  const candidates = [
    node.path.resolve(cwd, "starters", "personal-agent"),
    node.path.resolve(cwd, "..", "starters", "personal-agent"),
    node.path.resolve(cwd, "..", "..", "starters", "personal-agent"),
    node.path.resolve(cwd, "..", "..", "..", "starters", "personal-agent")
  ];

  for (const candidate of candidates) {
    try {
      await node.fs.access(node.path.join(candidate, "package.json"));
      await node.fs.access(node.path.join(candidate, "node_modules", "wrangler"));
      await node.fs.access(node.path.join(candidate, "node_modules", "vite"));
      return candidate;
    } catch {
      // Keep checking likely workspace roots.
    }
  }

  throw new Error(
    "Could not find starters/personal-agent with installed vite and wrangler dependencies. Run pnpm install or configure OPEN_THINK_RUNTIME_BUILD_ENDPOINT."
  );
}

async function writeRuntimeFiles(
  node: NodeBuildApis,
  buildDir: string,
  files: AgentsSdkRuntimeFile[]
): Promise<void> {
  await node.fs.mkdir(buildDir, { recursive: true });
  await Promise.all(
    files.map(async (file) => {
      const fullPath = node.path.join(buildDir, file.path);
      await node.fs.mkdir(node.path.dirname(fullPath), { recursive: true });
      await node.fs.writeFile(fullPath, file.contents, "utf8");
    })
  );
}

async function execFile(
  node: NodeBuildApis,
  command: string,
  args: string[]
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    node.childProcess.execFile(
      command,
      args,
      {
        maxBuffer: 1024 * 1024 * 16,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [stderr, stdout].filter(Boolean).join("\n").trim();
          reject(
            new Error(
              `${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : "."}`
            )
          );
          return;
        }
        resolve();
      }
    );
  });
}

function packageRunnerCommand(): string {
  return process.platform === "win32" ? "pnpm.exe" : "pnpm";
}

async function readWorkerBundle(
  node: NodeBuildApis,
  workerOutDir: string
): Promise<{ moduleName: string; moduleCode: string }> {
  const entries = await node.fs.readdir(workerOutDir);
  const moduleName = entries.find((entry) => entry.endsWith(".js") && !entry.endsWith(".map"));
  if (!moduleName) {
    throw new Error("Wrangler dry-run did not produce a Worker module bundle.");
  }
  return {
    moduleName,
    moduleCode: await node.fs.readFile(node.path.join(workerOutDir, moduleName), "utf8")
  };
}

async function collectWorkerAssets(
  node: NodeBuildApis,
  assetsDir: string
): Promise<WorkerAssetUpload[]> {
  const assets: WorkerAssetUpload[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await node.fs.readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = node.path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          return;
        }
        if (!entry.isFile()) return;

        const contents = await node.fs.readFile(fullPath);
        const relativePath = `/${node.path.relative(assetsDir, fullPath).replace(/\\/g, "/")}`;
        assets.push({
          path: relativePath,
          hash: node.crypto
            .createHash("sha256")
            .update(contents)
            .digest()
            .subarray(0, 16)
            .toString("hex"),
          size: contents.byteLength,
          base64: contents.toString("base64"),
          contentType: contentTypeForPath(relativePath)
        });
      })
    );
  }

  await visit(assetsDir);
  return assets;
}

function buildAgentsSdkWorkerUploadMetadata(
  input: GeneratedRuntimePublishInput,
  moduleName: string,
  assetsJwt: string
): WorkerUploadMetadata {
  const personalAgent = normalizePersonalAgentConfig(input.request.personalAgent);
  const sourceSha =
    input.sourceSha ??
    readEnvString(process.env, "OPEN_THINK_SOURCE_SHA") ??
    readEnvString(process.env, "GITHUB_SHA");
  const bindings: Array<Record<string, unknown>> = [
    { type: "ai", name: "AI" },
    {
      type: "durable_object_namespace",
      name: "PersonalChatAgent",
      class_name: "PersonalChatAgent"
    },
    { type: "d1", name: "DB", id: input.bindings.databaseId },
    {
      type: "r2_bucket",
      name: "AGENT_STORAGE",
      bucket_name: input.bindings.bucketName
    },
    { type: "queue", name: "TASK_QUEUE", queue_name: input.bindings.queueName },
    {
      type: "vectorize",
      name: "VECTORIZE",
      index_name: input.bindings.vectorizeName
    },
    { type: "assets", name: "ASSETS" },
    {
      type: "plain_text",
      name: "OPEN_THINK_DEPLOYMENT_ID",
      text: input.deploymentId
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_STARTER",
      text: input.request.starterTemplate
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_AGENT_NAME",
      text: input.request.agentName?.trim() || "Personal Agent"
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_DEFAULT_MODEL",
      text: input.request.defaultModel ?? "@cf/moonshotai/kimi-k2.6"
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_PERSONAL_AGENT_CONFIG",
      text: personalAgentPublicConfigBindingText(personalAgent)
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_TOOL_APPROVAL_POLICY",
      text: personalAgent.toolApprovalPolicy
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_CF_ACCOUNT_ID",
      text: input.request.cloudflareAccountId?.trim() || input.accountId
    }
  ];

  if (sourceSha) {
    bindings.push({
      type: "plain_text",
      name: "OPEN_THINK_SOURCE_SHA",
      text: sourceSha
    });
  }
  if (input.apiToken) {
    bindings.push({
      type: "secret_text",
      name: "OPEN_THINK_CF_API_TOKEN",
      text: input.apiToken
    });
  }
  if (input.request.providerKeys?.openRouterApiKey) {
    bindings.push({
      type: "secret_text",
      name: "OPENROUTER_API_KEY",
      text: input.request.providerKeys.openRouterApiKey
    });
  }
  if (input.request.providerKeys?.anthropicApiKey) {
    bindings.push({
      type: "secret_text",
      name: "ANTHROPIC_API_KEY",
      text: input.request.providerKeys.anthropicApiKey
    });
  }
  if (input.request.providerKeys?.openAiApiKey) {
    bindings.push({
      type: "secret_text",
      name: "OPENAI_API_KEY",
      text: input.request.providerKeys.openAiApiKey
    });
  }
  if (personalAgent.soulPrompt) {
    bindings.push({
      type: "secret_text",
      name: "OPEN_THINK_SOUL_PROMPT",
      text: personalAgent.soulPrompt
    });
  }
  if (personalAgent.launchBrief) {
    bindings.push({
      type: "secret_text",
      name: "OPEN_THINK_LAUNCH_BRIEF",
      text: personalAgent.launchBrief
    });
  }
  appendMissingNamedBindings(bindings, input.rawWorker.metadata.bindings);

  return {
    main_module: moduleName,
    compatibility_date: "2026-05-01",
    compatibility_flags: ["nodejs_compat"],
    bindings,
    migrations: {
      new_tag: `${safePathSegment(input.deploymentId)}-agents-sdk-v1`,
      new_sqlite_classes: ["PersonalChatAgent"]
    },
    assets: {
      jwt: assetsJwt
    },
    keep_bindings: ["secret_text", "secret_key"]
  };
}

function appendMissingNamedBindings(
  target: Array<Record<string, unknown>>,
  source: Array<Record<string, unknown>>
): void {
  const seen = new Set(
    target
      .map((binding) => (typeof binding.name === "string" ? binding.name : undefined))
      .filter((name): name is string => Boolean(name))
  );
  for (const binding of source) {
    const name = typeof binding.name === "string" ? binding.name : undefined;
    if (!name || seen.has(name)) continue;
    target.push(binding);
    seen.add(name);
  }
}

function contentTypeForPath(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json")) return "application/json; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function safePathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "runtime"
  );
}
