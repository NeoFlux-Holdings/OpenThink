import git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import LightningFS from "@isomorphic-git/lightning-fs";
import type {
  AutoSyncConfig,
  RepoDiff,
  RepoSyncService,
  RepoWrite,
  SyncConfig,
  SyncResult,
  SyncStatus,
  WorkerUploadMetadata
} from "./types";

export class ArtifactGitSyncService implements RepoSyncService {
  private readonly fs: LightningFS;
  private readonly dir = "/open-think";
  private deployedHead: string | undefined;
  private lastSyncAt: string | undefined;
  private lastDeployAt: string | undefined;
  private autoSync: AutoSyncConfig;

  constructor(private readonly config: SyncConfig) {
    this.fs = new LightningFS(`open-think-${hashKey(config.remoteUrl ?? "local")}`);
    this.autoSync = { ...config.autoSync };
  }

  async status(): Promise<SyncStatus> {
    const missing = this.missingConfig();

    if (missing.length > 0) {
      const status: SyncStatus = {
        sourceOfTruth: this.config.sourceOfTruth,
        branch: this.config.branch,
        dirtyFiles: [],
        drift: "unknown",
        autoSync: this.autoSync,
        missing,
        warnings: ["Cloudflare Artifacts sync is configured but not ready."]
      };

      if (this.config.remoteUrl) status.remoteUrl = this.config.remoteUrl;
      if (this.deployedHead) status.deployedHead = this.deployedHead;
      if (this.lastSyncAt) status.lastSyncAt = this.lastSyncAt;
      if (this.lastDeployAt) status.lastDeployAt = this.lastDeployAt;

      return status;
    }

    await this.ensureClone();
    await this.fetchRemote();
    const [localHead, remoteHead, dirtyFiles] = await Promise.all([
      this.resolveHead("HEAD"),
      this.resolveHead(`refs/remotes/origin/${this.config.branch}`),
      this.dirtyFiles()
    ]);

    const status: SyncStatus = {
      sourceOfTruth: this.config.sourceOfTruth,
      branch: this.config.branch,
      dirtyFiles,
      drift: drift(localHead, remoteHead, this.deployedHead, dirtyFiles.length),
      autoSync: this.autoSync,
      missing: [],
      warnings: this.missingDeployConfig().length > 0
        ? [`Deploy is disabled until ${this.missingDeployConfig().join(", ")} are configured.`]
        : []
    };

    if (this.config.remoteUrl) status.remoteUrl = this.config.remoteUrl;
    if (localHead) status.localHead = localHead;
    if (remoteHead) status.remoteHead = remoteHead;
    if (this.deployedHead) status.deployedHead = this.deployedHead;
    if (this.lastSyncAt) status.lastSyncAt = this.lastSyncAt;
    if (this.lastDeployAt) status.lastDeployAt = this.lastDeployAt;

    return status;
  }

  async listFiles(prefix = ""): Promise<string[]> {
    await this.ensureClone();
    return this.walkFiles(prefix);
  }

  async readFile(path: string): Promise<string | null> {
    await this.ensureClone();
    try {
      const content = await this.fs.promises.readFile(`${this.dir}/${normalizePath(path)}`, "utf8");
      return String(content);
    } catch {
      return null;
    }
  }

  async writeFile(change: RepoWrite): Promise<void> {
    await this.ensureClone();
    const path = normalizePath(change.path);
    await mkdirp(this.fs, parentDir(`${this.dir}/${path}`));
    await this.fs.promises.writeFile(`${this.dir}/${path}`, change.content, "utf8");
  }

  async diff(): Promise<RepoDiff[]> {
    await this.ensureClone();
    const matrix = await git.statusMatrix({
      fs: this.fs,
      dir: this.dir
    });

    return matrix.map(([path, head, workdir, stage]) => ({
      path,
      status: statusFromMatrix(head, workdir, stage)
    }));
  }

  async pull(): Promise<SyncResult> {
    await this.ensureClone();
    await git.pull({
      fs: this.fs,
      http,
      dir: this.dir,
      ref: this.config.branch,
      singleBranch: true,
      fastForwardOnly: true,
      author: this.author(),
      onAuth: () => this.auth()
    });
    this.lastSyncAt = new Date().toISOString();
    return this.result("pull", "Pulled remote Artifacts changes into the Worker draft repo.");
  }

  async commit(message: string): Promise<SyncResult> {
    await this.ensureClone();
    const files = await this.walkFiles();
    for (const file of files) {
      await git.add({ fs: this.fs, dir: this.dir, filepath: file });
    }

    const sha = await git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author: this.author()
    });
    this.lastSyncAt = new Date().toISOString();
    return this.result("commit", "Committed Worker draft changes to the local artifact clone.", sha);
  }

  async push(): Promise<SyncResult> {
    await this.ensureClone();
    await git.push({
      fs: this.fs,
      http,
      dir: this.dir,
      remote: "origin",
      ref: this.config.branch,
      onAuth: () => this.auth()
    });
    this.lastSyncAt = new Date().toISOString();
    return this.result("push", "Pushed committed changes to Cloudflare Artifacts.");
  }

  async deploy(): Promise<SyncResult> {
    await this.ensureClone();
    const upload = await this.uploadWorkerScript();
    this.deployedHead = await this.resolveHead("HEAD");
    this.lastDeployAt = new Date().toISOString();
    return this.result(
      "deploy",
      upload,
      undefined,
      this.deployedHead
    );
  }

  async reconcile(): Promise<SyncResult> {
    if (!this.autoSync.enabled) {
      return this.result("reconcile", "Auto sync is disabled; no changes applied.");
    }

    if (this.autoSync.direction === "pull-from-remote") {
      return this.pull();
    }

    if (this.autoSync.direction === "push-to-remote") {
      await this.commit("Automated open-think sync");
      await this.push();
      return this.deploy();
    }

    const status = await this.status();
    if (status.remoteHead && status.localHead !== status.remoteHead) {
      await this.pull();
    }
    if ((await this.dirtyFiles()).length > 0) {
      await this.commit("Automated open-think sync");
      await this.push();
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

  private async ensureClone(): Promise<void> {
    if (this.missingConfig().length > 0) return;

    try {
      await git.resolveRef({ fs: this.fs, dir: this.dir, ref: "HEAD" });
    } catch {
      await git.clone({
        fs: this.fs,
        http,
        dir: this.dir,
        url: this.config.remoteUrl!,
        ref: this.config.branch,
        singleBranch: true,
        depth: 1,
        onAuth: () => this.auth()
      });
    }
  }

  private async fetchRemote(): Promise<void> {
    await git.fetch({
      fs: this.fs,
      http,
      dir: this.dir,
      remote: "origin",
      ref: this.config.branch,
      singleBranch: true,
      depth: 1,
      onAuth: () => this.auth()
    });
  }

  private async resolveHead(ref: string): Promise<string | undefined> {
    try {
      return await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref
      });
    } catch {
      return undefined;
    }
  }

  private async dirtyFiles(): Promise<string[]> {
    return (await this.diff())
      .filter((change) => change.status !== "unchanged")
      .map((change) => change.path);
  }

  private async walkFiles(prefix = ""): Promise<string[]> {
    const results: string[] = [];
    await walk(this.fs, this.dir, normalizePath(prefix), results);
    return results.sort();
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

  private auth() {
    return {
      username: "open-think",
      password: this.config.token ?? ""
    };
  }

  private author() {
    return {
      name: this.config.authorName,
      email: this.config.authorEmail
    };
  }

  private missingConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.remoteUrl) missing.push("ARTIFACTS_REMOTE");
    if (!this.config.token) missing.push("ARTIFACTS_TOKEN");
    return missing;
  }

  private missingDeployConfig(): string[] {
    const missing: string[] = [];
    if (!this.config.cloudflareAccountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
    if (!this.config.cloudflareApiToken) missing.push("CLOUDFLARE_API_TOKEN");
    if (!this.config.deployScriptName) missing.push("OPEN_THINK_SCRIPT_NAME");
    return missing;
  }

  private async uploadWorkerScript(): Promise<string> {
    const missing = this.missingDeployConfig();
    if (missing.length > 0) {
      throw new Error(
        `Worker deploy requires ${missing.join(", ")}; refusing to mark an artifact as deployed.`
      );
    }

    const workerCode = await this.readFile("worker.js");

    if (!workerCode) {
      throw new Error("worker.js was not present in the artifact clone; run the Worker build before deploy.");
    }

    const form = new FormData();
    form.set(
      "metadata",
      JSON.stringify(this.config.workerUploadMetadata ?? defaultWorkerUploadMetadata())
    );
    form.set(
      "worker.js",
      new Blob([workerCode], { type: "application/javascript+module" }),
      "worker.js"
    );

    const uploadUrl = new URL(
      `https://api.cloudflare.com/client/v4/accounts/${this.config.cloudflareAccountId}/workers/scripts/${this.config.deployScriptName}`
    );
    if (this.config.workerUploadMetadata?.keep_bindings?.length) {
      uploadUrl.searchParams.set("bindings_inherit", "strict");
    }

    const response = await fetch(
      uploadUrl.toString(),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.config.cloudflareApiToken}`
        },
        body: form
      }
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Worker script upload failed with ${response.status}${body ? `: ${body}` : ""}`
      );
    }

    return `Uploaded ${this.config.deployScriptName} from Artifacts.`;
  }
}

function defaultWorkerUploadMetadata(): WorkerUploadMetadata {
  return {
    main_module: "worker.js",
    compatibility_date: "2026-04-20",
    compatibility_flags: ["nodejs_compat"],
    bindings: [],
    keep_bindings: ["secret_text", "secret_key"]
  };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function parentDir(path: string): string {
  return path.split("/").slice(0, -1).join("/") || "/";
}

async function mkdirp(fs: LightningFS, path: string): Promise<void> {
  if (path === "/" || path === "") return;
  const parts = path.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current += `/${part}`;
    try {
      await fs.promises.mkdir(current);
    } catch {
      // Directory already exists.
    }
  }
}

async function walk(
  fs: LightningFS,
  root: string,
  prefix: string,
  results: string[]
): Promise<void> {
  const dir = prefix ? `${root}/${prefix}` : root;
  let entries: string[];

  try {
    entries = (await fs.promises.readdir(dir)) as string[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry}` : entry;
    const absolute = `${root}/${path}`;
    const stat = await fs.promises.stat(absolute);
    if (stat.isDirectory()) {
      await walk(fs, root, path, results);
    } else {
      results.push(path);
    }
  }
}

function statusFromMatrix(
  head: number,
  workdir: number,
  stage: number
): RepoDiff["status"] {
  if (head === workdir && workdir === stage) return "unchanged";
  if (head === 0 && workdir > 0) return "added";
  if (workdir === 0) return "deleted";
  return "modified";
}

function drift(
  localHead: string | undefined,
  remoteHead: string | undefined,
  deployedHead: string | undefined,
  dirtyCount: number
): SyncStatus["drift"] {
  if (dirtyCount > 0) return "local-ahead";
  if (!localHead || !remoteHead) return "unknown";
  if (localHead !== remoteHead) return "remote-ahead";
  if (deployedHead && deployedHead !== localHead) return "local-ahead";
  return "clean";
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
