import type { DeploymentRequest } from "./deployment-engine";
import { openThinkTokenPermissions } from "./cloudflare-token-url";
import { readEnvString } from "./platform-env";

export type DeploymentMode = "cloudflare-api";
export type ProvisionerKind = "cloudflare-api" | "user-supplied" | "unconfigured";
export type RepositoryKind = "memory" | "d1" | "d1-rest";
export type AuthKind = "dev-auto" | "cloudflare-access-or-jwt";
export type AiProviderKind = "workers-ai" | "ai-gateway" | "unconfigured";
export type SyncSourceKind = "local-dev" | "cloudflare-artifacts";

export interface AutomationSnapshot {
  deploymentMode: DeploymentMode;
  provisioner: ProvisionerKind;
  repository: RepositoryKind;
  auth: AuthKind;
  aiProvider: AiProviderKind;
  syncSource: SyncSourceKind;
  autoSyncEnabled: boolean;
  platformHost: string;
  missing: string[];
  warnings: string[];
  requiredTokenPermissions: TokenPermission[];
}

export interface TokenPermission {
  scope: "Account" | "Zone";
  permission: string;
  reason: string;
  required: boolean;
}

export class EnvironmentValidationError extends Error {
  constructor(
    message: string,
    readonly missing: string[],
    readonly warnings: string[] = []
  ) {
    super(message);
    this.name = "EnvironmentValidationError";
  }
}

export const cloudflareTokenPermissions: TokenPermission[] = [
  {
    scope: "Account",
    permission: "Workers Scripts Edit / Write",
    reason: "Upload and update the Worker control plane bundle.",
    required: true
  },
  {
    scope: "Account",
    permission: "Artifacts Edit / Write",
    reason: "Create optional per-agent Git workspaces and mint repo-scoped Artifacts tokens.",
    required: false
  },
  {
    scope: "Account",
    permission: "Containers Edit / Write",
    reason: "Create and update Container-backed agent runtimes.",
    required: false
  },
  {
    scope: "Account",
    permission: "D1 Edit / Write",
    reason: "Create deployment metadata databases and apply migrations.",
    required: true
  },
  {
    scope: "Account",
    permission: "Workers R2 Storage Edit / Write",
    reason: "Create artifact and snapshot buckets.",
    required: true
  },
  {
    scope: "Account",
    permission: "Queues Edit / Write",
    reason: "Create task queues for deployment and agent work.",
    required: true
  },
  {
    scope: "Account",
    permission: "Vectorize Edit / Write",
    reason: "Create semantic memory indexes.",
    required: true
  },
  {
    scope: "Account",
    permission: "Workers AI Read or Edit / Write",
    reason: "Run default Workers AI models when no AI Gateway is configured.",
    required: false
  },
  {
    scope: "Account",
    permission: "AI Gateway Read/Edit/Run",
    reason: "Route external model providers through AI Gateway.",
    required: false
  },
  {
    scope: "Zone",
    permission: "Workers Routes Edit / Write",
    reason: "Attach deployed agents to zone routes when custom hostnames are enabled.",
    required: false
  },
  {
    scope: "Account",
    permission: "Access Apps and Policies Edit / Write",
    reason: "Create the Cloudflare Access application and allow policy that protect the deployed Worker.",
    required: true
  }
];

export { openThinkTokenPermissions };

export function automationSnapshotForRequest(
  request?: Partial<DeploymentRequest>,
  options: {
    repository?: RepositoryKind;
    workersAIAvailable?: boolean;
    env?: Record<string, unknown>;
  } = {}
): AutomationSnapshot {
  const env = options.env ?? process.env;
  const deploymentMode = deploymentModeFromEnv(env);
  const hasDeploymentRequest = Boolean(request?.flow);
  const userOwnedFlow =
    !hasDeploymentRequest ||
    request?.flow === "self" ||
    request?.flow === "agent" ||
    request?.flow === "button";
  const accountId = userOwnedFlow
    ? request?.cloudflareAccountId
    : request?.partnerAccountId ?? readEnvString(env, "CLOUDFLARE_ACCOUNT_ID");
  const apiToken = userOwnedFlow
    ? request?.cfApiToken
    : request?.cfApiToken ?? readEnvString(env, "CLOUDFLARE_API_TOKEN");
  const missing: string[] = [];
  const warnings: string[] = [];
  const syncSource: SyncSourceKind = readEnvString(env, "ARTIFACTS_REMOTE")
    ? "cloudflare-artifacts"
    : "local-dev";
  const repository = options.repository ?? "memory";

  if (hasDeploymentRequest && !accountId) {
    missing.push(userOwnedFlow ? "cloudflareAccountId" : "CLOUDFLARE_ACCOUNT_ID or partnerAccountId");
  }

  if (hasDeploymentRequest && !apiToken) {
    missing.push(userOwnedFlow ? "cfApiToken" : "CLOUDFLARE_API_TOKEN or request cfApiToken");
  }

  if (repository !== "d1" && repository !== "d1-rest") {
    if (requiresPersistentRepository(env)) {
      missing.push("DB binding or OPEN_THINK_PLATFORM_D1_DATABASE_ID");
    } else {
      warnings.push(
        "Using in-memory deployment state for local development. Run provision:cf to persist launches in platform D1."
      );
    }
  }

  if (
    !options.workersAIAvailable &&
    !(readEnvString(env, "AI_GATEWAY_ENDPOINT") && readEnvString(env, "AI_GATEWAY_API_KEY"))
  ) {
    warnings.push("Chat surfaces need AI binding or AI_GATEWAY_ENDPOINT + AI_GATEWAY_API_KEY.");
  }

  if (syncSource === "cloudflare-artifacts" && !readEnvString(env, "ARTIFACTS_TOKEN")) {
    missing.push("ARTIFACTS_TOKEN");
  }

  const configuredDeploymentMode = readEnvString(env, "DEPLOYMENT_MODE");
  if (configuredDeploymentMode && configuredDeploymentMode !== "cloudflare-api") {
    warnings.push(
      "DEPLOYMENT_MODE is ignored unless set to cloudflare-api; live Cloudflare API mode is required."
    );
  }

  return {
    deploymentMode,
    provisioner: accountId && apiToken ? "cloudflare-api" : hasDeploymentRequest ? "unconfigured" : "user-supplied",
    repository,
    auth:
      readEnvString(env, "OPEN_THINK_DEV_AUTO_AUTH") === "false"
        ? "cloudflare-access-or-jwt"
        : "dev-auto",
    aiProvider: aiProviderFromEnv(options.workersAIAvailable, env),
    syncSource,
    autoSyncEnabled: readEnvString(env, "OPEN_THINK_AUTO_SYNC") === "true",
    platformHost: readEnvString(env, "NEXT_PUBLIC_PLATFORM_HOST") ?? "beta2.open-think.app",
    missing,
    warnings,
    requiredTokenPermissions: cloudflareTokenPermissions
  };
}

function requiresPersistentRepository(env: Record<string, unknown>): boolean {
  if (readEnvString(env, "OPEN_THINK_ALLOW_MEMORY_REPOSITORY") === "true") {
    return false;
  }

  if (readEnvString(env, "OPEN_THINK_REQUIRE_PERSISTENT_REPOSITORY") === "true") {
    return true;
  }

  return process.env.NODE_ENV === "production" || readEnvString(env, "NODE_ENV") === "production";
}

export function assertAutomationEnvironment(snapshot: AutomationSnapshot): void {
  if (snapshot.missing.length === 0) {
    return;
  }

  throw new EnvironmentValidationError(
    `Cloudflare API deployment mode is enabled, but ${snapshot.missing.join(", ")} is missing.`,
    snapshot.missing,
    snapshot.warnings
  );
}

export function deploymentModeFromEnv(
  _env: Record<string, unknown> = process.env
): DeploymentMode {
  return "cloudflare-api";
}

function aiProviderFromEnv(
  workersAIAvailable = false,
  env: Record<string, unknown> = process.env
): AiProviderKind {
  if (workersAIAvailable) return "workers-ai";
  if (readEnvString(env, "AI_GATEWAY_ENDPOINT") && readEnvString(env, "AI_GATEWAY_API_KEY")) {
    return "ai-gateway";
  }
  return "unconfigured";
}
