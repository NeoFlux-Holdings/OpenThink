import type { AutoSyncConfig, SyncAction, SyncResult, SyncStatus } from "@open-think/sync";
import { renderAgentWorkerModule } from "./agent-worker-template";
import { CloudflareApiClient } from "./cloudflare-api";
import type { DeploymentRecord, DeploymentRepository } from "./d1";
import type { DeploymentRequest } from "./deployment-engine";
import { readEnvString } from "./platform-env";

export type DeploymentUpdateAction = Extract<SyncAction, "pull" | "deploy" | "reconcile"> | "status";

export type DeploymentUpdateCredentialSource =
  | "request-token"
  | "deployment-update-token"
  | "platform-token"
  | "missing";

export interface DeploymentUpdateTarget {
  deploymentId: string;
  accountId: string;
  scriptName: string;
  agentUrl: string;
  workerUrl?: string;
}

export interface DeploymentUpdateMetadata {
  target: DeploymentUpdateTarget;
  autoUpdate: AutoSyncConfig;
  lastAction?: DeploymentUpdateAction | undefined;
  lastMessage?: string | undefined;
  lastError?: string | undefined;
  lastCommitSha?: string | undefined;
  lastDeployedSha?: string | undefined;
  lastSyncAt?: string | undefined;
  lastDeployAt?: string | undefined;
  remoteUrl?: string | undefined;
  branch?: string | undefined;
  credentialSource?: Exclude<DeploymentUpdateCredentialSource, "request-token"> | undefined;
  updatedAt: string;
}

export interface DeploymentUpdateSummary {
  deploymentId: string;
  agentName: string;
  agentUrl: string;
  status: DeploymentRecord["status"];
  target?: DeploymentUpdateTarget;
  metadata?: DeploymentUpdateMetadata;
  canUpdateWithoutToken: boolean;
  credentialSource: DeploymentUpdateCredentialSource;
  tokenFingerprint?: string;
  warnings: string[];
}

export interface DeploymentUpdateExecution {
  summary: DeploymentUpdateSummary;
  status: SyncStatus;
  result?: SyncResult;
  resourcePlan: Record<string, unknown>;
}

export class DeploymentUpdateError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "DeploymentUpdateError";
  }
}

const defaultAutoUpdate: AutoSyncConfig = {
  enabled: false,
  direction: "bidirectional",
  intervalSeconds: 300
};

export function summarizeDeploymentUpdate(
  deployment: DeploymentRecord,
  env: Record<string, unknown> = process.env
): DeploymentUpdateSummary {
  const target = readDeploymentUpdateTarget(deployment);
  const metadata = readDeploymentUpdateMetadata(deployment.resourcePlan);
  const credential = resolveDeploymentUpdateCredential(env);
  const warnings: string[] = [];

  if (!target) {
    warnings.push("This deployment does not have enough resource-plan metadata to target a Worker update.");
  }

  if (!credential.apiToken && deployment.authorization?.tokenFingerprint) {
    warnings.push("The original Cloudflare token is fingerprinted only; paste a token or configure OPEN_THINK_DEPLOYMENT_UPDATE_API_TOKEN.");
  }

  const summary: DeploymentUpdateSummary = {
    deploymentId: deployment.id,
    agentName: deployment.authorization?.agentName ?? deployment.id,
    agentUrl: deployment.agentUrl,
    status: deployment.status,
    canUpdateWithoutToken: Boolean(credential.apiToken),
    credentialSource: credential.source,
    warnings
  };

  if (target) summary.target = target;
  if (metadata) summary.metadata = metadata;
  if (deployment.authorization?.tokenFingerprint) {
    summary.tokenFingerprint = deployment.authorization.tokenFingerprint;
  }

  return summary;
}

export async function runDeploymentUpdate(input: {
  deployment: DeploymentRecord;
  action: DeploymentUpdateAction;
  env?: Record<string, unknown>;
  cfApiToken?: string;
  autoUpdate?: Partial<AutoSyncConfig>;
}): Promise<DeploymentUpdateExecution> {
  const env = input.env ?? process.env;
  const target = readDeploymentUpdateTarget(input.deployment);

  if (!target) {
    throw new DeploymentUpdateError(
      "Deployment update requires stored accountId and scriptName metadata."
    );
  }

  const existingMetadata = readDeploymentUpdateMetadata(input.deployment.resourcePlan);
  const autoUpdate = normalizeAutoUpdate(input.autoUpdate, existingMetadata?.autoUpdate);
  const credential = resolveDeploymentUpdateCredential(env, input.cfApiToken);
  const updateEnv = buildDeploymentSyncEnv(
    env,
    input.deployment,
    target,
    credential.apiToken,
    credential.source,
    autoUpdate
  );
  const github = await resolveGithubUpdateState(updateEnv, existingMetadata);
  const statusBeforeAction = githubSyncStatus({
    github,
    autoUpdate,
    metadata: existingMetadata
  });
  const result = await runGithubUpdateAction({
    deployment: input.deployment,
    target,
    action: input.action,
    credential,
    env: updateEnv,
    autoUpdate,
    github,
    status: statusBeforeAction
  });
  const status = result?.status ?? statusBeforeAction;
  const metadataInput: Parameters<typeof buildDeploymentUpdateMetadata>[0] = {
    target,
    autoUpdate,
    action: input.action,
    status,
    env: updateEnv,
    credentialSource: credential.source
  };
  if (result) metadataInput.result = result;
  const metadata = buildDeploymentUpdateMetadata(metadataInput);
  const resourcePlan = withDeploymentUpdateMetadata(
    input.deployment.resourcePlan,
    metadata
  );

  return {
    summary: summarizeDeploymentUpdate(
      {
        ...input.deployment,
        resourcePlan
      },
      updateEnv
    ),
    status,
    ...(result ? { result } : {}),
    resourcePlan
  };
}

export async function runAutomaticDeploymentUpdatesFromEnv(
  repository: DeploymentRepository,
  env: Record<string, unknown> = process.env,
  limit = 100
): Promise<void> {
  const deployments = await repository.list(limit);

  await Promise.all(
    deployments.map(async (deployment) => {
      const metadata = readDeploymentUpdateMetadata(deployment.resourcePlan);
      if (!metadata?.autoUpdate.enabled) return;

      try {
        const result = await runDeploymentUpdate({
          deployment,
          action: "reconcile",
          env,
          autoUpdate: metadata.autoUpdate
        });
        await repository.updateStatus(
          deployment.id,
          deployment.status,
          result.resourcePlan
        );
      } catch (error) {
        const target = readDeploymentUpdateTarget(deployment);
        if (!target) return;
        await repository.updateStatus(
          deployment.id,
          deployment.status,
          withDeploymentUpdateMetadata(
            deployment.resourcePlan,
            buildDeploymentUpdateMetadata({
              target,
              autoUpdate: metadata.autoUpdate,
              action: "reconcile",
              env,
              error: error instanceof Error ? error.message : "Automatic deployment update failed."
            })
          )
        );
      }
    })
  );
}

interface GithubUpdateState {
  repository: string;
  branch: string;
  remoteUrl: string;
  remoteHead?: string;
  checkedAt: string;
  warning?: string;
}

async function resolveGithubUpdateState(
  env: Record<string, unknown>,
  metadata?: DeploymentUpdateMetadata
): Promise<GithubUpdateState> {
  const repository =
    readEnvString(env, "OPEN_THINK_UPDATE_REPOSITORY") ?? "NeoFlux-Holdings/OpenThink";
  const branch = readEnvString(env, "OPEN_THINK_UPDATE_BRANCH") ?? metadata?.branch ?? "main";
  const remoteUrl = `https://github.com/${repository}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "open-think-platform-update"
  };
  const githubToken = readEnvString(env, "OPEN_THINK_GITHUB_TOKEN");
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(branch)}`,
      { headers }
    );
    const body = (await response.json().catch(() => null)) as
      | { sha?: string; message?: string }
      | null;
    if (!response.ok || !body?.sha) {
      return {
        repository,
        branch,
        remoteUrl,
        checkedAt: new Date().toISOString(),
        warning: body?.message ?? `GitHub returned ${response.status} for ${repository}@${branch}.`
      };
    }

    return {
      repository,
      branch,
      remoteUrl,
      remoteHead: body.sha,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      repository,
      branch,
      remoteUrl,
      checkedAt: new Date().toISOString(),
      warning: error instanceof Error ? error.message : "GitHub remote check failed."
    };
  }
}

function githubSyncStatus(input: {
  github: GithubUpdateState;
  autoUpdate: AutoSyncConfig;
  metadata?: DeploymentUpdateMetadata | undefined;
  deployedHead?: string | undefined;
  lastSyncAt?: string | undefined;
  lastDeployAt?: string | undefined;
}): SyncStatus {
  const deployedHead =
    input.deployedHead ?? input.metadata?.lastDeployedSha ?? input.metadata?.lastCommitSha;
  const warnings = input.github.warning ? [input.github.warning] : [];
  const status: SyncStatus = {
    sourceOfTruth: "github-upstream",
    branch: input.github.branch,
    remoteUrl: input.github.remoteUrl,
    dirtyFiles: [],
    drift:
      input.github.remoteHead && deployedHead
        ? input.github.remoteHead === deployedHead
          ? "clean"
          : "remote-ahead"
        : "unknown",
    autoSync: input.autoUpdate,
    missing: [],
    warnings
  };

  if (input.github.remoteHead) status.remoteHead = input.github.remoteHead;
  if (deployedHead) status.deployedHead = deployedHead;
  const lastSyncAt = input.lastSyncAt ?? input.metadata?.lastSyncAt;
  if (lastSyncAt) status.lastSyncAt = lastSyncAt;
  const lastDeployAt = input.lastDeployAt ?? input.metadata?.lastDeployAt;
  if (lastDeployAt) status.lastDeployAt = lastDeployAt;

  return status;
}

async function runGithubUpdateAction(input: {
  deployment: DeploymentRecord;
  target: DeploymentUpdateTarget;
  action: DeploymentUpdateAction;
  credential: { source: DeploymentUpdateCredentialSource; apiToken?: string };
  env: Record<string, unknown>;
  autoUpdate: AutoSyncConfig;
  github: GithubUpdateState;
  status: SyncStatus;
}): Promise<SyncResult | undefined> {
  if (input.action === "status") return undefined;

  if (input.action === "pull") {
    const lastSyncAt = new Date().toISOString();
    return {
      action: "pull",
      status: githubSyncStatus({
        github: input.github,
        autoUpdate: input.autoUpdate,
        lastSyncAt
      }),
      message: input.github.remoteHead
        ? `Checked GitHub upstream ${input.github.repository}@${input.github.branch} (${shortSha(input.github.remoteHead)}).`
        : `Checked GitHub upstream ${input.github.repository}@${input.github.branch}; ${input.github.warning ?? "remote SHA was unavailable."}`,
      ...(input.github.remoteHead ? { commitSha: input.github.remoteHead } : {})
    };
  }

  if (input.action === "reconcile" && input.github.remoteHead && input.status.deployedHead === input.github.remoteHead) {
    return {
      action: "reconcile",
      status: input.status,
      message: `GitHub upstream ${input.github.repository}@${input.github.branch} already matches this deployment (${shortSha(input.github.remoteHead)}).`,
      deployedSha: input.github.remoteHead
    };
  }

  const deployedSha = await uploadGeneratedWorkerFromGithub(input);
  const lastDeployAt = new Date().toISOString();
  return {
    action: input.action === "deploy" ? "deploy" : "reconcile",
    status: githubSyncStatus({
      github: input.github,
      autoUpdate: input.autoUpdate,
      deployedHead: deployedSha,
      lastSyncAt: lastDeployAt,
      lastDeployAt
    }),
    message: `Uploaded ${input.target.scriptName} from current OpenThink runtime with GitHub upstream ${input.github.repository}@${input.github.branch}${deployedSha ? ` (${shortSha(deployedSha)})` : ""}.`,
    ...(input.github.remoteHead ? { commitSha: input.github.remoteHead } : {}),
    ...(deployedSha ? { deployedSha } : {})
  };
}

async function uploadGeneratedWorkerFromGithub(input: {
  deployment: DeploymentRecord;
  target: DeploymentUpdateTarget;
  credential: { source: DeploymentUpdateCredentialSource; apiToken?: string };
  env: Record<string, unknown>;
  github: GithubUpdateState;
}): Promise<string | undefined> {
  if (!input.credential.apiToken) {
    throw new DeploymentUpdateError(
      "Updating a deployed Worker requires a Cloudflare API token. Paste a token or configure OPEN_THINK_DEPLOYMENT_UPDATE_API_TOKEN.",
      401
    );
  }

  const client = new CloudflareApiClient({
    accountId: input.target.accountId,
    apiToken: input.credential.apiToken
  });
  const sourceSha = input.github.remoteHead ?? readEnvString(input.env, "OPEN_THINK_SOURCE_SHA");
  await client.uploadWorkerModule({
    scriptName: input.target.scriptName,
    moduleName: "worker.js",
    moduleCode: renderAgentWorkerModule({
      request: deploymentRequestFromRecord(input.deployment, input.target, input.env),
      deploymentId: input.deployment.id,
      scriptName: input.target.scriptName
    }),
    metadata: buildWorkerUploadMetadata(
      input.deployment,
      input.target,
      input.env,
      input.credential.source === "request-token" ? input.credential.apiToken : undefined,
      sourceSha
    )
  });

  return sourceSha;
}

function deploymentRequestFromRecord(
  deployment: DeploymentRecord,
  target: DeploymentUpdateTarget,
  env: Record<string, unknown>
): DeploymentRequest {
  const runtime = readRuntimeConfig(deployment.resourcePlan, env);
  const request: DeploymentRequest = {
    flow: deployment.flow,
    starterTemplate: deployment.starterTemplate,
    userId: deployment.userId,
    agentName: deployment.authorization?.agentName ?? deployment.id,
    cloudflareAccountId: target.accountId,
    spendLimitUsd: deployment.authorization?.spendLimitUsd ?? 100,
    defaultModel: runtime.defaultModel,
    modelProvider: runtime.modelProvider,
    thinkingLevel: runtime.thinkingLevel
  };
  return request;
}

function readDeploymentUpdateTarget(
  deployment: DeploymentRecord
): DeploymentUpdateTarget | undefined {
  const resourcePlan = deployment.resourcePlan;
  const workerDeployment = readRecord(resourcePlan.workerDeployment);
  const accountId =
    readString(resourcePlan.accountId) ?? deployment.authorization?.accountId;
  const scriptName =
    readString(workerDeployment?.scriptName) ?? readString(resourcePlan.scriptName);

  if (!accountId || !scriptName) return undefined;

  const target: DeploymentUpdateTarget = {
    deploymentId: deployment.id,
    accountId,
    scriptName,
    agentUrl: deployment.agentUrl
  };
  const workerUrl = readString(workerDeployment?.url);
  if (workerUrl) target.workerUrl = workerUrl;

  return target;
}

function readDeploymentUpdateMetadata(
  resourcePlan: Record<string, unknown>
): DeploymentUpdateMetadata | undefined {
  const value = readRecord(resourcePlan.openThinkUpdate);
  if (!value) return undefined;

  const target = readRecord(value.target);
  const autoUpdate = readRecord(value.autoUpdate);
  const deploymentId = readString(target?.deploymentId);
  const accountId = readString(target?.accountId);
  const scriptName = readString(target?.scriptName);
  const agentUrl = readString(target?.agentUrl);
  const updatedAt = readString(value.updatedAt);

  if (!deploymentId || !accountId || !scriptName || !agentUrl || !updatedAt) {
    return undefined;
  }

  const parsedTarget: DeploymentUpdateTarget = {
    deploymentId,
    accountId,
    scriptName,
    agentUrl
  };
  const workerUrl = readString(target?.workerUrl);
  if (workerUrl) parsedTarget.workerUrl = workerUrl;

  const metadata: DeploymentUpdateMetadata = {
    target: parsedTarget,
    autoUpdate: normalizeAutoUpdate(autoUpdate),
    updatedAt
  };
  const lastAction = readString(value.lastAction);
  const lastMessage = readString(value.lastMessage);
  const lastError = readString(value.lastError);
  const lastCommitSha = readString(value.lastCommitSha);
  const lastDeployedSha = readString(value.lastDeployedSha);
  const lastSyncAt = readString(value.lastSyncAt);
  const lastDeployAt = readString(value.lastDeployAt);
  const remoteUrl = readString(value.remoteUrl);
  const branch = readString(value.branch);
  const credentialSource = readString(value.credentialSource);

  if (lastAction) metadata.lastAction = lastAction as DeploymentUpdateAction;
  if (lastMessage) metadata.lastMessage = lastMessage;
  if (lastError) metadata.lastError = lastError;
  if (lastCommitSha) metadata.lastCommitSha = lastCommitSha;
  if (lastDeployedSha) metadata.lastDeployedSha = lastDeployedSha;
  if (lastSyncAt) metadata.lastSyncAt = lastSyncAt;
  if (lastDeployAt) metadata.lastDeployAt = lastDeployAt;
  if (remoteUrl) metadata.remoteUrl = remoteUrl;
  if (branch) metadata.branch = branch;
  if (credentialSource) {
    metadata.credentialSource = credentialSource as Exclude<
      DeploymentUpdateCredentialSource,
      "request-token"
    >;
  }

  return metadata;
}

function withDeploymentUpdateMetadata(
  resourcePlan: Record<string, unknown>,
  metadata: DeploymentUpdateMetadata
): Record<string, unknown> {
  return {
    ...resourcePlan,
    openThinkUpdate: metadata
  };
}

function buildDeploymentUpdateMetadata(input: {
  target: DeploymentUpdateTarget;
  autoUpdate: AutoSyncConfig;
  action: DeploymentUpdateAction;
  env: Record<string, unknown>;
  status?: SyncStatus;
  result?: SyncResult;
  error?: string;
  credentialSource?: DeploymentUpdateCredentialSource;
}): DeploymentUpdateMetadata {
  const metadata: DeploymentUpdateMetadata = {
    target: input.target,
    autoUpdate: input.autoUpdate,
    lastAction: input.action,
    updatedAt: new Date().toISOString()
  };
  const updateRepository =
    readEnvString(input.env, "OPEN_THINK_UPDATE_REPOSITORY") ?? "NeoFlux-Holdings/OpenThink";
  const remoteUrl = input.status?.remoteUrl ?? `https://github.com/${updateRepository}`;
  const branch = input.status?.branch ?? readEnvString(input.env, "OPEN_THINK_UPDATE_BRANCH");

  if (input.result?.message) metadata.lastMessage = input.result.message;
  if (input.error) metadata.lastError = input.error;
  if (input.result?.commitSha) metadata.lastCommitSha = input.result.commitSha;
  if (input.result?.deployedSha) metadata.lastDeployedSha = input.result.deployedSha;
  if (input.status?.lastSyncAt) metadata.lastSyncAt = input.status.lastSyncAt;
  if (input.status?.lastDeployAt) metadata.lastDeployAt = input.status.lastDeployAt;
  if (remoteUrl) metadata.remoteUrl = remoteUrl;
  if (branch) metadata.branch = branch;
  if (
    input.credentialSource &&
    input.credentialSource !== "request-token" &&
    input.credentialSource !== "missing"
  ) {
    metadata.credentialSource = input.credentialSource;
  }

  return metadata;
}

function buildDeploymentSyncEnv(
  env: Record<string, unknown>,
  deployment: DeploymentRecord,
  target: DeploymentUpdateTarget,
  apiToken: string | undefined,
  credentialSource: DeploymentUpdateCredentialSource,
  autoUpdate: AutoSyncConfig
): Record<string, unknown> {
  return {
    ...env,
    CLOUDFLARE_ACCOUNT_ID: target.accountId,
    ...(apiToken ? { CLOUDFLARE_API_TOKEN: apiToken } : {}),
    OPEN_THINK_SCRIPT_NAME: target.scriptName,
    OPEN_THINK_WORKER_UPLOAD_METADATA: JSON.stringify(
      buildWorkerUploadMetadata(
        deployment,
        target,
        env,
        credentialSource === "request-token" ? apiToken : undefined
      )
    ),
    OPEN_THINK_AUTO_SYNC: String(autoUpdate.enabled),
    OPEN_THINK_SYNC_DIRECTION: autoUpdate.direction,
    OPEN_THINK_AUTO_SYNC_INTERVAL_SECONDS: String(autoUpdate.intervalSeconds)
  };
}

function buildWorkerUploadMetadata(
  deployment: DeploymentRecord,
  target: DeploymentUpdateTarget,
  env: Record<string, unknown>,
  agentCloudflareApiToken?: string,
  sourceSha?: string
): {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  bindings: Array<Record<string, unknown>>;
  keep_bindings: string[];
} {
  const resourcePlan = deployment.resourcePlan;
  const wrangler = readRecord(resourcePlan.wrangler);
  const d1Database = readRecord(resourcePlan.d1Database);
  const r2Bucket = readRecord(resourcePlan.r2Bucket);
  const queue = readRecord(resourcePlan.queue);
  const vectorizeIndex = readRecord(resourcePlan.vectorizeIndex);
  const runtime = readRuntimeConfig(resourcePlan, env);
  const updateRepository =
    readEnvString(env, "OPEN_THINK_UPDATE_REPOSITORY") ?? "NeoFlux-Holdings/OpenThink";
  const updateBranch = readEnvString(env, "OPEN_THINK_UPDATE_BRANCH") ?? "main";
  const updateBundlePath = readEnvString(env, "OPEN_THINK_UPDATE_BUNDLE_PATH") ?? "dist/worker.js";
  const compatibilityFlags = Array.isArray(wrangler?.compatibility_flags)
    ? wrangler.compatibility_flags.filter((flag): flag is string => typeof flag === "string")
    : ["nodejs_compat", "global_fetch_strictly_public"];
  const bindings: Array<Record<string, unknown>> = [
    { type: "ai", name: "AI" },
    {
      type: "plain_text",
      name: "OPEN_THINK_DEPLOYMENT_ID",
      text: deployment.id
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_STARTER",
      text: deployment.starterTemplate
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_AGENT_NAME",
      text: deployment.authorization?.agentName ?? deployment.id
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_SPEND_LIMIT_USD",
      text: String(deployment.authorization?.spendLimitUsd ?? 100)
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_DEFAULT_MODEL",
      text: runtime.defaultModel
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_MODEL_PROVIDER",
      text: runtime.modelProvider
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_THINKING_LEVEL",
      text: runtime.thinkingLevel
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_SCRIPT_NAME",
      text: target.scriptName
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_CF_ACCOUNT_ID",
      text: target.accountId
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_UPDATE_REPOSITORY",
      text: updateRepository
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_UPDATE_BRANCH",
      text: updateBranch
    },
    {
      type: "plain_text",
      name: "OPEN_THINK_UPDATE_BUNDLE_PATH",
      text: updateBundlePath
    }
  ];
  const databaseId = readString(d1Database?.id);
  const bucketName = readString(r2Bucket?.name);
  const queueName = readString(queue?.name);
  const vectorizeName = readString(vectorizeIndex?.name);

  if (databaseId) {
    bindings.splice(1, 0, { type: "d1", name: "DB", id: databaseId });
  }
  if (bucketName) {
    bindings.splice(2, 0, { type: "r2_bucket", name: "AGENT_STORAGE", bucket_name: bucketName });
  }
  if (queueName) {
    bindings.splice(3, 0, { type: "queue", name: "TASK_QUEUE", queue_name: queueName });
  }
  if (vectorizeName) {
    bindings.splice(4, 0, { type: "vectorize", name: "VECTORIZE", index_name: vectorizeName });
  }
  if (agentCloudflareApiToken) {
    bindings.push({
      type: "secret_text",
      name: "OPEN_THINK_CF_API_TOKEN",
      text: agentCloudflareApiToken
    });
  }
  if (sourceSha) {
    bindings.push({
      type: "plain_text",
      name: "OPEN_THINK_SOURCE_SHA",
      text: sourceSha
    });
  }

  return {
    main_module: "worker.js",
    compatibility_date: readString(wrangler?.compatibility_date) ?? "2026-05-01",
    compatibility_flags: compatibilityFlags,
    bindings,
    keep_bindings: ["secret_text", "secret_key"]
  };
}

function resolveDeploymentUpdateCredential(
  env: Record<string, unknown>,
  requestToken?: string
): { source: DeploymentUpdateCredentialSource; apiToken?: string } {
  const trimmedRequestToken = requestToken?.trim();
  if (trimmedRequestToken) {
    return { source: "request-token", apiToken: trimmedRequestToken };
  }

  const updateToken = readEnvString(env, "OPEN_THINK_DEPLOYMENT_UPDATE_API_TOKEN");
  if (updateToken) {
    return { source: "deployment-update-token", apiToken: updateToken };
  }

  const platformToken = readEnvString(env, "CLOUDFLARE_API_TOKEN");
  if (platformToken) {
    return { source: "platform-token", apiToken: platformToken };
  }

  return { source: "missing" };
}

function normalizeAutoUpdate(
  input?: Partial<AutoSyncConfig> | Record<string, unknown>,
  fallback: AutoSyncConfig = defaultAutoUpdate
): AutoSyncConfig {
  const direction = readString(input?.direction);
  const interval =
    typeof input?.intervalSeconds === "number"
      ? input.intervalSeconds
      : Number(readString(input?.intervalSeconds));

  return {
    enabled:
      typeof input?.enabled === "boolean" ? input.enabled : fallback.enabled,
    direction:
      direction === "pull-from-remote" ||
      direction === "push-to-remote" ||
      direction === "bidirectional"
        ? direction
        : fallback.direction,
    intervalSeconds:
      Number.isFinite(interval) && interval >= 60 ? interval : fallback.intervalSeconds
  };
}

function readRuntimeConfig(
  resourcePlan: Record<string, unknown>,
  env: Record<string, unknown>
): {
  defaultModel: string;
  modelProvider: "workers-ai" | "openrouter" | "anthropic" | "openai";
  thinkingLevel: "low" | "medium" | "high" | "xhigh";
} {
  const runtime = readRecord(resourcePlan.openThinkRuntime);
  const defaultModel =
    readEnvString(env, "OPEN_THINK_DEFAULT_MODEL") ??
    readString(runtime?.defaultModel) ??
    "@cf/moonshotai/kimi-k2.6";
  const provider =
    readEnvString(env, "OPEN_THINK_MODEL_PROVIDER") ??
    readString(runtime?.modelProvider) ??
    inferModelProvider(defaultModel);
  const thinkingLevel =
    readEnvString(env, "OPEN_THINK_THINKING_LEVEL") ??
    readString(runtime?.thinkingLevel) ??
    "medium";

  return {
    defaultModel,
    modelProvider: normalizeModelProvider(provider),
    thinkingLevel: normalizeThinkingLevel(thinkingLevel)
  };
}

function normalizeModelProvider(
  value: string
): "workers-ai" | "openrouter" | "anthropic" | "openai" {
  if (
    value === "workers-ai" ||
    value === "openrouter" ||
    value === "anthropic" ||
    value === "openai"
  ) {
    return value;
  }
  return "workers-ai";
}

function inferModelProvider(model: string): "workers-ai" | "openrouter" | "anthropic" | "openai" {
  if (model.startsWith("openrouter/")) return "openrouter";
  if (model.startsWith("anthropic/")) return "anthropic";
  if (model.startsWith("openai/")) return "openai";
  return "workers-ai";
}

function normalizeThinkingLevel(value: string): "low" | "medium" | "high" | "xhigh" {
  if (value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "medium";
}

function shortSha(value: string): string {
  return value.slice(0, 8);
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
