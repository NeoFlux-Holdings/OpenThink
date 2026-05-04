import type {
  AutoSyncConfig,
  RepoDiff,
  RepoSyncService,
  RepoWrite,
  SyncConfig,
  SyncResult,
  SyncStatus
} from "./types";

interface MemoryCommit {
  sha: string;
  message: string;
  files: Map<string, string>;
  createdAt: string;
}

export class MemoryRepoSyncService implements RepoSyncService {
  private readonly files = new Map<string, string>();
  private remoteFiles = new Map<string, string>();
  private commits: MemoryCommit[] = [];
  private deployedHead: string | undefined;
  private lastSyncAt: string | undefined;
  private lastDeployAt: string | undefined;
  private autoSync: AutoSyncConfig;

  constructor(private readonly config: SyncConfig) {
    this.autoSync = { ...config.autoSync };
    this.seed();
  }

  async status(): Promise<SyncStatus> {
    const status: SyncStatus = {
      sourceOfTruth: this.config.sourceOfTruth,
      branch: this.config.branch,
      dirtyFiles: (await this.diff())
        .filter((change) => change.status !== "unchanged")
        .map((change) => change.path),
      drift: drift(this.localHead, this.remoteHead, this.deployedHead),
      autoSync: this.autoSync,
      missing: [],
      warnings:
        this.config.sourceOfTruth === "local-dev"
          ? ["Using memory sync; configure Cloudflare Artifacts for live bidirectional sync."]
          : []
    };

    if (this.config.remoteUrl) status.remoteUrl = this.config.remoteUrl;
    if (this.localHead) status.localHead = this.localHead;
    if (this.remoteHead) status.remoteHead = this.remoteHead;
    if (this.deployedHead) status.deployedHead = this.deployedHead;
    if (this.lastSyncAt) status.lastSyncAt = this.lastSyncAt;
    if (this.lastDeployAt) status.lastDeployAt = this.lastDeployAt;

    return status;
  }

  async listFiles(prefix = ""): Promise<string[]> {
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async readFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeFile(change: RepoWrite): Promise<void> {
    this.files.set(normalizePath(change.path), change.content);
  }

  async diff(): Promise<RepoDiff[]> {
    const paths = new Set([...this.files.keys(), ...this.remoteFiles.keys()]);
    return [...paths].sort().map((path) => {
      const local = this.files.get(path);
      const remote = this.remoteFiles.get(path);

      if (local === remote) return { path, status: "unchanged" };
      if (remote === undefined) return { path, status: "added" };
      if (local === undefined) return { path, status: "deleted" };
      return { path, status: "modified" };
    });
  }

  async pull(): Promise<SyncResult> {
    this.files.clear();
    for (const [path, content] of this.remoteFiles) this.files.set(path, content);
    this.lastSyncAt = new Date().toISOString();
    return this.result("pull", "Pulled remote Artifacts state into the local draft.");
  }

  async commit(message: string): Promise<SyncResult> {
    const commit: MemoryCommit = {
      sha: createSha(message, this.files),
      message,
      files: new Map(this.files),
      createdAt: new Date().toISOString()
    };
    this.commits.push(commit);
    this.remoteFiles = new Map(this.files);
    this.lastSyncAt = commit.createdAt;
    return this.result("commit", "Committed draft files to the Artifacts remote.", commit.sha);
  }

  async push(): Promise<SyncResult> {
    this.remoteFiles = new Map(this.files);
    this.lastSyncAt = new Date().toISOString();
    return this.result("push", "Pushed local draft state to the Artifacts remote.", this.localHead);
  }

  async deploy(): Promise<SyncResult> {
    this.deployedHead = this.localHead;
    this.lastDeployAt = new Date().toISOString();
    return this.result("deploy", "Marked the current Artifacts commit as deployed.", undefined, this.deployedHead);
  }

  async reconcile(): Promise<SyncResult> {
    if (this.autoSync.direction === "pull-from-remote") {
      return this.pull();
    }

    if (this.autoSync.direction === "push-to-remote") {
      await this.commit("Automated open-think sync");
      return this.deploy();
    }

    if (this.remoteHead && this.remoteHead !== this.localHead) {
      await this.pull();
    }

    if ((await this.diff()).some((change) => change.status !== "unchanged")) {
      await this.commit("Automated open-think sync");
    }

    return this.deploy();
  }

  async setAutoSync(config: Partial<AutoSyncConfig>): Promise<SyncStatus> {
    this.autoSync = {
      ...this.autoSync,
      ...config
    };
    return this.status();
  }

  private get localHead(): string | undefined {
    return this.commits.at(-1)?.sha;
  }

  private get remoteHead(): string | undefined {
    if (this.commits.length > 0) return this.commits.at(-1)?.sha;
    return createSha("remote-seed", this.remoteFiles);
  }

  private async result(
    action: SyncResult["action"],
    message: string,
    commitSha?: string,
    deployedSha?: string
  ): Promise<SyncResult> {
    const result: SyncResult = {
      action,
      status: await this.status(),
      message
    };
    if (commitSha) result.commitSha = commitSha;
    if (deployedSha) result.deployedSha = deployedSha;
    return result;
  }

  private seed(): void {
    const starterFiles = new Map<string, string>([
      ["README.md", "# open-think artifact\n\nCloudflare Artifacts canonical repo.\n"],
      ["worker.js", "export default { fetch: () => new Response('open-think') };\n"]
    ]);

    this.remoteFiles = new Map(starterFiles);
    for (const [path, content] of starterFiles) this.files.set(path, content);
    this.commits.push({
      sha: createSha("seed", starterFiles),
      message: "Seed open-think artifact",
      files: new Map(starterFiles),
      createdAt: new Date().toISOString()
    });
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function createSha(message: string, files: Map<string, string>): string {
  const seed = `${message}:${[...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => `${path}:${content}`)
    .join("|")}:${Date.now()}`;
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(16).padStart(8, "0").slice(0, 12);
}

function drift(
  localHead: string | undefined,
  remoteHead: string | undefined,
  deployedHead: string | undefined
): SyncStatus["drift"] {
  if (!localHead || !remoteHead) return "unknown";
  if (localHead !== remoteHead) return "diverged";
  if (deployedHead && deployedHead !== localHead) return "local-ahead";
  return "clean";
}
