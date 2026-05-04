export interface ContainerStartOptions {
  entrypoint?: string[];
  keepAliveSeconds?: number;
  environment?: Record<string, string>;
}

export interface ContainerHandle {
  id: string;
  status: "starting" | "running" | "hibernating" | "stopped";
  startedAt?: string;
}

export interface ContainerRuntime {
  start(options?: ContainerStartOptions): Promise<ContainerHandle>;
  stop(): Promise<void>;
  signal(signal: "SIGTERM" | "SIGKILL" | "SIGHUP"): Promise<void>;
  getTcpPort(port: number): Promise<{ hostname: string; port: number }>;
}

export class AgentContainerManager {
  private handle: ContainerHandle | null = null;

  constructor(private readonly runtime: ContainerRuntime) {}

  async ensureStarted(options: ContainerStartOptions = {}): Promise<ContainerHandle> {
    if (this.handle?.status === "running") return this.handle;
    this.handle = await this.runtime.start({
      keepAliveSeconds: 600,
      entrypoint: ["/bin/bash"],
      ...options
    });
    return this.handle;
  }

  async ptyPort(port = 8080): Promise<{ hostname: string; port: number }> {
    await this.ensureStarted();
    return this.runtime.getTcpPort(port);
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
    if (this.handle) this.handle.status = "stopped";
  }
}
