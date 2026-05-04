import type { SyncConfig, SyncDirection, WorkerUploadMetadata } from "./types";

export function syncConfigFromEnv(env: Record<string, string | undefined> = {}): SyncConfig {
  const remoteUrl = env.ARTIFACTS_REMOTE;
  const token = env.ARTIFACTS_TOKEN;
  const sourceOfTruth = remoteUrl ? "cloudflare-artifacts" : "local-dev";

  const config: SyncConfig = {
    sourceOfTruth,
    branch: env.ARTIFACTS_BRANCH ?? "main",
    authorName: env.ARTIFACTS_AUTHOR_NAME ?? "open-think agent",
    authorEmail: env.ARTIFACTS_AUTHOR_EMAIL ?? "agent@open-think.app",
    autoSync: {
      enabled: env.OPEN_THINK_AUTO_SYNC === "true",
      direction: parseDirection(env.OPEN_THINK_SYNC_DIRECTION),
      intervalSeconds: Number(env.OPEN_THINK_AUTO_SYNC_INTERVAL_SECONDS ?? 300)
    }
  };

  if (remoteUrl) config.remoteUrl = remoteUrl;
  if (token) config.token = token;
  if (env.OPEN_THINK_SCRIPT_NAME) {
    config.deployScriptName = env.OPEN_THINK_SCRIPT_NAME;
  }
  const workerUploadMetadata = parseWorkerUploadMetadata(env.OPEN_THINK_WORKER_UPLOAD_METADATA);
  if (workerUploadMetadata) {
    config.workerUploadMetadata = workerUploadMetadata;
  }
  if (env.CLOUDFLARE_ACCOUNT_ID) {
    config.cloudflareAccountId = env.CLOUDFLARE_ACCOUNT_ID;
  }
  if (env.CLOUDFLARE_API_TOKEN) {
    config.cloudflareApiToken = env.CLOUDFLARE_API_TOKEN;
  }

  return config;
}

function parseDirection(value: string | undefined): SyncDirection {
  if (value === "pull-from-remote" || value === "push-to-remote" || value === "bidirectional") {
    return value;
  }
  return "bidirectional";
}

function parseWorkerUploadMetadata(value: string | undefined): WorkerUploadMetadata | undefined {
  if (!value) return undefined;

  try {
    const metadata = JSON.parse(value) as WorkerUploadMetadata;
    if (
      metadata &&
      typeof metadata.main_module === "string" &&
      typeof metadata.compatibility_date === "string" &&
      Array.isArray(metadata.compatibility_flags) &&
      Array.isArray(metadata.bindings) &&
      (metadata.keep_bindings === undefined || Array.isArray(metadata.keep_bindings))
    ) {
      return metadata;
    }
  } catch {
    // Invalid metadata falls back to the package default.
  }

  return undefined;
}
