import { describe, expect, it } from "vitest";
import { renderAgentsSdkPersonalAgentRuntime } from "../agents-sdk-runtime-template";
import { buildDeploymentRequest } from "../deployment-engine";

describe("renderAgentsSdkPersonalAgentRuntime", () => {
  it("renders a package-style Cloudflare Agents SDK runtime", () => {
    const files = renderAgentsSdkPersonalAgentRuntime({
      deploymentId: "agent-test123",
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        agentName: "Ada",
        cloudflareAccountId: "acct",
        cfApiToken: "token",
        acceptedTerms: true
      }),
      bindings: {
        scriptName: "open-think-ada",
        databaseName: "open-think-ada-db",
        databaseId: "d1-id",
        bucketName: "open-think-ada-artifacts",
        queueName: "open-think-ada-tasks",
        vectorizeName: "open-think-ada-memory"
      }
    });

    expect(files.map((file) => file.path)).toEqual([
      "package.json",
      "wrangler.jsonc",
      "src/server.ts"
    ]);

    const packageJson = JSON.parse(files[0]?.contents ?? "{}");
    expect(packageJson.dependencies).toMatchObject({
      "@cloudflare/ai-chat": "^0.6.2",
      agents: "^0.12.3",
      ai: "^6.0.174",
      "workers-ai-provider": "^3.1.13"
    });

    const wrangler = JSON.parse(files[1]?.contents ?? "{}");
    expect(wrangler.main).toBe("src/server.ts");
    expect(wrangler.durable_objects.bindings).toEqual([
      { name: "PersonalChatAgent", class_name: "PersonalChatAgent" }
    ]);
    expect(wrangler.migrations[0].new_sqlite_classes).toEqual(["PersonalChatAgent"]);

    const source = files[2]?.contents ?? "";
    expect(source).toContain('import { AIChatAgent } from "@cloudflare/ai-chat"');
    expect(source).toContain('from "agents"');
    expect(source).toContain("this.addMcpServer(");
    expect(source).toContain("this.mcp.getAITools()");
    expect(source).toContain("toUIMessageStreamResponse()");
  });
});
