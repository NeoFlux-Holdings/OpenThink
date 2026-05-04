import type { ITerminalSession } from "@open-think/core";

export class BrowserTerminalSession implements ITerminalSession {
  private readonly listeners = new Set<(data: string) => void>();
  private started = false;

  async start(command: string[] = ["/bin/bash"]): Promise<void> {
    this.started = true;
    this.emit(`started ${command.join(" ")} on websocket-pty transport`);
  }

  async write(data: string): Promise<void> {
    if (!this.started) throw new Error("Terminal session has not started.");
    this.emit(`$ ${data.trim()}\ncontainer output streamed through TerminalDO`);
  }

  onOutput(callback: (data: string) => void): void {
    this.listeners.add(callback);
  }

  async resize(cols: number, rows: number): Promise<void> {
    this.emit(`resized ${cols}x${rows}`);
  }

  async destroy(): Promise<void> {
    this.started = false;
    this.emit("terminal destroyed");
    this.listeners.clear();
  }

  private emit(data: string): void {
    for (const listener of this.listeners) listener(data);
  }
}

export function localCloudflaredCommand(agentId: string, host: string): string {
  return `cloudflared access ssh --hostname ${agentId}.${host}`;
}
