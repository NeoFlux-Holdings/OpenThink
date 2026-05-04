import { describe, expect, it } from "vitest";
import { automationSnapshotForRequest } from "../environment";

describe("automationSnapshotForRequest", () => {
  const request = {
    flow: "self" as const,
    cloudflareAccountId: "acct",
    cfApiToken: "token"
  };

  it("allows in-memory deployment state outside production", () => {
    const snapshot = automationSnapshotForRequest(request, {
      repository: "memory",
      workersAIAvailable: true,
      env: {
        NODE_ENV: "development"
      }
    });

    expect(snapshot.missing).not.toContain("DB binding or OPEN_THINK_PLATFORM_D1_DATABASE_ID");
    expect(snapshot.warnings).toContain(
      "Using in-memory deployment state for local development. Run provision:cf to persist launches in platform D1."
    );
  });

  it("requires persistent deployment state in production", () => {
    const snapshot = automationSnapshotForRequest(request, {
      repository: "memory",
      workersAIAvailable: true,
      env: {
        NODE_ENV: "production"
      }
    });

    expect(snapshot.missing).toContain("DB binding or OPEN_THINK_PLATFORM_D1_DATABASE_ID");
  });
});
