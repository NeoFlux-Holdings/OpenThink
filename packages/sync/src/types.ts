export type SyncSourceOfTruth = "cloudflare-artifacts" | "github-upstream" | "local-dev";
export type SyncDirection = "pull-from-remote" | "push-to-remote" | "bidirectional";
export type SyncDrift = "clean" | "remote-ahead" | "local-ahead" | "diverged" | "unknown";
export type SyncAction = "pull" | "commit" | "push" | "deploy" | "reconcile";

export interface WorkerUploadMetadata {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  bindings: Array<Record<string, unknown>>;
  keep_bindings?: string[];
}

export interface SyncConfig {
  sourceOfTruth: SyncSourceOfTruth;
  remoteUrl?: string;
  branch: string;
  token?: string;
  authorName: string;
  authorEmail: string;
  deployScriptName?: string;
  workerUploadMetadata?: WorkerUploadMetadata;
  cloudflareAccountId?: string;
  cloudflareApiToken?: string;
  autoSync: AutoSyncConfig;
}

export interface AutoSyncConfig {
  enabled: boolean;
  direction: SyncDirection;
  intervalSeconds: number;
}

export interface SyncStatus {
  sourceOfTruth: SyncSourceOfTruth;
  branch: string;
  remoteUrl?: string;
  localHead?: string;
  remoteHead?: string;
  deployedHead?: string;
  dirtyFiles: string[];
  drift: SyncDrift;
  autoSync: AutoSyncConfig;
  lastSyncAt?: string;
  lastDeployAt?: string;
  missing: string[];
  warnings: string[];
}

export interface SyncResult {
  action: SyncAction;
  status: SyncStatus;
  message: string;
  commitSha?: string;
  deployedSha?: string;
}

export interface RepoWrite {
  path: string;
  content: string;
}

export interface RepoDiff {
  path: string;
  status: "added" | "modified" | "deleted" | "unchanged";
}

export interface RepoSyncService {
  status(): Promise<SyncStatus>;
  listFiles(prefix?: string): Promise<string[]>;
  readFile(path: string): Promise<string | null>;
  writeFile(change: RepoWrite): Promise<void>;
  diff(): Promise<RepoDiff[]>;
  pull(): Promise<SyncResult>;
  commit(message: string): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  deploy(): Promise<SyncResult>;
  reconcile(): Promise<SyncResult>;
  setAutoSync(config: Partial<AutoSyncConfig>): Promise<SyncStatus>;
}
