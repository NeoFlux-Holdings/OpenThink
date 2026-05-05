import { describe, expect, it } from "vitest";
import ts from "typescript";
import { renderAgentWorkerModule } from "../agent-worker-template";
import { buildDeploymentRequest } from "../deployment-engine";

describe("renderAgentWorkerModule", () => {
  it("renders streamed chat support for the raw deployed worker app", () => {
    const source = renderAgentWorkerModule({
      deploymentId: "agent-test123",
      scriptName: "open-think-ada",
      request: buildDeploymentRequest("self", {
        userId: "user-1",
        agentName: "Ada",
        cloudflareAccountId: "acct",
        cfApiToken: "token",
        acceptedTerms: true
      })
    });

    expect(source).toContain('"/chat?stream=1"');
    expect(source).toContain("text/event-stream");
    expect(source).toContain("streamChatResponse");
    expect(source).toContain("readEventStream");
    expect(source).toContain("chatAbortController");
    expect(source).toContain("server-sent-events");
    expect(source).toContain("Agents SDK package deployments use AIChatAgent WebSocket streaming");

    const parsed = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022
      },
      reportDiagnostics: true
    });
    expect(parsed.diagnostics ?? []).toEqual([]);
  });
});
