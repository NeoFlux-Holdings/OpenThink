import type { IMcpServer, Tool } from "@open-think/core";

export type ToolHandler = (args: unknown) => Promise<unknown> | unknown;

export interface RegisteredTool extends Tool {
  handler: ToolHandler;
}

export class InProcessMcpServer implements IMcpServer {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  async listTools(): Promise<Tool[]> {
    return [...this.tools.values()].map(({ handler: _handler, ...tool }) => tool);
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown MCP tool: ${name}`);
    return tool.handler(args);
  }
}

export class McpClient {
  constructor(private readonly server: IMcpServer) {}

  listTools(): Promise<Tool[]> {
    return this.server.listTools();
  }

  callTool<T = unknown>(name: string, args: unknown): Promise<T> {
    return this.server.callTool(name, args) as Promise<T>;
  }
}

export function createCloudflareApiMcpServer(): InProcessMcpServer {
  const server = new InProcessMcpServer();

  server.register({
    name: "search",
    description: "Search the compact Cloudflare API surface.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    handler: (args) => ({ matches: [`api:${JSON.stringify(args)}`] })
  });

  server.register({
    name: "execute",
    description: "Execute a scoped Cloudflare API action.",
    inputSchema: {
      type: "object",
      properties: {
        endpoint: { type: "string" },
        method: { type: "string" },
        body: { type: "object" }
      }
    },
    handler: (args) => ({ ok: true, request: args })
  });

  return server;
}
