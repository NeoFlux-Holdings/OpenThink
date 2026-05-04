import {
  ArtifactGitSyncService,
  MemoryRepoSyncService,
  syncConfigFromEnv,
  type AutoSyncConfig,
  type RepoSyncService,
  type SyncAction,
  type SyncResult,
  type SyncStatus
} from "@open-think/sync";

const globalSync = globalThis as typeof globalThis & {
  __openThinkSyncService?: RepoSyncService;
  __openThinkSyncKey?: string;
};

export function syncServiceFromEnv(
  env: Record<string, unknown> = process.env
): RepoSyncService {
  const stringEnv = normalizeEnv(env);
  const config = syncConfigFromEnv(stringEnv);
  const key = JSON.stringify({
    sourceOfTruth: config.sourceOfTruth,
    remoteUrl: config.remoteUrl,
    branch: config.branch,
    deployScriptName: config.deployScriptName,
    workerUploadMetadata: config.workerUploadMetadata,
    cloudflareAccountId: config.cloudflareAccountId,
    autoSync: config.autoSync
  });

  if (globalSync.__openThinkSyncService && globalSync.__openThinkSyncKey === key) {
    return globalSync.__openThinkSyncService;
  }

  globalSync.__openThinkSyncKey = key;
  globalSync.__openThinkSyncService =
    config.sourceOfTruth === "cloudflare-artifacts"
      ? new ArtifactGitSyncService(config)
      : new MemoryRepoSyncService(config);

  return globalSync.__openThinkSyncService;
}

export async function runSyncAction(
  action: SyncAction,
  options: { message?: string; env?: Record<string, unknown> } = {}
): Promise<SyncResult> {
  const service = syncServiceFromEnv(options.env);

  switch (action) {
    case "pull":
      return service.pull();
    case "commit":
      return service.commit(options.message ?? "Update open-think artifact");
    case "push":
      return service.push();
    case "deploy":
      return service.deploy();
    case "reconcile":
      return service.reconcile();
  }
}

export async function setAutoSyncFromEnv(
  config: Partial<AutoSyncConfig>,
  env?: Record<string, unknown>
): Promise<SyncStatus> {
  return syncServiceFromEnv(env).setAutoSync(config);
}

export async function runAutomaticSyncFromEnv(
  env?: Record<string, unknown>
): Promise<SyncResult | SyncStatus> {
  const service = syncServiceFromEnv(env);
  const status = await service.status();

  if (!status.autoSync.enabled) {
    return status;
  }

  return service.reconcile();
}

function normalizeEnv(env: Record<string, unknown>): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  const keys = [
    "ARTIFACTS_REMOTE",
    "ARTIFACTS_TOKEN",
    "ARTIFACTS_BRANCH",
    "ARTIFACTS_AUTHOR_NAME",
    "ARTIFACTS_AUTHOR_EMAIL",
    "OPEN_THINK_SCRIPT_NAME",
    "OPEN_THINK_WORKER_UPLOAD_METADATA",
    "OPEN_THINK_AUTO_SYNC",
    "OPEN_THINK_SYNC_DIRECTION",
    "OPEN_THINK_AUTO_SYNC_INTERVAL_SECONDS",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN"
  ];

  for (const key of keys) {
    const value = env[key] ?? process.env[key];
    if (typeof value === "string") normalized[key] = value;
  }

  return normalized;
}
